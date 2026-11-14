#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# release.sh — đóng gói một bản phát hành (v1.0.6, FR-14).
#
#   ./release.sh build [--local] [--no-current]
#   ./release.sh send --to <ssh-host>        (CHƯA hỗ trợ: làm ở T-32; hiện chỉ từ chối bản -local rồi báo chưa hỗ trợ)
#
# `build` làm đúng các bước sau, dừng ở lỗi đầu tiên:
#   1. Đọc version từ RealEstateBackendApp/package.json, khẳng định RealEstateAdminApp/package.json CÙNG version.
#   2. Từ chối cây git bẩn (kể cả file chưa theo dõi) và nhánh chưa push (HEAD vượt upstream hoặc nhánh không có upstream).
#      Trong CI (CI=true hoặc GITHUB_ACTIONS=true) bỏ qua kiểm "chưa push" (checkout của CI là detached) nhưng VẪN từ chối cây bẩn.
#      `--local` cho phép cả hai (dev thử máy mình): tag là `<version>-local`, release.env ghi RELEASE_LOCAL=1 và `send` từ chối bản này.
#   3. Dựng hai image `realestatemanager-backend` và `realestatemanager-frontend` (--target production, --build-arg GIT_COMMIT),
#      tag bất biến `<version>-<commit 7 ký tự>` (hoặc `<version>-local`).
#   4. Ghi release.env (KHÔNG chứa bí mật): RELEASE_VERSION, RELEASE_LOCAL, GIT_COMMIT, BACKEND_/FRONTEND_ IMAGE_NAME, IMAGE_TAG, IMAGE_ID.
#      Tên khóa cố ý KHÔNG trùng BACKEND_IMAGE/FRONTEND_IMAGE của docker-compose.yml (hai biến đó là tên image đầy đủ ghi đè).
#   5. Sinh release.tgz + release.tgz.sha256 CHỈ gồm whitelist: docker-compose.yml deploy.sh backup.sh restore.sh ops/ scripts/ release.env.
#      Lấy danh sách bằng `git ls-files` (file chưa theo dõi/bị ignore như .env, backups/, logs/ không bao giờ lọt vào gói) và chặn thêm
#      lần nữa nếu có đường dẫn trông như bí mật/dump.
#   6. Đặt tag `current` cục bộ cho cả hai image (compose đọc tag này), TRỪ khi `--no-current` hoặc đang chạy trong CI: runner CI dùng
#      chung Docker daemon với stack đang chạy, chỉ deploy.sh được promote `current` (Architecture 5.1).
#
# Đầu ra nằm ở thư mục chứa script: release.env, release.tgz, release.tgz.sha256 (đều trong .gitignore).
# Mỗi lần `build` bắt đầu bằng việc xóa ba file trên của lần trước để lỗi giữa chừng không để lại gói cũ trông như mới.
# Không đăng nhập hay đẩy lên registry.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

LOG_PREFIX="release"
_self="$(readlink -f -- "${BASH_SOURCE[0]}" 2>/dev/null || true)"
[[ -n "$_self" && -f "$_self" ]] || { echo "[release] LỖI: không resolve được đường dẫn thật của release.sh (cần readlink -f)." >&2; exit 1; }
ROOT_DIR="$(cd "$(dirname "$_self")" && pwd)"
# shellcheck source=ops/lib/ops-common.sh
source "$ROOT_DIR/ops/lib/ops-common.sh"

readonly BACKEND_IMAGE_NAME="realestatemanager-backend"
readonly FRONTEND_IMAGE_NAME="realestatemanager-frontend"
readonly BACKEND_DIR="RealEstateBackendApp"
readonly FRONTEND_DIR="RealEstateAdminApp"
# Mục cấp 1 được phép vào gói (release.env thêm riêng vì sinh ra lúc build, không nằm trong git).
readonly WHITELIST=(docker-compose.yml deploy.sh backup.sh restore.sh ops scripts)
readonly OUT_ENV="release.env"
readonly OUT_TGZ="release.tgz"
readonly OUT_SHA="release.tgz.sha256"
# Đường dẫn không bao giờ được vào gói dù đang được git theo dõi (lớp chặn thứ hai, phòng lỡ `git add` nhầm).
readonly FORBIDDEN_PATH_RE='(^|/)\.env(\.[^/]*)?$|(^|/)(backups|logs)/|\.(dump|archive|bson|pem|key)$'
readonly SEMVER_RE='^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.]+)?$'   # không cho `+` vì docker tag không nhận

usage() {
  cat <<'EOF'
Cách dùng:
  ./release.sh build [--local] [--no-current]
  ./release.sh send --to <ssh-host>      (chưa hỗ trợ, làm ở T-32)
EOF
}

# CI = biến môi trường CI/GITHUB_ACTIONS đúng "true".
in_ci() { [[ "${CI:-}" == "true" || "${GITHUB_ACTIONS:-}" == "true" ]]; }

# Version hợp lệ của một app (đọc dòng "version" đầu tiên của package.json); die nếu thiếu/sai định dạng.
app_version() {
  local dir="$1" v
  [[ -f "$ROOT_DIR/$dir/package.json" ]] || die "Thiếu $dir/package.json."
  v="$(read_pkg_version "$ROOT_DIR/$dir/package.json" || true)"
  [[ "$v" =~ $SEMVER_RE ]] || die "Version trong $dir/package.json không hợp lệ: [$v] (mong đợi dạng 1.2.3 hoặc 1.2.3-rc.1)."
  printf '%s' "$v"
}

# Image ID đầy đủ (sha256:...) của một ref; die nếu không đọc được.
image_id() {
  local id
  id="$(docker image inspect -f '{{.Id}}' "$1" 2>/dev/null)" || die "Không đọc được image ID của $1."
  id="${id%%$'\n'*}"; id="${id%$'\r'}"
  [[ "$id" =~ ^sha256:[0-9a-f]{64}$ ]] || die "Image ID của $1 không đúng dạng sha256:<64 hex>: [$id]."
  printf '%s' "$id"
}

# Chặn cây git bẩn; chặn nhánh chưa push (trừ khi $1 = skip_push). Chạy trong ROOT_DIR.
require_clean_pushed_tree() {
  local skip_push="$1" dirty upstream ahead
  dirty="$(git status --porcelain --untracked-files=normal)"
  if [[ -n "$dirty" ]]; then
    die "Cây git còn thay đổi chưa commit (hoặc file chưa theo dõi); commit rồi chạy lại, hoặc dùng --local để thử trên máy mình:
$(head -n 10 <<<"$dirty")"
  fi
  [[ "$skip_push" == "skip_push" ]] && return 0
  upstream="$(git rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null)" \
    || die "Nhánh hiện tại chưa có upstream (chưa push). Push rồi chạy lại, hoặc dùng --local."
  ahead="$(git rev-list --count "${upstream}..HEAD")"
  (( ahead == 0 )) || die "Có $ahead commit chưa push lên $upstream (so với bản fetch gần nhất). Push rồi chạy lại, hoặc dùng --local."
}

# Dựng một image (chạy trong ROOT_DIR, đường dẫn tương đối để docker.exe trên Windows khỏi gặp đường dẫn kiểu /d/...): $1 thư mục app, $2 tên image, $3 tag, $4 GIT_COMMIT.
build_image() {
  local dir="$1" name="$2" tag="$3" commit="$4"
  log "Build $name:$tag (context $dir) ..."
  docker build --target production --build-arg "GIT_COMMIT=$commit" -t "$name:$tag" -f "$dir/Dockerfile" "$dir"
}

# Ghi release.env ($1 = đường dẫn) từ các biến toàn cục của cmd_build; quyền 644 (không bí mật).
write_release_env() {
  local out="$1"
  {
    echo "# Sinh bởi release.sh build — KHÔNG sửa tay, KHÔNG chứa bí mật. deploy.sh là nơi duy nhất đọc file này."
    echo "RELEASE_VERSION=$VERSION"
    echo "RELEASE_LOCAL=$IS_LOCAL"
    echo "GIT_COMMIT=$GIT_COMMIT"
    echo "BACKEND_IMAGE_NAME=$BACKEND_IMAGE_NAME"
    echo "BACKEND_IMAGE_TAG=$IMAGE_TAG"
    echo "BACKEND_IMAGE_ID=$BE_ID"
    echo "FRONTEND_IMAGE_NAME=$FRONTEND_IMAGE_NAME"
    echo "FRONTEND_IMAGE_TAG=$IMAGE_TAG"
    echo "FRONTEND_IMAGE_ID=$FE_ID"
  } > "$out"
  chmod 644 "$out" 2>/dev/null || true
}

# Sinh release.tgz từ whitelist: các file ĐANG ĐƯỢC GIT THEO DÕI trong mục whitelist + release.env. Quyền trong gói lấy từ git index
# (100755 → 755, còn lại 644) để Windows (không giữ bit thực thi) vẫn ra gói đúng; thời gian/chủ sở hữu cố định để gói tái lập được.
# $1 = thư mục làm việc tạm. Kết quả: $ROOT_DIR/release.tgz.
make_package() {
  local work="$1" mode_path mode path item count
  : > "$work/plain.list"; : > "$work/exec.list"
  for item in "${WHITELIST[@]}"; do
    count=0
    while IFS= read -r -d '' mode_path; do
      # Bản ghi của `git ls-files -s -z`: "<mode> <sha> <stage>\t<path>".
      mode="${mode_path%% *}"; path="${mode_path#*$'\t'}"
      [[ "$path" =~ $FORBIDDEN_PATH_RE ]] && ! [[ "$path" == *.example ]] && die "Đường dẫn trông như bí mật/dump nằm trong whitelist: $path (git rm --cached hoặc xóa trước khi phát hành)."
      [[ -e "$ROOT_DIR/$path" ]] || die "File được git theo dõi nhưng không có trên đĩa: $path."
      if [[ "$mode" == "100755" ]]; then printf '%s\0' "$path" >> "$work/exec.list"; else printf '%s\0' "$path" >> "$work/plain.list"; fi
      count=$((count + 1))
    done < <(git ls-files -s -z -- "$item")
    (( count > 0 )) || die "Mục whitelist '$item' không có file nào được git theo dõi."
  done
  printf '%s\0' "$OUT_ENV" >> "$work/plain.list"

  local epoch
  epoch="$(git log -1 --format=%ct)"
  local -a common=(--no-recursion --null --owner=0 --group=0 --numeric-owner "--mtime=@$epoch" -C "$ROOT_DIR")
  tar "${common[@]}" --mode=644 -cf "$work/pkg.tar" -T "$work/plain.list"
  [[ -s "$work/exec.list" ]] && tar "${common[@]}" --mode=755 -rf "$work/pkg.tar" -T "$work/exec.list"
  gzip -n -9 -c "$work/pkg.tar" > "$work/$OUT_TGZ"
  mv -f "$work/$OUT_TGZ" "$ROOT_DIR/$OUT_TGZ"
}

cmd_build() {
  local is_local=0 skip_current=0 arg
  for arg in "$@"; do
    case "$arg" in
      --local) is_local=1 ;;
      --no-current) skip_current=1 ;;
      -h|--help) usage; exit 0 ;;
      *) usage >&2; die "Tham số không hợp lệ cho build: $arg" ;;
    esac
  done
  IS_LOCAL="$is_local"

  local c
  for c in git docker tar gzip sha256sum; do command -v "$c" >/dev/null 2>&1 || die "Thiếu lệnh '$c'."; done
  cd "$ROOT_DIR"
  in_git_repo || die "Không phải git repo: $ROOT_DIR."
  [[ -f "$BACKEND_DIR/Dockerfile" && -f "$FRONTEND_DIR/Dockerfile" ]] || die "Thiếu Dockerfile của backend hoặc frontend."

  local be_ver fe_ver
  be_ver="$(app_version "$BACKEND_DIR")"
  fe_ver="$(app_version "$FRONTEND_DIR")"
  [[ "$be_ver" == "$fe_ver" ]] || die "Version backend ($be_ver) khác frontend ($fe_ver): đồng bộ package.json hai app trước khi phát hành."
  VERSION="$be_ver"

  local ci=0
  in_ci && ci=1
  if (( is_local )); then
    log "Chế độ --local: bỏ qua kiểm cây bẩn/chưa push; bản này KHÔNG gửi được (send từ chối)."
  elif (( ci )); then
    require_clean_pushed_tree skip_push
  else
    require_clean_pushed_tree check_push
  fi

  # Cắt thẳng 7 ký tự đầu của hash đầy đủ: `--short=7` chỉ là mức tối thiểu, git có thể trả 8+ ký tự khi trùng tiền tố.
  local c7
  c7="$(git rev-parse HEAD)"
  c7="${c7:0:7}"
  GIT_COMMIT="$c7"
  if (( is_local )) && [[ -n "$(git status --porcelain --untracked-files=normal)" ]]; then GIT_COMMIT="${c7}-dirty"; fi
  if (( is_local )); then IMAGE_TAG="${VERSION}-local"; else IMAGE_TAG="${VERSION}-${c7}"; fi

  docker info >/dev/null 2>&1 || die "Docker daemon không chạy hoặc không truy cập được."
  rm -f "$ROOT_DIR/$OUT_ENV" "$ROOT_DIR/$OUT_TGZ" "$ROOT_DIR/$OUT_SHA"
  # Thoát khác 0 (lỗi build, đóng gói hay sha256) thì xóa CẢ BA file đầu ra: không bao giờ để lại release.env mồ côi không có gói,
  # hay gói thiếu .sha256. Thư mục tạm luôn được dọn.
  local work
  work="$(mktemp -d)"
  # shellcheck disable=SC2064  # $work cần nở ngay lúc đặt trap
  trap "rc=\$?; rm -rf '$work'; if (( rc != 0 )); then rm -f '$ROOT_DIR/$OUT_ENV' '$ROOT_DIR/$OUT_TGZ' '$ROOT_DIR/$OUT_SHA'; fi" EXIT

  build_image "$BACKEND_DIR" "$BACKEND_IMAGE_NAME" "$IMAGE_TAG" "$GIT_COMMIT"
  build_image "$FRONTEND_DIR" "$FRONTEND_IMAGE_NAME" "$IMAGE_TAG" "$GIT_COMMIT"
  BE_ID="$(image_id "$BACKEND_IMAGE_NAME:$IMAGE_TAG")"
  FE_ID="$(image_id "$FRONTEND_IMAGE_NAME:$IMAGE_TAG")"

  write_release_env "$ROOT_DIR/$OUT_ENV"
  make_package "$work"
  ( cd "$ROOT_DIR" && sha256sum "$OUT_TGZ" > "$OUT_SHA" )

  if (( skip_current || ci )); then
    log "Không đặt tag current ($( ((ci)) && echo 'đang chạy trong CI' || echo '--no-current' )); chỉ deploy.sh được promote current."
  else
    local img prev
    for img in "$BACKEND_IMAGE_NAME" "$FRONTEND_IMAGE_NAME"; do
      prev="$(docker image inspect -f '{{.Id}}' "$img:current" 2>/dev/null || true)"
      docker tag "$img:$IMAGE_TAG" "$img:current"
      if [[ -n "$prev" && "$prev" != "$(image_id "$img:current")" ]]; then log "Tag $img:current chuyển từ ${prev:0:19} sang bản vừa build."; fi
    done
    log "Đã đặt tag current cho cả hai image."
  fi

  log "Xong bản $VERSION ($GIT_COMMIT): $BACKEND_IMAGE_NAME:$IMAGE_TAG ($BE_ID), $FRONTEND_IMAGE_NAME:$IMAGE_TAG ($FE_ID)."
  log "Đầu ra: $OUT_ENV, $OUT_TGZ, $OUT_SHA (tại $ROOT_DIR)."
}

# Khung `send` (T-32 sẽ hiện thực): bản -local KHÔNG BAO GIỜ được gửi, kiểm trước mọi thứ khác.
cmd_send() {
  local host="" env_file="$ROOT_DIR/$OUT_ENV"
  while (( $# > 0 )); do
    case "$1" in
      --to) [[ -n "${2:-}" ]] || die "--to cần một ssh-host."; host="$2"; shift 2 ;;
      -h|--help) usage; exit 0 ;;
      *) usage >&2; die "Tham số không hợp lệ cho send: $1" ;;
    esac
  done
  [[ -n "$host" ]] || { usage >&2; die "Thiếu --to <ssh-host>."; }
  [[ -f "$env_file" ]] || die "Chưa có $OUT_ENV: chạy './release.sh build' trước."
  if grep -qE '^RELEASE_LOCAL=1[[:space:]]*$' "$env_file" || grep -qE '^[A-Z_]+_IMAGE_TAG=.*-local[[:space:]]*$' "$env_file"; then
    die "TỪ CHỐI gửi: đây là bản --local (tag -local), không bao giờ được gửi. Build lại từ cây git sạch đã push (không --local)."
  fi
  die "release.sh send chưa được hỗ trợ (làm ở T-32)."
}

main() {
  local sub="${1:-}"
  [[ $# -gt 0 ]] && shift
  case "$sub" in
    build) cmd_build "$@" ;;
    send) cmd_send "$@" ;;
    -h|--help|help|"") usage; [[ -n "$sub" ]] || exit 2; exit 0 ;;
    *) usage >&2; die "Tiểu lệnh không hợp lệ: $sub" ;;
  esac
}

main "$@"
