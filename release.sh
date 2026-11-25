#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# release.sh — đóng gói một bản phát hành (v1.0.6, FR-14).
#
#   ./release.sh build [--local] [--no-current]
#   ./release.sh send --to <ssh-host> [--dir <thư-mục-deploy-trên-VPS>] [--init] [--dry-run]
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
#
# `send` gửi bản đã build lên VPS (v1.0.6, T-32, FR-14; Architecture 5.1/5.2) theo bốn bước, DỪNG ở lỗi đầu tiên, KHÔNG tự rollback
# (hoàn tác sau `up` là việc của deploy.sh/restore.sh), mỗi lỗi in rõ bước nào hỏng và lệnh kế tiếp gợi ý:
#   0. Kiểm cục bộ (chỉ đọc, không chạm mạng): từ chối bản `-local`/RELEASE_LOCAL=1/`-dirty`; có đủ release.env + release.tgz + .sha256;
#      `sha256sum -c` khớp; release.env trong gói TRÙNG release.env cạnh gói; hai tag image có trên máy này và ID khớp release.env.
#   1. Gửi gói + cài: tạo thư mục tạm trên VPS (mktemp -d, quyền 700), scp release.tgz + .sha256 vào đó, `sha256sum -c` PHÍA VPS, rồi chạy
#      BỘ CÀI NẰM TRONG CHÍNH GÓI (giải nén riêng ops/install-release.sh + ops/lib/ops-common.sh vào thư mục tạm) với `--dir <deploy>`.
#      Cách này giải quyết lần cài đầu (VPS chưa có install-release.sh) và luôn dùng bộ cài mới nhất; bộ cài vẫn tự kiểm lại sha256 và danh
#      sách gói trước khi hoán đổi, không bao giờ chạm .env/backups/logs. Thư mục tạm trên VPS luôn được xóa (kể cả khi lỗi).
#   2. ssh `bash ops/check-disk.sh` trong thư mục deploy (bản check-disk vừa cài).
#   3. `docker save <BE> <FE> | gzip | ssh ... 'bash -c "set -o pipefail; gunzip -c | docker load"'`: không registry, không đăng nhập.
#      Mã thoát của TỪNG khâu trong pipe được kiểm (PIPESTATUS) nên docker save/gzip hỏng giữa chừng không bị ssh trả 0 che mất; sau khi nạp,
#      ssh kiểm hai tag có trên VPS (ID lệch chỉ cảnh báo: dưới containerd ID là digest manifest, Q-06; deploy.sh kiểm lại).
#   4. ssh `./deploy.sh` trong thư mục deploy (deploy.sh tự khóa, backup, migrate, up, health).
#      LƯU Ý: deploy.sh chạy qua ssh KHÔNG tương tác (stdin của `bash -s` đã hết, không có tty) nên deploy.sh không được dùng `read`/hỏi đáp.
#
# Tham số `send`:
#   --to <ssh-host>   bắt buộc; dạng `host`, `user@host` hoặc alias trong ~/.ssh/config (chỉ [A-Za-z0-9._@-], không bắt đầu bằng `-`).
#   --dir <đường-dẫn> thư mục deploy trên VPS, mặc định `RealEstateManager` (tương đối so với HOME của tài khoản ssh); chỉ [A-Za-z0-9_./-],
#                     không `..`, không bắt đầu bằng `-`. Đừng viết `~` (shell máy này sẽ nở nó thành HOME của máy này).
#   --init            lần cài ĐẦU: tạo thư mục deploy nếu chưa có (mặc định thư mục phải có sẵn để gõ nhầm đường dẫn không đẻ ra thư mục lạ).
#                     Không có --init, thư mục có sẵn còn phải chứa deploy.sh hoặc .env (giống một thư mục deploy), nếu không bước 1 dừng
#                     (chặn `--dir` gõ nhầm sang thư mục bất kỳ trên VPS).
#   --dry-run         chạy bước 0 (chỉ đọc) rồi IN kế hoạch bốn bước, không scp/ssh/docker save.
# Biến môi trường `RELEASE_SSH_OPTS`: tùy chọn ssh/scp thêm (vd `-i ~/.ssh/prod -o Port=2222 -o StrictHostKeyChecking=yes`), đặt TRƯỚC mặc định
# nên thắng khi trùng khóa; mặc định `-o BatchMode=yes -o ConnectTimeout=15 -o ServerAliveInterval=30 -o ServerAliveCountMax=6`. Cổng dùng
# `-o Port=` (scp và ssh khác cờ `-p`/`-P`). Host luôn đứng sau `--` nên không thể bị hiểu thành tùy chọn.
# CẢNH BÁO BẢO MẬT: RELEASE_SSH_OPTS được tách theo khoảng trắng và đưa thẳng cho ssh/scp (vd `-o ProxyCommand=...` chạy lệnh tùy ý trên máy này),
# nên CHỈ đặt từ nguồn tin cậy (shell của chính bạn, biến/secret do người quản trị CI đặt); KHÔNG nhận từ input ngoài (tham số PR, form, tên nhánh...).
# Lần ssh ĐẦU tới VPS mới: mặc định BatchMode=yes nên host chưa có trong known_hosts sẽ bị từ chối (không có câu hỏi yes/no). Cách xử lý:
# chạy `ssh-keyscan -H <host> >> ~/.ssh/known_hosts` rồi ĐỐI CHIẾU fingerprint với nguồn tin cậy, hoặc đặt
# RELEASE_SSH_OPTS='-o StrictHostKeyChecking=accept-new' chỉ cho lần đầu (tin ngay khóa gặp lần đầu, có rủi ro MITM). Sau đó bỏ đi.
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
  ./release.sh send --to <ssh-host> [--dir <thư-mục-deploy-trên-VPS>] [--init] [--dry-run]

  send: gửi gói + image đã build (KHÔNG phải bản --local) lên VPS qua ssh rồi chạy deploy.sh; --dir mặc định RealEstateManager
  (tương đối HOME của tài khoản ssh); --init cho lần cài đầu (tạo thư mục deploy); --dry-run chỉ in kế hoạch. Tùy chọn ssh: RELEASE_SSH_OPTS.
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

# ── send (T-32) ──────────────────────────────────────────────────────────────
readonly DEFAULT_REMOTE_DIR="RealEstateManager"
readonly HOST_RE='^[A-Za-z0-9_][A-Za-z0-9._@-]*$'            # không cho bắt đầu bằng `-` (ssh sẽ hiểu là tùy chọn), không `:`/khoảng trắng/`;`/`$`...
readonly REMOTE_DIR_RE='^[A-Za-z0-9_/][A-Za-z0-9_./-]*$'
readonly REMOTE_TMP_RE='^/[A-Za-z0-9_./-]+/release-send\.[A-Za-z0-9]+$'
readonly TAG_RE='^[0-9A-Za-z][0-9A-Za-z._-]*$'
readonly IMAGE_ID_RE='^sha256:[0-9a-f]{64}$'
# Khâu nhận của pipe nạp image: pipefail để gunzip hỏng không bị `docker load` (đọc được nửa luồng) che mất.
readonly REMOTE_LOAD_CMD="bash -c 'set -o pipefail; gunzip -c | docker load'"

SSH_OPTS=()          # tùy chọn dùng chung cho ssh và scp (dựng ở build_ssh_opts)
SEND_HOST=""         # ssh-host đích
SEND_DIR=""          # thư mục deploy trên VPS
INIT_DIR=0           # --init: tạo thư mục deploy nếu chưa có
SEND_TMP=""          # thư mục tạm trên VPS (chỉ khác rỗng khi ĐÃ tạo và qua kiểm đường dẫn)
BE_REF=""; FE_REF=""; BE_ID_ENV=""; FE_ID_ENV=""

# Bọc một giá trị thành chuỗi nháy đơn an toàn cho shell phía VPS (giá trị đã qua whitelist ký tự; đây là lớp phòng thủ thứ hai).
sq() { local s="$1" q="'" b='\' r; r="${s//$q/$q$b$q$q}"; printf "'%s'" "$r"; }

# Đọc giá trị một khóa của release.env (file KHÔNG được `source`: chỉ lấy dòng KEY=...).
env_get() { sed -n "s/^$1=//p" "$ROOT_DIR/$OUT_ENV" | head -n 1 | tr -d '\r'; }

# Báo lỗi một bước của send: $1 nhãn bước, $2 lý do, $3 lệnh kế tiếp gợi ý. Dừng ngay, không rollback.
send_fail() {
  die "Bước $1 THẤT BẠI: $2
Đã DỪNG tại đây: KHÔNG tự rollback, KHÔNG chạy bước kế tiếp (phần đã làm ở các bước trước vẫn nguyên trên VPS).
Lệnh kế tiếp gợi ý: $3"
}

# Dựng SSH_OPTS: RELEASE_SSH_OPTS đứng TRƯỚC mặc định (ssh lấy giá trị đầu tiên cho mỗi khóa -o nên bên người dùng thắng).
build_ssh_opts() {
  local -a user_opts=()
  if [[ -n "${RELEASE_SSH_OPTS:-}" ]]; then read -r -a user_opts <<<"$RELEASE_SSH_OPTS"; fi
  SSH_OPTS=("${user_opts[@]}" -o BatchMode=yes -o ConnectTimeout=15 -o ServerAliveInterval=30 -o ServerAliveCountMax=6)
}

# ssh tới VPS với lệnh một dòng ($1); host luôn đứng sau `--`. Không đọc stdin của script (</dev/null).
ssh_cmd() { ssh "${SSH_OPTS[@]}" -- "$SEND_HOST" "$1" </dev/null; }

# Chạy một script bash trên VPS: $1 = nội dung script (đưa qua stdin của `bash -s`), các tham số sau thành $1.. của script (đã bọc nháy).
ssh_script() {
  local script="$1" cmd="bash -s --" a
  shift
  for a in "$@"; do cmd+=" $(sq "$a")"; done
  ssh "${SSH_OPTS[@]}" -- "$SEND_HOST" "$cmd" <<<"$script"
}

# Xóa thư mục tạm trên VPS (chỉ khi đã qua kiểm REMOTE_TMP_RE). Lỗi dọn chỉ cảnh báo.
remote_tmp_cleanup() {
  [[ -n "$SEND_TMP" ]] || return 0
  local t="$SEND_TMP"
  SEND_TMP=""
  ssh_cmd "rm -rf -- $(sq "$t")" >/dev/null 2>&1 || warn "Không dọn được thư mục tạm $t trên VPS: xóa tay (chỉ chứa bản sao gói release, không có bí mật)."
}

send_on_exit() {
  local rc=$?
  trap - EXIT
  remote_tmp_cleanup
  exit "$rc"
}

# ── Bước 0: kiểm cục bộ, chỉ đọc, không chạm mạng ────────────────────────────
send_preflight() {
  local env_file="$ROOT_DIR/$OUT_ENV" flag ver
  [[ -f "$env_file" ]] || die "Chưa có $OUT_ENV: chạy './release.sh build' trước."

  # Bản -local/-dirty KHÔNG BAO GIỜ được gửi: kiểm TRƯỚC mọi thứ khác (cả khi thiếu cờ RELEASE_LOCAL nhưng tag đã -local).
  flag="$(env_get RELEASE_LOCAL)"
  if [[ "$flag" == "1" ]] || grep -qE '^[A-Z_]+_IMAGE_TAG=.*-local[[:space:]]*$' "$env_file" || grep -qE '^GIT_COMMIT=.*-dirty[[:space:]]*$' "$env_file"; then
    die "TỪ CHỐI gửi: đây là bản --local (tag -local hoặc cây bẩn), không bao giờ được gửi. Build lại từ cây git sạch đã push (không --local)."
  fi
  [[ "$flag" == "0" ]] || die "$OUT_ENV có RELEASE_LOCAL=[$flag] (mong đợi 0): file hỏng hoặc không do release.sh build sinh ra. Build lại."

  ver="$(env_get RELEASE_VERSION)"
  [[ "$ver" =~ $SEMVER_RE ]] || die "$OUT_ENV có RELEASE_VERSION không hợp lệ: [$ver]. Build lại."
  [[ "$(env_get BACKEND_IMAGE_NAME)" == "$BACKEND_IMAGE_NAME" && "$(env_get FRONTEND_IMAGE_NAME)" == "$FRONTEND_IMAGE_NAME" ]] \
    || die "Tên image trong $OUT_ENV không phải $BACKEND_IMAGE_NAME/$FRONTEND_IMAGE_NAME. Build lại."
  local be_tag fe_tag
  be_tag="$(env_get BACKEND_IMAGE_TAG)"; fe_tag="$(env_get FRONTEND_IMAGE_TAG)"
  [[ "$be_tag" =~ $TAG_RE && "$fe_tag" =~ $TAG_RE ]] || die "Tag image trong $OUT_ENV không hợp lệ: [$be_tag] [$fe_tag]. Build lại."
  BE_ID_ENV="$(env_get BACKEND_IMAGE_ID)"; FE_ID_ENV="$(env_get FRONTEND_IMAGE_ID)"
  [[ "$BE_ID_ENV" =~ $IMAGE_ID_RE && "$FE_ID_ENV" =~ $IMAGE_ID_RE ]] || die "Image ID trong $OUT_ENV không đúng dạng sha256:<64 hex>. Build lại."
  BE_REF="$BACKEND_IMAGE_NAME:$be_tag"; FE_REF="$FRONTEND_IMAGE_NAME:$fe_tag"

  [[ -f "$ROOT_DIR/$OUT_TGZ" ]] || die "Thiếu $OUT_TGZ: chạy './release.sh build' trước."
  [[ -f "$ROOT_DIR/$OUT_SHA" ]] || die "Thiếu $OUT_SHA: chạy './release.sh build' trước."
  ( cd "$ROOT_DIR" && sha256sum -c "$OUT_SHA" >/dev/null 2>&1 ) || die "$OUT_TGZ không khớp $OUT_SHA (gói bị sửa hoặc hỏng). Build lại."
  # Gói phải mang đúng release.env đang nằm cạnh nó (tránh ghép release.env của lần build này với gói của lần build khác).
  ( cd "$ROOT_DIR" && tar -xzOf "$OUT_TGZ" "$OUT_ENV" 2>/dev/null | cmp -s - "$OUT_ENV" ) || die "$OUT_ENV trong $OUT_TGZ khác $OUT_ENV cạnh nó (hai lần build lẫn nhau). Build lại."

  # Image phải CÓ trên máy này và đúng ID đã ghi lúc build (tag bị gắn lại/đã xóa/build lại thì ID đổi).
  local id
  id="$(image_id "$BE_REF")"; [[ "$id" == "$BE_ID_ENV" ]] || die "Image $BE_REF có ID $id, khác $BE_ID_ENV trong $OUT_ENV. Build lại."
  id="$(image_id "$FE_REF")"; [[ "$id" == "$FE_ID_ENV" ]] || die "Image $FE_REF có ID $id, khác $FE_ID_ENV trong $OUT_ENV. Build lại."
}

# In kế hoạch (dry-run): đúng các lệnh sẽ chạy, không có bí mật.
send_print_plan() {
  local opts="${SSH_OPTS[*]}"
  log "[dry-run] Bước 0 (kiểm cục bộ) đạt. Kế hoạch gửi $BE_REF và $FE_REF tới $SEND_HOST, thư mục deploy '$SEND_DIR' (KHÔNG chạy gì):"
  log "[dry-run] (1/4) ssh -- $SEND_HOST 'mktemp -d …/release-send.XXXXXX'; scp $OUT_TGZ $OUT_SHA -> thư mục tạm; ssh: sha256sum -c; ssh: giải nén ops/install-release.sh từ gói rồi chạy với --dir '$SEND_DIR'$( ((INIT_DIR)) && echo ' (tạo thư mục nếu chưa có: --init)' ); xóa thư mục tạm"
  log "[dry-run] (2/4) ssh -- $SEND_HOST 'cd $SEND_DIR && bash ops/check-disk.sh'"
  log "[dry-run] (3/4) docker save $BE_REF $FE_REF | gzip -c | ssh -- $SEND_HOST \"$REMOTE_LOAD_CMD\"; rồi ssh kiểm hai tag đã có trên VPS"
  log "[dry-run] (4/4) ssh -- $SEND_HOST 'cd $SEND_DIR && ./deploy.sh'"
  log "[dry-run] Tùy chọn ssh/scp: $opts"
}

# ── Bước 1: gửi gói, xác minh sha256 phía VPS, cài bằng bộ cài trong gói ──────
send_step1_install() {
  local out hint="./release.sh send --to $SEND_HOST --dir $SEND_DIR (chạy lại được: bước 1 idempotent; kiểm ssh tay: ssh $SEND_HOST)"
  log "(1/4) Gửi $OUT_TGZ + $OUT_SHA tới $SEND_HOST và cài vào '$SEND_DIR' ..."

  out="$(ssh_cmd 'umask 077 && mktemp -d "${TMPDIR:-/tmp}/release-send.XXXXXX"')" \
    || send_fail "1 (tạo thư mục tạm trên VPS)" "ssh/mktemp lỗi." "$hint"
  out="$(printf '%s' "$out" | tr -d '\r' | tail -n 1)"
  [[ "$out" =~ $REMOTE_TMP_RE && "$out" != *..* ]] || send_fail "1 (tạo thư mục tạm trên VPS)" "đường dẫn thư mục tạm VPS trả về không hợp lệ: [${out:0:120}]." "$hint"
  SEND_TMP="$out"

  ( cd "$ROOT_DIR" && scp "${SSH_OPTS[@]}" -- "$OUT_TGZ" "$OUT_SHA" "$SEND_HOST:$SEND_TMP/" </dev/null ) \
    || send_fail "1 (scp gói lên VPS)" "scp lỗi." "$hint"

  ssh_script 'set -euo pipefail
cd -- "$1"
sha256sum -c release.tgz.sha256' "$SEND_TMP" \
    || send_fail "1 (xác minh sha256 phía VPS)" "gói trên VPS không khớp .sha256 (hỏng khi truyền?). Chưa cài gì." "$hint"

  # Bộ cài lấy từ CHÍNH gói (giải nén DUY NHẤT hai file theo tên, không giải nén cả gói) rồi chạy với --dir tuyệt đối; bộ cài tự kiểm lại
  # sha256, danh sách gói và hoán đổi có journal. Thư mục deploy phải có sẵn, trừ khi --init (lần cài đầu).
  ssh_script 'set -euo pipefail
dir="$1"; init="$2"; tmp="$3"
if [[ ! -d "$dir" ]]; then
  if [[ "$init" == "1" ]]; then mkdir -p -- "$dir"; else echo "Thư mục deploy [$dir] chưa có trên VPS (lần cài đầu: thêm --init)." >&2; exit 3; fi
elif [[ "$init" != "1" && ! -f "$dir/deploy.sh" && ! -f "$dir/.env" ]]; then
  echo "Thư mục [$dir] có sẵn nhưng không giống thư mục deploy (thiếu deploy.sh và .env): sai --dir? Lần cài đầu vào thư mục rỗng: thêm --init." >&2; exit 5
fi
dir_abs="$(cd -- "$dir" && pwd -P)"
cd -- "$tmp"
tar -xzf release.tgz --no-same-owner --no-same-permissions ops/install-release.sh ops/lib/ops-common.sh
for f in ops/install-release.sh ops/lib/ops-common.sh; do
  [[ -f "$f" && ! -L "$f" ]] || { echo "Bộ cài trong gói không hợp lệ: $f" >&2; exit 4; }
done
bash ops/install-release.sh --dir "$dir_abs" --sha256 release.tgz.sha256 release.tgz' "$SEND_DIR" "$INIT_DIR" "$SEND_TMP" \
    || send_fail "1 (cài gói bằng ops/install-release.sh)" "bộ cài trong gói báo lỗi (nếu lỗi nằm trong lúc hoán đổi, bộ cài đã tự hoàn tác về bản cũ)." "$hint"

  remote_tmp_cleanup
  log "(1/4) Đã cài gói vào '$SEND_DIR' trên $SEND_HOST."
}

# ── Bước 2: kiểm đĩa trống trên VPS ───────────────────────────────────────────
send_step2_disk() {
  log "(2/4) Kiểm dung lượng đĩa trên $SEND_HOST ..."
  ssh_script 'set -euo pipefail
cd -- "$1"
bash ops/check-disk.sh' "$SEND_DIR" \
    || send_fail "2 (ops/check-disk.sh trên VPS)" "đĩa VPS không đủ trống hoặc không kiểm được. Chưa nạp image." \
      "dọn đĩa (ssh $SEND_HOST 'docker builder prune -f; docker image prune -f'), rồi ./release.sh send --to $SEND_HOST --dir $SEND_DIR"
}

# ── Bước 3: docker save | gzip | ssh | gunzip | docker load (không registry) ──
send_step3_images() {
  local hint="./release.sh send --to $SEND_HOST --dir $SEND_DIR (chạy lại được: bước 1-2 idempotent, nạp lại image cùng tag là vô hại)"
  local -a rcs=()
  log "(3/4) Nạp $BE_REF và $FE_REF lên $SEND_HOST (docker save | gzip | ssh | gunzip | docker load; có thể mất vài phút) ..."

  # pipefail + kiểm PIPESTATUS từng khâu: ssh trả 0 không đủ để kết luận (docker save/gzip có thể đã chết giữa luồng).
  set -o pipefail
  set +e
  docker save "$BE_REF" "$FE_REF" | gzip -c | ssh "${SSH_OPTS[@]}" -- "$SEND_HOST" "$REMOTE_LOAD_CMD"
  rcs=("${PIPESTATUS[@]}")
  set -e
  local save_rc="${rcs[0]:-1}" gzip_rc="${rcs[1]:-1}" ssh_rc="${rcs[2]:-1}"
  local codes="docker save=$save_rc, gzip=$gzip_rc, ssh(gunzip|docker load)=$ssh_rc"
  # 141 = SIGPIPE: khâu trước chết vì khâu sau đã đóng pipe, nên nguyên nhân gốc nằm ở khâu sau.
  if (( save_rc != 0 && save_rc != 141 )); then
    send_fail "3 (docker save)" "docker save lỗi giữa pipe ($codes); image trên VPS có thể chưa đủ." "$hint"
  elif (( gzip_rc != 0 && gzip_rc != 141 )); then
    send_fail "3 (gzip)" "gzip lỗi giữa pipe ($codes)." "$hint"
  elif (( ssh_rc != 0 )); then
    send_fail "3 (ssh / gunzip / docker load trên VPS)" "phía nhận lỗi ($codes)." "$hint"
  elif (( save_rc != 0 || gzip_rc != 0 )); then
    send_fail "3 (pipe nạp image)" "pipe bị cắt ($codes)." "$hint"
  fi

  # Kiểm lại trên VPS: hai tag đã có (thiếu = lỗi), ID lệch chỉ cảnh báo (containerd, Q-06; deploy.sh kiểm lại theo release.env).
  local listing ref want got
  listing="$(ssh_script 'set -euo pipefail
for ref in "$@"; do
  id="$(docker image inspect -f "{{.Id}}" "$ref")"
  printf "%s %s\n" "$ref" "$id"
done' "$BE_REF" "$FE_REF")" \
    || send_fail "3 (kiểm image đã nạp trên VPS)" "docker load báo xong nhưng VPS không có đủ hai image đúng tag." "$hint"
  for ref in "$BE_REF" "$FE_REF"; do
    got="$(printf '%s\n' "$listing" | tr -d '\r' | awk -v r="$ref" '$1 == r {print $2; exit}')"
    [[ -n "$got" ]] || send_fail "3 (kiểm image đã nạp trên VPS)" "VPS không trả ID cho $ref." "$hint"
    if [[ "$ref" == "$BE_REF" ]]; then want="$BE_ID_ENV"; else want="$FE_ID_ENV"; fi
    if [[ "$got" != "$want" ]]; then warn "ID image $ref trên VPS ($got) khác release.env ($want): thường do containerd (digest manifest); deploy.sh sẽ kiểm lại."; fi
  done
  log "(3/4) Đã nạp hai image lên $SEND_HOST."
}

# ── Bước 4: deploy ────────────────────────────────────────────────────────────
send_step4_deploy() {
  log "(4/4) Chạy ./deploy.sh trong '$SEND_DIR' trên $SEND_HOST ..."
  ssh_script 'set -euo pipefail
cd -- "$1"
exec ./deploy.sh' "$SEND_DIR" \
    || send_fail "4 (./deploy.sh trên VPS)" "deploy.sh thoát khác 0 (xem đầu ra phía trên). KHÔNG tự rollback: nếu stack đã bị đổi, hoàn tác bằng restore.sh theo docs/01_Infrastructure/06_Production_Deploy.md." \
      "sửa nguyên nhân rồi ssh $SEND_HOST 'cd $SEND_DIR && ./deploy.sh' (không cần gửi lại gói/image nếu chúng đã nạp)"
}

cmd_send() {
  local host="" dir="$DEFAULT_REMOTE_DIR" dry_run=0 init_dir=0
  while (( $# > 0 )); do
    case "$1" in
      --to) [[ -n "${2:-}" ]] || die "--to cần một ssh-host."; host="$2"; shift 2 ;;
      --dir) [[ -n "${2:-}" ]] || die "--dir cần một đường dẫn trên VPS."; dir="$2"; shift 2 ;;
      --init) init_dir=1; shift ;;
      --dry-run) dry_run=1; shift ;;
      -h|--help) usage; exit 0 ;;
      *) usage >&2; die "Tham số không hợp lệ cho send: $1" ;;
    esac
  done
  [[ -n "$host" ]] || { usage >&2; die "Thiếu --to <ssh-host>."; }
  # Chống chèn tùy chọn/lệnh vào ssh/scp (vd `-oProxyCommand=...`, `host;rm`, `host:path`): whitelist ký tự, không bắt đầu bằng `-`.
  [[ "$host" =~ $HOST_RE && ${#host} -le 253 ]] || die "ssh-host không hợp lệ: [${host:0:80}] (chỉ cho chữ, số, . _ @ -; không bắt đầu bằng '-')."
  [[ "$dir" =~ $REMOTE_DIR_RE && "$dir" != *..* && "$dir" != "/" && ${#dir} -le 200 ]] \
    || die "--dir không hợp lệ: [${dir:0:80}] (chỉ cho chữ, số, . _ / -; không '..', không bắt đầu bằng '-', không '~')."
  SEND_HOST="$host"; SEND_DIR="$dir"; INIT_DIR="$init_dir"

  local c
  for c in docker tar sha256sum cmp sed awk; do command -v "$c" >/dev/null 2>&1 || die "Thiếu lệnh '$c'."; done
  if (( ! dry_run )); then for c in ssh scp gzip; do command -v "$c" >/dev/null 2>&1 || die "Thiếu lệnh '$c'."; done; fi
  cd "$ROOT_DIR"

  send_preflight
  build_ssh_opts
  if (( dry_run )); then send_print_plan; return 0; fi

  trap send_on_exit EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM

  send_step1_install
  send_step2_disk
  send_step3_images
  send_step4_deploy
  log "Xong: bản $(env_get RELEASE_VERSION) ($(env_get GIT_COMMIT)) đã gửi và deploy tại $SEND_HOST:$SEND_DIR."
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
