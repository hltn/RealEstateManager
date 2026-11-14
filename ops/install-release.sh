#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# ops/install-release.sh — cài gói phát hành lên máy chạy (VPS/staging) (v1.0.6, T-31, FR-14, FR-21).
#
#   ops/install-release.sh [--dir <thư-mục-deploy>] [--sha256 <file>] <release.tgz>
#
#   --dir      thư mục deploy cần cập nhật (mặc định: thư mục gốc chứa script này, tức cha của ops/).
#              Khi chạy bộ cài NẰM TRONG GÓI vừa giải nén (cách "gói mới tự mang bộ cài của nó") thì PHẢI truyền --dir.
#   --sha256   file checksum (mặc định: <release.tgz>.sha256, định dạng của `sha256sum`). KHÔNG có cách bỏ qua bước kiểm này.
#
# Các bước (dừng ở lỗi đầu tiên, lỗi trước bước hoán đổi thì thư mục deploy giữ NGUYÊN):
#   1. Sao gói vào thư mục tạm (cùng filesystem với thư mục deploy) rồi kiểm sha256 trên BẢN SAO đó.
#   2. Kiểm DANH SÁCH nội dung gói TRƯỚC khi giải nén: chỉ file thường và thư mục (cấm symlink/hardlink/thiết bị), không đường dẫn
#      tuyệt đối/`..`/`.`/`//`/ổ đĩa/ký tự thoát, mọi mục cấp 1 phải thuộc whitelist, đủ cả 7 mục whitelist, không trùng tên,
#      không đường dẫn kiểu .env/backups/logs/*.dump/*.pem/*.key kể cả nằm dưới ops/ hoặc scripts/.
#   3. Giải nén vào thư mục tạm, kiểm lại cây đã giải nén (không symlink, không file lạ), `chmod +x` mọi `*.sh` của whitelist.
#   4. Hoán đổi TỪNG mục whitelist bằng `mv` (rename nguyên tử trong cùng filesystem): mục cũ -> thư mục tạm `old/`, mục mới -> chỗ cũ.
#      Có nhật ký (journal) từng mục. Lỗi giữa chừng (kể cả Ctrl-C/kill thường) thì tự hoàn tác về đúng bản cũ.
#   5. Xóa thư mục tạm.
#
# Whitelist (khớp WHITELIST + release.env của release.sh; ops/tests/install-release.test.sh có ca canh lệch):
#   docker-compose.yml deploy.sh backup.sh restore.sh release.env ops/ scripts/
# KHÔNG BAO GIỜ chạm `.env`, `backups/`, `logs/` (hay bất cứ thứ gì ngoài whitelist, ví dụ .env.docker, release.tgz).
# Chạy lại với cùng gói cho cùng kết quả (idempotent). Không in nội dung file; chỉ in đường dẫn và version/commit trong release.env.
#
# Khôi phục khi tiến trình bị kill -9/mất điện giữa lúc hoán đổi: thư mục `<deploy>/.install-release.tmp.*` còn lại chứa `old/` (bản cũ)
# và `journal`. Lần chạy kế tiếp của script này TỰ hoàn tác từ journal trước khi cài; nếu cần làm tay: với mỗi dòng "<mục> 1" trong
# journal, xóa `<deploy>/<mục>` rồi `mv <tmp>/old/<mục> <deploy>/<mục>`; dòng "<mục> 0" thì xóa `<deploy>/<mục>`.
# Khóa chống chạy chồng: thư mục `<deploy>/.install-release.lock.d` (kèm pid); nếu tiến trình giữ khóa đã chết thì khóa được thu hồi.
# Không chặn được deploy.sh đang chạy cùng lúc (việc của khóa deploy): đừng cài gói khi deploy/restore đang chạy.
#
# Phạm vi hỗ trợ: GNU userland (tar/find/sha256sum/readlink/mktemp, cần `tar --quoting-style`, `--no-same-permissions`, `find -printf`) và bash >= 4
# (mapfile, mảng kết hợp) trên Ubuntu/Debian. KHÔNG hỗ trợ busybox/Alpine/macOS (BSD tar/find).
# Hạn chế đã biết (chấp nhận, hiếm gặp trên VPS một người vận hành): (1) race thu hồi khóa cũ: hai lần chạy cùng thấy khóa chết thì `mv`
# chọn một bên thắng, nhưng bên thua có thể kịp `mkdir` giữa lúc bên thắng xóa khóa cũ; (2) `kill -0` trả EPERM (pid của user khác còn sống)
# bị coi là "đã chết" nên khóa bị thu hồi nhầm; chạy bộ cài chỉ bằng MỘT tài khoản (root/ubuntu) thì không gặp.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

LOG_PREFIX="install"
_self="$(readlink -f -- "${BASH_SOURCE[0]}" 2>/dev/null || true)"
[[ -n "$_self" && -f "$_self" ]] || { echo "[install] LỖI: không resolve được đường dẫn thật của install-release.sh (cần readlink -f)." >&2; exit 1; }
ROOT_DIR="$(cd "$(dirname "$_self")/.." && pwd)"
# shellcheck source=ops/lib/ops-common.sh
source "$ROOT_DIR/ops/lib/ops-common.sh"

# Mục cấp 1 của gói. Thứ tự hoán đổi: thư mục trước, release.env CUỐI CÙNG (deploy.sh đọc nó).
readonly WL_DIRS=(ops scripts)
readonly WL_FILES=(docker-compose.yml deploy.sh backup.sh restore.sh release.env)
readonly ITEMS=("${WL_DIRS[@]}" "${WL_FILES[@]}")
# Tên KHÔNG BAO GIỜ được nằm trong whitelist (kiểm lúc chạy, phòng sửa nhầm danh sách).
readonly PROTECTED=(.env backups logs)
# Đường dẫn trông như bí mật/dump bị từ chối kể cả khi nằm trong mục whitelist (cùng quy tắc FORBIDDEN_PATH_RE của release.sh; `*.example` được phép).
readonly FORBIDDEN_PATH_RE='(^|/)\.env(\.[^/]*)?$|(^|/)(backups|logs)/|\.(dump|archive|bson|pem|key)$'
readonly TMP_PREFIX=".install-release.tmp"
readonly LOCK_NAME=".install-release.lock.d"

DEPLOY=""        # thư mục deploy (đường dẫn tuyệt đối)
WORK=""          # thư mục tạm của lần chạy này
LOCK_HELD=0

usage() {
  cat <<'EOF'
Cách dùng:
  ops/install-release.sh [--dir <thư-mục-deploy>] [--sha256 <file>] <release.tgz>

Cài gói phát hành (release.tgz sinh bởi release.sh build) vào thư mục deploy: kiểm .sha256, hoán đổi từng mục whitelist
(docker-compose.yml deploy.sh backup.sh restore.sh release.env ops/ scripts/). Không bao giờ chạm .env, backups/, logs/.
EOF
}

# $1 có thuộc danh sách còn lại không.
in_list() { local x="$1"; shift; local y; for y in "$@"; do [[ "$x" == "$y" ]] && return 0; done; return 1; }

# Tự kiểm: whitelist không được chứa tên bảo vệ.
assert_whitelist_safe() {
  local p
  for p in "${PROTECTED[@]}"; do
    ! in_list "$p" "${ITEMS[@]}" || die "Nội bộ: whitelist chứa mục bảo vệ '$p'."
  done
}

# ── Khóa chống chạy chồng (mkdir nguyên tử; thu hồi khi pid giữ khóa đã chết) ─────────────────────────────────────────────
acquire_install_lock() {
  local lock="$DEPLOY/$LOCK_NAME" pid stale
  if ! mkdir -- "$lock" 2>/dev/null; then
    pid="$(cat "$lock/pid" 2>/dev/null || true)"
    if [[ "$pid" =~ ^[0-9]+$ ]] && ! kill -0 "$pid" 2>/dev/null; then
      stale="$lock.stale.$$"
      # mv nguyên tử: nếu hai tiến trình cùng thấy khóa chết thì chỉ một bên thắng.
      mv -- "$lock" "$stale" 2>/dev/null && rm -rf -- "$stale"
      warn "Thu hồi khóa cài đặt cũ (pid $pid không còn chạy)."
      mkdir -- "$lock" 2>/dev/null || die "Không lấy được khóa cài đặt $lock (đang có lần cài khác?)."
    else
      die "Đang có lần cài khác chạy (khóa $lock${pid:+, pid $pid}). Nếu chắc chắn không có, xóa thư mục khóa đó rồi chạy lại."
    fi
  fi
  LOCK_HELD=1
  printf '%s\n' "$$" > "$lock/pid"
}

release_install_lock() {
  (( LOCK_HELD )) || return 0
  rm -rf -- "${DEPLOY:?}/$LOCK_NAME"
  LOCK_HELD=0
}

# ── Hoàn tác từ journal của một thư mục tạm ($1) ─────────────────────────────────────────────────────────────────────────
# Mỗi dòng journal: "<mục> <had>" (had=1: đã có bản cũ trong thư mục deploy). Duyệt NGƯỢC. Chỉ động tới mục thuộc whitelist.
rollback_work() {
  local work="$1" line item had i
  local -a lines=()
  [[ -f "$work/journal" ]] || return 0
  mapfile -t lines < "$work/journal"
  for (( i = ${#lines[@]} - 1; i >= 0; i-- )); do
    line="${lines[$i]%$'\r'}"
    item="${line% *}"; had="${line##* }"
    in_list "$item" "${ITEMS[@]}" || { warn "Journal có mục lạ '$item': bỏ qua."; continue; }
    if [[ "$had" == "1" ]]; then
      if [[ -e "$work/old/$item" || -L "$work/old/$item" ]]; then
        # từng lệnh kiểm mã thoát tường minh (hàm này thường được gọi trong ngữ cảnh `if`/`||`, nơi `set -e` không có tác dụng).
        rm -rf -- "${DEPLOY:?}/${item:?}" || return 1
        mv -- "$work/old/$item" "$DEPLOY/$item" || return 1
      fi
      # old/<mục> không còn: bản cũ chưa bị dời, thư mục deploy vẫn nguyên.
    else
      rm -rf -- "${DEPLOY:?}/${item:?}" || return 1
    fi
  done
  return 0
}

# Dọn/hoàn tác các thư mục tạm còn sót từ lần chạy trước (đã giữ khóa, nên không ai đang dùng chúng).
recover_stale() {
  local d
  for d in "$DEPLOY"/"$TMP_PREFIX".*; do
    [[ -d "$d" && "$d" != "$WORK" ]] || continue
    if [[ "$(cat "$d/state" 2>/dev/null || true)" == "swapping" ]]; then
      warn "Phát hiện lần cài dở dang ($d): hoàn tác về bản cũ trước khi cài."
      rollback_work "$d" || die "Hoàn tác lần cài dở dang thất bại. Làm tay theo hướng dẫn ở đầu ops/install-release.sh; bản cũ nằm ở $d/old/."
    fi
    rm -rf -- "$d"
  done
}

# Chạy khi thoát (kể cả lỗi/INT/TERM): hoàn tác nếu đang hoán đổi dở, dọn thư mục tạm, nhả khóa.
on_exit() {
  local rc=$?
  trap - EXIT
  if [[ -n "$WORK" && -d "$WORK" ]]; then
    if [[ "$(cat "$WORK/state" 2>/dev/null || true)" == "swapping" ]]; then
      warn "Lỗi giữa lúc hoán đổi: hoàn tác về bản cũ ..."
      if rollback_work "$WORK"; then
        log "Đã hoàn tác: thư mục deploy giữ nguyên bản cũ."
        rm -rf -- "$WORK"
      else
        warn "HOÀN TÁC THẤT BẠI. Bản cũ còn ở $WORK/old/ (journal: $WORK/journal). Làm tay theo hướng dẫn ở đầu ops/install-release.sh."
        rc=1
      fi
    else
      rm -rf -- "$WORK"
    fi
  fi
  release_install_lock
  exit "$rc"
}

# ── Kiểm checksum ($1 = bản sao gói, $2 = file .sha256) ──────────────────────────────────────────────────────────────────
verify_checksum() {
  local pkg="$1" sha_file="$2" expected actual
  [[ -f "$sha_file" ]] || die "Thiếu file checksum: $sha_file (không có cách bỏ qua bước kiểm này)."
  expected="$(head -n 1 "$sha_file" | tr -d '\r' | awk '{print $1}' | tr 'A-F' 'a-f')"
  [[ "$expected" =~ ^[0-9a-f]{64}$ ]] || die "File checksum không đúng định dạng sha256sum: $sha_file."
  actual="$(sha256sum -- "$pkg" | awk '{print $1}')"
  [[ "$actual" == "$expected" ]] || die "SAI checksum: gói không khớp $sha_file (mong đợi $expected, thực tế $actual). Không cài gì."
  log "Checksum khớp ($actual)."
}

# ── Kiểm DANH SÁCH nội dung gói trước khi giải nén ($1 = bản sao gói) ────────────────────────────────────────────────────
validate_listing() {
  local pkg="$1" n_names n_types i name type perm top is_dir
  local -a names=() types=() files=()
  local -A seen=()
  # --quoting-style=escape: ký tự lạ (xuống dòng, điều khiển, `\`) thành chuỗi thoát chứa `\` nên bị từ chối bên dưới, mỗi mục đúng một dòng.
  tar --quoting-style=escape -tzf "$pkg" > "$WORK/names.txt" 2>"$WORK/tar.err" || die "Không đọc được gói (tar -t lỗi): $(head -c 300 "$WORK/tar.err")"
  # 10 ký tự đầu mỗi dòng `tar -tv` = kiểu (1) + quyền rwxrwxrwx (9): dùng để chặn setuid/setgid/sticky bên dưới.
  tar --quoting-style=escape -tvzf "$pkg" 2>/dev/null | cut -c1-10 > "$WORK/types.txt" || die "Không đọc được kiểu từng mục của gói (tar -tv lỗi)."
  mapfile -t names < "$WORK/names.txt"
  mapfile -t types < "$WORK/types.txt"
  n_names=${#names[@]}; n_types=${#types[@]}
  (( n_names > 0 )) || die "Gói rỗng."
  (( n_names == n_types )) || die "Không đọc được kiểu từng mục của gói (tar -tv lệch tar -t: $n_names/$n_types)."

  for (( i = 0; i < n_names; i++ )); do
    name="${names[$i]}"; type="${types[$i]:0:1}"; perm="${types[$i]:1:9}"
    case "$type" in
      -) is_dir=0 ;;
      d) is_dir=1 ;;
      l) die "Gói chứa symlink (từ chối): $name" ;;
      h) die "Gói chứa hardlink (từ chối): $name" ;;
      *) die "Gói chứa mục không phải file thường/thư mục (kiểu '$type', từ chối): $name" ;;
    esac
    [[ -n "$name" ]] || die "Gói chứa mục tên rỗng."
    # setuid/setgid/sticky (s, S, t, T trong cột quyền): bộ cài chạy bằng root nên giải nén sẽ giữ nguyên các bit này -> từ chối.
    [[ "$perm" =~ ^[-rwxsStT]{9}$ ]] || die "Không đọc được cột quyền của mục trong gói ('$perm'): $name"
    [[ "$perm" != *[sStT]* ]] || die "Gói chứa mục có bit setuid/setgid/sticky (từ chối): $name"
    if (( is_dir )); then
      [[ "$name" == */ ]] || die "Mục thư mục không kết thúc bằng '/': $name"
      name="${name%/}"
    else
      [[ "$name" != */ ]] || die "File thường mà tên kết thúc bằng '/': $name"
    fi
    [[ -n "$name" ]] || die "Gói chứa mục đường dẫn gốc '/' (từ chối)."
    [[ "$name" != *\\* ]] || die "Gói chứa đường dẫn có ký tự thoát/điều khiển/dấu '\\' (từ chối): $name"
    [[ "$name" != /* ]] || die "Gói chứa đường dẫn tuyệt đối (từ chối): $name"
    [[ ! "$name" =~ ^[A-Za-z]: ]] || die "Gói chứa đường dẫn kiểu ổ đĩa (từ chối): $name"
    [[ ! "$name" =~ (^|/)\.\.?(/|$) ]] || die "Gói chứa đường dẫn có thành phần '.' hoặc '..' (từ chối): $name"
    [[ "$name" != *//* ]] || die "Gói chứa đường dẫn có '//' (từ chối): $name"

    top="${name%%/*}"
    in_list "$top" "${ITEMS[@]}" || die "Gói chứa mục NGOÀI whitelist (từ chối): $name"
    if [[ "$name" =~ $FORBIDDEN_PATH_RE && "$name" != *.example ]]; then die "Gói chứa đường dẫn trông như bí mật/dump (từ chối): $name"; fi
    if in_list "$top" "${WL_FILES[@]}"; then
      [[ "$name" == "$top" && $is_dir -eq 0 ]] || die "Mục '$top' phải là một file thường, nhưng gói có: $name"
    else
      # mục thư mục whitelist: chỉ chấp nhận `<top>/` hoặc nội dung bên dưới; một file thường tên đúng `<top>` là sai kiểu.
      if [[ "$name" == "$top" ]]; then
        (( is_dir )) || die "Mục '$top' phải là thư mục, nhưng gói có file thường cùng tên."
      fi
    fi
    if (( ! is_dir )); then files+=("$name"); seen[$top]=1; fi
  done

  for top in "${ITEMS[@]}"; do
    [[ -n "${seen[$top]:-}" ]] || die "Gói thiếu mục whitelist bắt buộc: $top (gói không đầy đủ, từ chối để không để lại bản cài nửa vời)."
  done
  if [[ -n "$(printf '%s\n' "${files[@]}" | LC_ALL=C sort | uniq -d)" ]]; then
    die "Gói có file trùng tên (mơ hồ, từ chối): $(printf '%s\n' "${files[@]}" | LC_ALL=C sort | uniq -d | head -n 3 | tr '\n' ' ')"
  fi
  log "Danh sách gói hợp lệ: ${#files[@]} file, toàn bộ nằm trong whitelist."
}

# ── Giải nén + kiểm lại cây ($1 = bản sao gói, $2 = thư mục đích) ────────────────────────────────────────────────────────
extract_and_check() {
  local pkg="$1" new="$2" top bad
  mkdir -p -- "$new"
  tar -xzf "$pkg" -C "$new" --no-same-owner --no-same-permissions 2>"$WORK/tar.err" || die "Giải nén lỗi: $(head -c 300 "$WORK/tar.err")"
  bad="$(find "$new" -mindepth 1 ! -type f ! -type d -print -quit)"
  [[ -z "$bad" ]] || die "Cây giải nén có mục không phải file/thư mục (từ chối): ${bad#"$new"/}"
  while IFS= read -r top; do
    in_list "$top" "${ITEMS[@]}" || die "Cây giải nén có mục ngoài whitelist (từ chối): $top"
  done < <(find "$new" -mindepth 1 -maxdepth 1 -printf '%f\n')
  for top in "${WL_FILES[@]}"; do [[ -f "$new/$top" ]] || die "Sau giải nén thiếu file $top."; done
  for top in "${WL_DIRS[@]}"; do [[ -d "$new/$top" ]] || die "Sau giải nén thiếu thư mục $top/."; done

  # Phòng thủ chiều sâu (validate_listing đã từ chối gói có bit đặc biệt): gỡ setuid/setgid/sticky khỏi cây vừa giải nén rồi kiểm lại.
  find "$new" -exec chmod u-s,g-s,o-t {} +
  bad="$(find "$new" -perm /7000 -print -quit)"
  [[ -z "$bad" ]] || die "Cây giải nén còn bit setuid/setgid/sticky (từ chối): ${bad#"$new"/}"

  # chmod +x mọi *.sh của whitelist ngay trên cây mới (git trên Windows có thể để 644; deploy.sh/backup.sh/restore.sh cần chạy trực tiếp).
  find "$new" -type f -name '*.sh' -exec chmod +x {} +
}

# ── Hoán đổi từng mục ($1 = thư mục mới, $2 = thư mục `old`) ─────────────────────────────────────────────────────────────
swap_items() {
  local new="$1" old="$2" item had
  mkdir -p -- "$old"
  : > "$WORK/journal"
  printf 'swapping\n' > "$WORK/state"
  for item in "${ITEMS[@]}"; do
    if [[ -e "$DEPLOY/$item" || -L "$DEPLOY/$item" ]]; then had=1; else had=0; fi
    printf '%s %s\n' "$item" "$had" >> "$WORK/journal"
    if (( had )); then mv -- "$DEPLOY/$item" "$old/$item"; fi
    mv -- "$new/$item" "$DEPLOY/$item"
  done
  printf 'done\n' > "$WORK/state"
}

main() {
  local pkg="" sha_file="" dir_arg=""
  while (( $# > 0 )); do
    case "$1" in
      --dir) [[ -n "${2:-}" ]] || die "--dir cần một đường dẫn."; dir_arg="$2"; shift 2 ;;
      --sha256) [[ -n "${2:-}" ]] || die "--sha256 cần một đường dẫn."; sha_file="$2"; shift 2 ;;
      -h|--help) usage; exit 0 ;;
      -*) usage >&2; die "Tham số không hợp lệ: $1" ;;
      *) [[ -z "$pkg" ]] || { usage >&2; die "Chỉ nhận MỘT gói, nhưng có thêm: $1"; }; pkg="$1"; shift ;;
    esac
  done
  [[ -n "$pkg" ]] || { usage >&2; die "Thiếu đường dẫn gói release.tgz."; }
  [[ -f "$pkg" ]] || die "Không thấy gói: $pkg"
  [[ -n "$sha_file" ]] || sha_file="$pkg.sha256"

  local c
  for c in tar gzip sha256sum find mktemp awk cut sort uniq; do command -v "$c" >/dev/null 2>&1 || die "Thiếu lệnh '$c'."; done
  assert_whitelist_safe

  DEPLOY="$(cd "${dir_arg:-$ROOT_DIR}" 2>/dev/null && pwd)" || die "Thư mục deploy không tồn tại: ${dir_arg:-$ROOT_DIR}"
  [[ "$DEPLOY" != "/" ]] || die "Từ chối cài vào thư mục gốc '/'."
  [[ -w "$DEPLOY" ]] || die "Không ghi được vào thư mục deploy: $DEPLOY"

  trap on_exit EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM
  acquire_install_lock
  recover_stale

  WORK="$(mktemp -d "$DEPLOY/$TMP_PREFIX.XXXXXX")"
  chmod 700 "$WORK" 2>/dev/null || true
  local pkg_copy="$WORK/release.tgz"
  # Kiểm checksum và giải nén cùng trên MỘT bản sao: file gốc có bị đổi sau khi kiểm cũng không ảnh hưởng.
  cp -- "$pkg" "$pkg_copy"

  log "Cài $pkg vào $DEPLOY ..."
  verify_checksum "$pkg_copy" "$sha_file"
  validate_listing "$pkg_copy"
  extract_and_check "$pkg_copy" "$WORK/new"
  swap_items "$WORK/new" "$WORK/old"

  local ver commit
  ver="$(sed -n 's/^RELEASE_VERSION=//p' "$DEPLOY/release.env" | head -n 1 | tr -d '\r')"
  commit="$(sed -n 's/^GIT_COMMIT=//p' "$DEPLOY/release.env" | head -n 1 | tr -d '\r')"
  log "Đã cài bản ${ver:-?} (${commit:-?}) vào $DEPLOY: ${ITEMS[*]}. Không động tới .env, backups/, logs/."
}

main "$@"
