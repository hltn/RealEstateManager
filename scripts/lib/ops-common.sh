# shellcheck shell=bash
# ─────────────────────────────────────────────────────────────────────────────
# scripts/lib/ops-common.sh — hàm dùng chung cho deploy.sh, scripts/run-migration.sh và scripts/check-disk.sh (DRY).
# File này chỉ được `source`, không chạy trực tiếp. Caller đặt LOG_PREFIX (vd "deploy") TRƯỚC khi source và
# bật `set -euo pipefail`. Không chứa bí mật, không in giá trị biến trong .env.docker.
# ─────────────────────────────────────────────────────────────────────────────

LOG_PREFIX="${LOG_PREFIX:-ops}"
# Thời hạn (giây) cho lệnh `docker exec` kiểm tra backup (mongorestore --dryRun); quá hạn coi là lỗi, không treo vô hạn.
OPS_EXEC_TIMEOUT="${OPS_EXEC_TIMEOUT:-300}"

log()  { printf '[%s] %s\n' "$LOG_PREFIX" "$*"; }
warn() { printf '[%s] CẢNH BÁO: %s\n' "$LOG_PREFIX" "$*" >&2; }
die()  { printf '[%s] LỖI: %s\n' "$LOG_PREFIX" "$*" >&2; exit 1; }

# In MỘT trường của `docker inspect -f <template> <container>`; container không tồn tại (hoặc không đọc được) thì in $3
# (mặc định "missing"). Không dùng `$(docker inspect ... || echo missing)`: khi lỗi, docker vẫn có thể in một dòng TRỐNG ra stdout,
# ghép với "missing" thành "\nmissing" (cảnh báo bị xuống dòng giữa chừng). Docker thoát mã khác 0 thì KHÔNG tin stdout, dùng giá trị
# mặc định; thành công thì chỉ lấy dòng đầu, rỗng cũng rơi về mặc định. `--` đặt trước tên container để tên bắt đầu bằng `-` không
# bị hiểu là cờ.
inspect_field() {
  local v rc=0
  v="$(docker inspect -f "$2" -- "$1" 2>/dev/null)" || rc=$?
  if (( rc != 0 )); then printf '%s' "${3:-missing}"; return 0; fi
  v="${v%%$'\n'*}"
  printf '%s' "${v:-${3:-missing}}"
}

# Quyền (dạng bát phân, vd 600) của một file; hỗ trợ GNU stat (Ubuntu) và BSD stat.
file_mode() { stat -c '%a' "$1" 2>/dev/null || stat -f '%Lp' "$1"; }

# Dừng nếu file env chứa bí mật có quyền rộng hơn 600 (group/other đọc được).
require_private_file() {
  local f="$1" mode
  [[ -f "$f" ]] || die "Không thấy $f."
  mode="$(file_mode "$f")"
  if (( (8#$mode & 8#077) != 0 )); then
    die "$f có quyền $mode, rộng hơn 600 (chứa bí mật). Chạy: chmod 600 $f rồi chạy lại."
  fi
}

# In TÊN các biến có giá trị MẪU (placeholder) trong file env, mỗi tên một dòng. KHÔNG in giá trị.
# Quy tắc (chặt, để KHÔNG báo nhầm mật khẩu/URL hợp lệ có chứa < >):
#   - bỏ dòng chú thích/dòng không phải KEY=VALUE; chú thích cuối dòng chỉ tính khi có KHOẢNG TRẮNG trước `#`
#     (nên `https://x/#frag<z>` giữ nguyên, không bị cắt);
#   - bỏ khoảng trắng hai đầu và cặp nháy bao quanh giá trị;
#   - giá trị là placeholder khi: (1) TOÀN BỘ giá trị là `<...>` (vd `<openssl rand -hex 16>`, `<email-admin>`), hoặc
#     (2) có dạng URL với host mẫu `://<...>` (vd `https://<hostname-file-cong-khai>`), hoặc
#     (3) chứa một cụm `<...>` có khoảng trắng bên trong (vd `abc<openssl rand -hex 8>`).
#   Mật khẩu hex theo tài liệu không chứa < >; mật khẩu lạ như `Ab<c>d9` không khớp quy tắc nào nên không bị chặn.
list_placeholder_vars() {
  local f="$1" line key val
  local re_whole='^[<][^<>]+[>]$' re_url='://[<][^<>]+[>]' re_space='[<][^<>]*[[:space:]][^<>]*[>]'
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%$'\r'}"
    [[ "$line" =~ ^[[:space:]]*([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]] || continue
    key="${BASH_REMATCH[1]}"; val="${BASH_REMATCH[2]}"
    val="$(sed -E 's/[[:space:]]+#.*$//; s/^[[:space:]]+//; s/[[:space:]]+$//' <<<"$val")"
    if [[ "$val" =~ ^\"(.*)\"$ || "$val" =~ ^\'(.*)\'$ ]]; then val="${BASH_REMATCH[1]}"; fi
    # Dùng [<] [>] (không dùng \< \>: trong regex GNU đó là neo biên từ, không phải ký tự).
    if [[ "$val" =~ $re_whole || "$val" =~ $re_url || "$val" =~ $re_space ]]; then
      printf '%s\n' "$key"
    fi
  done < "$f"
}

# Dừng nếu .env.docker còn giá trị mẫu (chưa điền). CHỈ in tên biến, không in giá trị.
require_no_placeholders() {
  local names
  names="$(list_placeholder_vars "$1" | sort -u | paste -sd ' ' -)"
  if [[ -n "$names" ]]; then
    die "$1 còn giá trị mẫu (placeholder dạng <...>) ở biến: $names (đối chiếu .env.docker.example)."
  fi
}

# Dừng khi dung lượng trống của thư mục repo hoặc của thư mục dữ liệu Docker thấp hơn ngưỡng (GB).
# Không đọc được (vd /var/lib/docker không có quyền) thì cảnh báo và bỏ qua mục đó, không chặn.
require_free_disk_gb() {
  local min_gb="$1" p avail_kb docker_root failed=0
  [[ "$min_gb" =~ ^[0-9]+$ ]] || die "Ngưỡng dung lượng tối thiểu phải là số nguyên GB (nhận '$min_gb')."
  local min_kb=$(( min_gb * 1024 * 1024 ))
  local -a paths=("$PWD")
  docker_root="$(docker info -f '{{.DockerRootDir}}' 2>/dev/null || true)"
  [[ -z "$docker_root" ]] || paths+=("$docker_root")
  for p in "${paths[@]}"; do
    avail_kb="$(df -Pk "$p" 2>/dev/null | awk 'NR==2 {print $4}' || true)"
    if [[ ! "$avail_kb" =~ ^[0-9]+$ ]]; then
      warn "Không đọc được dung lượng trống của $p (thiếu quyền?): bỏ qua kiểm tra mục này."
      continue
    fi
    if (( avail_kb < min_kb )); then
      warn "$p chỉ còn $(( avail_kb / 1024 )) MB trống, thấp hơn ngưỡng ${min_gb} GB."
      failed=1
    fi
  done
  if (( failed == 1 )); then
    docker system df >&2 || true
    die "Không đủ dung lượng đĩa. Dọn bớt rồi chạy lại: docker builder prune -f (build cache, thường chiếm nhiều nhất) ; docker image prune -f ; xóa thẻ cũ realestatemanager-backend:pre-* và image realestate-migrate (xem tài liệu mục 5.7). Hạ ngưỡng bằng biến môi trường chỉ khi chắc chắn."
  fi
}

# Kiểm tra file backup mongodump là bản sao lưu DB `realestate` DÙNG ĐƯỢC, không chỉ đúng định dạng:
#   1) là file thường, > 0 byte; 2) gzip -t qua; 3) `mongorestore --dryRun -v` (CHỈ ĐỌC, không ghi gì) trong container
#   mongo đọc được archive và liệt kê namespace `realestate.users`. Bước 3 có thời hạn OPS_EXEC_TIMEOUT giây.
#   Tham số thứ 3 trở đi (tùy chọn): tên collection BẮT BUỘC có thêm trong archive (vd raw_articles news_articles), dùng khi
#   migration sẽ ghi/xóa ở các collection đó: backup cắt --nsInclude realestate.users sẽ bị từ chối.
# Mật khẩu root lấy từ biến môi trường trong container và đưa cho mongorestore qua pipe (process substitution),
# không nằm trên dòng lệnh. Trả 0 nếu hợp lệ; ngược lại in lý do ra stderr và trả 1 (caller quyết định dừng).
verify_backup_archive() {
  local f="$1" mongo="${2:-realestate_mongo}" out rc coll
  local -a extra_colls=("${@:3}")
  if [[ ! -f "$f" || ! -s "$f" ]]; then
    warn "Backup '$f' không tồn tại hoặc rỗng (0 byte)."
    return 1
  fi
  if ! gzip -t "$f" 2>/dev/null; then
    warn "Backup '$f' không phải gzip hợp lệ (hỏng/cụt)."
    return 1
  fi
  # shellcheck disable=SC2016  # biến phải được mở rộng BÊN TRONG container, nên dùng nháy đơn có chủ ý
  local restore_cmd='mongorestore --config <(printf "password: %s\n" "$MONGO_INITDB_ROOT_PASSWORD") -u "$MONGO_INITDB_ROOT_USERNAME" --authenticationDatabase admin --dryRun -v --archive --gzip --nsInclude "realestate.*" 2>&1'
  rc=0
  out="$(timeout "$OPS_EXEC_TIMEOUT" docker exec -i "$mongo" bash -c "$restore_cmd" < "$f")" || rc=$?
  if (( rc == 124 )); then
    warn "mongorestore --dryRun quá ${OPS_EXEC_TIMEOUT}s khi đọc '$f' (Mongo quá tải/treo?). Tăng OPS_EXEC_TIMEOUT hoặc kiểm tra container $mongo."
    return 1
  fi
  if (( rc != 0 )); then
    warn "mongorestore --dryRun không đọc được '$f' (không phải archive mongodump hợp lệ, hoặc container $mongo không chạy/không xác thực được). Dòng cuối: $(printf '%s' "$out" | tail -n 2 | tr '\n' ' ')"
    return 1
  fi
  if ! grep -qF 'archive prelude `realestate.users`' <<<"$out"; then
    warn "Backup '$f' không chứa namespace realestate.users (không phải dump của DB realestate, hoặc DB chưa có user). Nếu chắc chắn backup đúng, nguyên nhân khả dĩ khác là phiên bản mongorestore đổi chữ trong log (script tìm dòng 'archive prelude \`realestate.users\`'): kiểm tra thủ công bằng 'mongorestore --dryRun -v' (tài liệu mục 6) rồi báo để sửa script."
    return 1
  fi
  for coll in "${extra_colls[@]+"${extra_colls[@]}"}"; do
    if ! grep -qF 'archive prelude `realestate.'"${coll}"'`' <<<"$out"; then
      warn "Backup '$f' KHÔNG chứa namespace realestate.${coll} (backup cắt --nsInclude, hoặc dump trước khi collection này có). Migration này ghi/xóa ở collection đó nên cần backup đủ: tạo lại backup toàn DB realestate (mongodump --db realestate, không --nsInclude)."
      return 1
    fi
  done
  return 0
}

# In ra (cách nhau bằng khoảng trắng) những collection trong số các tên được truyền vào ĐANG TỒN TẠI trong DB `realestate` thật
# (CHỈ ĐỌC: getCollectionNames). Dùng để chỉ đòi backup chứa collection có thật (collection chưa tồn tại thì mongodump không
# sinh namespace cho nó, đòi nó sẽ chặn oan). Mật khẩu root xác thực TRONG script mongosh (biến môi trường container), không
# lên dòng lệnh. Trả 1 (không in gì) nếu không hỏi được: caller PHẢI dừng, không đoán.
existing_collections() {
  local mongo="$1" out js coll found=""
  shift
  js="db.getSiblingDB('admin').auth(process.env.MONGO_INITDB_ROOT_USERNAME, process.env.MONGO_INITDB_ROOT_PASSWORD);
const names = db.getSiblingDB('realestate').getCollectionNames();"
  for coll in "$@"; do
    [[ "$coll" =~ ^[A-Za-z0-9_]+$ ]] || return 1
    js+="
print('COLL_EXISTS:${coll}=' + (names.includes('${coll}') ? 1 : 0));"
  done
  out="$(timeout "$OPS_EXEC_TIMEOUT" docker exec -i "$mongo" mongosh --quiet --norc --file /dev/stdin <<<"$js" 2>&1)" || return 1
  for coll in "$@"; do
    if grep -qxF "COLL_EXISTS:${coll}=1" <<<"$out"; then
      found+="${found:+ }${coll}"
    elif ! grep -qxF "COLL_EXISTS:${coll}=0" <<<"$out"; then
      return 1
    fi
  done
  printf '%s' "$found"
}

# In (cách nhau bằng khoảng trắng) tên các collection CÓ DỮ LIỆU (>= 1 document) trong DB `realestate` thật (CHỈ ĐỌC), bỏ qua view và
# collection hệ thống của Mongo (tên bắt đầu bằng `system.`, gồm system.buckets.* của time-series; bản thân collection time-series
# vẫn được xét; collection `system` của ứng dụng KHÔNG bị bỏ qua). "Có dữ liệu" kiểm bằng findOne({}, {_id: 1}) chứ KHÔNG dùng
# estimatedDocumentCount(): số đếm trong metadata có thể sai (về 0) sau khi mongod bị kill -9, và kết quả sai theo hướng "trống" sẽ
# làm bỏ qua backup oan. Kết quả rỗng (nhưng trả 0) nghĩa là không có document nào ở collection nào. Mật khẩu root xác thực TRONG
# script mongosh, không lên dòng lệnh. Trả 1 (không in gì) nếu không hỏi được hoặc output không có dòng kết quả: caller PHẢI dừng.
nonempty_collections() {
  local mongo="$1" out js line
  read -r -d '' js <<'JSEOF' || true
db.getSiblingDB('admin').auth(process.env.MONGO_INITDB_ROOT_USERNAME, process.env.MONGO_INITDB_ROOT_PASSWORD);
const d = db.getSiblingDB('realestate');
const busy = d.getCollectionInfos({ type: { $ne: 'view' } }).map(c => c.name)
  .filter(n => !n.startsWith('system.')).filter(n => d.getCollection(n).findOne({}, { _id: 1 }) !== null);
print('NONEMPTY_COLLS=' + busy.join(' '));
JSEOF
  out="$(timeout "$OPS_EXEC_TIMEOUT" docker exec -i "$mongo" mongosh --quiet --norc --file /dev/stdin <<<"$js" 2>&1)" || return 1
  line="$(grep -E '^NONEMPTY_COLLS=' <<<"$out" | tail -n 1)" || return 1
  [[ -n "$line" ]] || return 1
  printf '%s' "${line#NONEMPTY_COLLS=}"
}
