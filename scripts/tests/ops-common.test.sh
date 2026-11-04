#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# scripts/tests/ops-common.test.sh — test shell KHÔNG cần Docker/Mongo thật cho:
#   - inspect_field, nonempty_collections, existing_collections (scripts/lib/ops-common.sh)
#   - classify_db, auto_reconcile (deploy.sh)
# Hàm được lấy từ file thật (source ops-common.sh; trích classify_db/auto_reconcile/runner_cmd_hint từ deploy.sh bằng sed),
# KHÔNG chép tay. `docker` được thay bằng stub trong thư mục tạm (đưa lên đầu PATH, xóa khi xong): stub giả lập đầu ra của
# `docker inspect` và `docker exec ... mongosh` (danh sách collection do FAKE_COLLS mô tả). Vì vậy bộ test này kiểm lớp shell
# (phân tích đầu ra, fail-closed, bảng quyết định backup), KHÔNG kiểm đoạn JS chạy trong mongosh: phần đó cần Mongo thật
# (xem tài liệu docs/01_Infrastructure/06_Production_Deploy.md mục 11.2).
#
# Chạy:  bash scripts/tests/ops-common.test.sh      (thoát 0 nếu mọi ca đạt, 1 nếu có ca hỏng)
# ─────────────────────────────────────────────────────────────────────────────
# shellcheck disable=SC2034,SC2329,SC2016,SC2032,SC2033  # biến/hàm được dùng qua eval các hàm trích từ deploy.sh; nháy đơn có chủ ý
set -uo pipefail

TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$TEST_DIR/../.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/bin"

PASS=0
FAIL=0
ok()   { PASS=$((PASS + 1)); }
fail() { FAIL=$((FAIL + 1)); printf 'FAIL: %s\n' "$*" >&2; }
# expect_eq <mô tả> <mong đợi> <thực tế>
expect_eq() { if [[ "$2" == "$3" ]]; then ok; else fail "$1: mong đợi [$2], nhận [$3]"; fi; }
# expect_contains <mô tả> <chuỗi con> <văn bản>
expect_contains() { if [[ "$3" == *"$2"* ]]; then ok; else fail "$1: không thấy [$2] trong [$3]"; fi; }

# ── Stub docker ──────────────────────────────────────────────────────────────
# `docker inspect ...`: ghi argv vào $FAKE_ARGV_FILE, in $FAKE_INSPECT_OUT (printf %b), thoát $FAKE_INSPECT_RC (mặc định 0).
# `docker exec -i <c> mongosh ...`: đọc JS từ stdin; FAKE_COLLS = "tên:loại:số_doc ..." (loại: collection|view|timeseries);
#   FAKE_MONGO_MODE = ok (mặc định) | fail (mã 1) | empty (không in gì) | warnonly (chỉ in cảnh báo) | warnmix (cảnh báo + kết quả đúng);
#   FAKE_FAIL_ON=nonempty: chỉ hỏng ở truy vấn danh sách collection có dữ liệu.
cat > "$TMP/bin/docker" <<'STUB'
#!/usr/bin/env bash
cmd="${1:-}"
if [[ "$cmd" == "inspect" ]]; then
  [[ -z "${FAKE_ARGV_FILE:-}" ]] || printf '%s\n' "$@" > "$FAKE_ARGV_FILE"
  [[ -z "${FAKE_INSPECT_OUT+x}" ]] || printf '%b' "$FAKE_INSPECT_OUT"
  exit "${FAKE_INSPECT_RC:-0}"
fi
if [[ "$cmd" == "exec" ]]; then
  js="$(cat)"
  mode="${FAKE_MONGO_MODE:-ok}"
  want=""
  [[ "$js" == *"COLL_EXISTS:users"* ]] && want="exists"
  [[ "$js" == *"NONEMPTY_COLLS"* ]] && want="nonempty"
  [[ "${FAKE_FAIL_ON:-}" != "nonempty" || "$want" != "nonempty" ]] || exit 1
  case "$mode" in
    fail) echo "MongoServerError: Authentication failed." ; exit 1 ;;
    empty) exit 0 ;;
    warnonly) echo "Warning: Using a password on the command line is insecure"; exit 0 ;;
    warnmix) echo "Warning: deprecated option" ;;
  esac
  if [[ "$want" == "exists" ]]; then
    found=0
    for e in ${FAKE_COLLS:-}; do [[ "${e%%:*}" == "users" ]] && found=1; done
    echo "COLL_EXISTS:users=$found"
  elif [[ "$want" == "nonempty" ]]; then
    out=""
    for e in ${FAKE_COLLS:-}; do
      name="${e%%:*}"; rest="${e#*:}"; type="${rest%%:*}"; cnt="${rest#*:}"
      [[ "$type" != "view" && "$name" != system.* && "$cnt" -gt 0 ]] && out+="${out:+ }$name"
    done
    echo "NONEMPTY_COLLS=$out"
  fi
  [[ "$mode" != "warnmix" ]] || echo "Warning: trailing notice"
  exit 0
fi
exit 0
STUB
chmod +x "$TMP/bin/docker"
export PATH="$TMP/bin:$PATH"

# shellcheck source=scripts/lib/ops-common.sh
LOG_PREFIX="test"
source "$ROOT_DIR/scripts/lib/ops-common.sh"
OPS_EXEC_TIMEOUT=20

# Trích hàm từ deploy.sh (không source cả file: nó chạy main khi được source).
extract_fn() { sed -n "/^$1() {/,/^}/p" "$ROOT_DIR/deploy.sh"; }
classify_src="$(extract_fn classify_db)"
auto_src="$(extract_fn auto_reconcile)"
hint_src="$(extract_fn runner_cmd_hint)"
[[ -n "$classify_src" && -n "$auto_src" && -n "$hint_src" ]] || { echo "Không trích được hàm từ deploy.sh" >&2; exit 2; }
eval "$classify_src"
MONGO_CONTAINER="test_mongo"

# ── inspect_field ────────────────────────────────────────────────────────────
T='{{.State.Status}}'
run_inspect() { # rc out [default]
  FAKE_INSPECT_RC="$1" FAKE_INSPECT_OUT="$2" inspect_field some_container "$T" "${@:3}"
}
expect_eq "inspect rc!=0, stdout rỗng"            "missing" "$(run_inspect 1 '')"
expect_eq "inspect rc!=0, stdout dòng trống"      "missing" "$(run_inspect 1 '\n')"
expect_eq "inspect rc!=0, stdout có rác (không tin)" "missing" "$(run_inspect 1 'running\n')"
expect_eq "inspect rc=0, stdout rỗng"             "missing" "$(run_inspect 0 '')"
expect_eq "inspect rc=0, chỉ dòng trống"          "missing" "$(run_inspect 0 '\n')"
expect_eq "inspect rc=0, một dòng"                "healthy" "$(run_inspect 0 'healthy\n')"
expect_eq "inspect rc=0, nhiều dòng lấy dòng đầu" "running" "$(run_inspect 0 'running\nextra\nlines\n')"
expect_eq "inspect mặc định tùy chỉnh khi lỗi"    "none"    "$(run_inspect 1 '' none)"
# Giá trị trả về không có ký tự xuống dòng (đúng lỗi cũ "\nmissing").
v="$(run_inspect 1 '\n')"
expect_eq "inspect: không có xuống dòng trong kết quả" "0" "$([[ "$v" == *$'\n'* ]] && echo 1 || echo 0)"
# Tên container đặc biệt: đứng sau `--`, nguyên vẹn, không bị mở rộng.
weird='-weird name $(touch /tmp/pwned) `x` ;&'
argv="$TMP/argv"
FAKE_ARGV_FILE="$argv" FAKE_INSPECT_RC=0 FAKE_INSPECT_OUT='up\n' inspect_field "$weird" "$T" >/dev/null
mapfile -t args < "$argv"
expect_eq "inspect argv[0]" "inspect" "${args[0]:-}"
expect_eq "inspect argv có -- ngay trước tên" "--" "${args[3]:-}"
expect_eq "inspect tên container nguyên vẹn" "$weird" "${args[4]:-}"
expect_eq "inspect không thực thi nội dung tên" "0" "$([[ -e /tmp/pwned ]] && echo 1 || echo 0)"

# ── classify_db: bảng trường hợp ─────────────────────────────────────────────
run_classify() { # "colls" [mode] [fail_on]
  FAKE_COLLS="$1" FAKE_MONGO_MODE="${2:-ok}" FAKE_FAIL_ON="${3:-}" classify_db 2>/dev/null
  echo "rc=$?"
}
check_classify() { expect_eq "classify_db: $1" "$3"$'\n'"rc=0" "$(run_classify "$2")"; }
check_classify "DB không tồn tại (không collection)"       ""                                          "EMPTY"
check_classify "users rỗng"                                 "users:collection:0"                        "HAS_USERS"
check_classify "users có document"                          "users:collection:5"                        "HAS_USERS"
check_classify "users rỗng + collection khác có dữ liệu"    "users:collection:0 customers:collection:2" "HAS_USERS"
check_classify "Users viết hoa có dữ liệu (không phải users)" "Users:collection:3"                      "AMBIGUOUS:Users"
check_classify "customers có document, không users"         "customers:collection:2"                    "AMBIGUOUS:customers"
check_classify "chỉ system có document"                     "system:collection:2"                       "EMPTY_SYSTEM_ONLY"
check_classify "system rỗng"                                "system:collection:0"                       "EMPTY"
check_classify "system + customers"                         "system:collection:2 customers:collection:1" "AMBIGUOUS:system customers"
check_classify "chỉ view (view không tính)"                 "v1:view:5"                                 "EMPTY"
check_classify "system.views (collection hệ thống Mongo)"   "system.views:collection:1"                 "EMPTY"
check_classify "time-series có dữ liệu (kèm system.buckets)" "ts:timeseries:3 system.buckets.ts:collection:3" "AMBIGUOUS:ts"
check_classify "collection rỗng khác, không users"          "customers:collection:0"                    "EMPTY"
check_classify "cảnh báo lẫn trong output vẫn phân tích đúng" "customers:collection:2"                  "AMBIGUOUS:customers"
# warnmix là chế độ riêng (cảnh báo trước và sau kết quả đúng):
expect_eq "classify_db: cảnh báo lẫn + users" $'HAS_USERS\nrc=0'  "$(run_classify 'users:collection:1' warnmix)"
expect_eq "classify_db: cảnh báo lẫn + DB trống" $'EMPTY\nrc=0'   "$(run_classify '' warnmix)"
# Fail-closed: không in gì, rc=1.
expect_eq "classify_db: mongosh lỗi (rc!=0)"        "rc=1" "$(run_classify 'users:collection:1' fail)"
expect_eq "classify_db: mongosh không in gì"        "rc=1" "$(run_classify 'users:collection:1' empty)"
expect_eq "classify_db: chỉ có cảnh báo"            "rc=1" "$(run_classify 'users:collection:1' warnonly)"
expect_eq "classify_db: hỏng ở truy vấn thứ hai (không users)" "rc=1" "$(run_classify 'customers:collection:1' ok nonempty)"

# ── nonempty_collections / existing_collections trực tiếp ───────────────────
expect_eq "nonempty_collections lỗi" "rc=1" "$(FAKE_MONGO_MODE=fail nonempty_collections x >/dev/null 2>&1; echo "rc=$?")"
expect_eq "existing_collections lỗi" "rc=1" "$(FAKE_MONGO_MODE=empty existing_collections x users >/dev/null 2>&1; echo "rc=$?")"

# ── auto_reconcile: bảng quyết định backup ───────────────────────────────────
# Stub: reconcile_dry_run, run_migration_cli (ghi lệnh), reconcile_stop, classify_db (theo FAKE_CLASS / FAKE_CLASS_RC).
# Trả "apply=<0|1> rc=<mã> | <output>".
run_auto() { # BACKUP_FILE DB_EMPTY_NO_BACKUP CLASS CLASS_RC
  local calls="$TMP/calls"
  : > "$calls"
  local out rc=0
  out="$(
    (
    set -euo pipefail
    ENV_FILE=.env.docker; DOC=doc.md
    BACKUP_FILE="$1"; DB_EMPTY_NO_BACKUP="$2"; DOWNGRADE_ACTIVE=0; ALLOW_DOWNGRADE=0
    STACK_TOUCHED=0; MIGRATION_GATE_RAN=0
    FAKE_CLASS="$3"; FAKE_CLASS_RC="$4"
    eval "$hint_src"
    eval "$auto_src"
    classify_db() { [[ "$FAKE_CLASS_RC" == 0 ]] || return "$FAKE_CLASS_RC"; echo "$FAKE_CLASS"; }
    reconcile_dry_run() { echo "dry" >> "$calls"; }
    reconcile_stop() { die "reconcile_stop $1"; }
    run_migration_cli() { echo "cli $*" >> "$calls"; return 0; }
    auto_reconcile
    ) 2>&1
  )" || rc=$?
  local applied=0
  grep -q -- '--apply' "$calls" && applied=1
  printf 'apply=%s rc=%s | %s' "$applied" "$rc" "$out"
}
check_auto() { # mô tả apply_mong_đợi rc_mong_đợi BACKUP EMPTYFLAG CLASS CLASSRC [chuỗi phải có trong output]
  local res; res="$(run_auto "$4" "$5" "$6" "$7")"
  expect_eq "auto_reconcile: $1 (apply/rc)" "apply=$2 rc=$3" "${res%% |*}"
  [[ -z "${8:-}" ]] || expect_contains "auto_reconcile: $1 (thông báo)" "$8" "$res"
}
B="backups/x.archive.gz"
#            mô tả                                   apply rc  BACKUP EMPTY CLASS               CLASSRC thông báo
check_auto "có backup, DB không trống"                1 0 "$B" 0 "HAS_USERS"          0
check_auto "có backup + cờ trống (backup thắng)"      1 0 "$B" 1 "HAS_USERS"          0
check_auto "không backup, cờ 0 (bước 5 không xác nhận trống)" 0 1 "" 0 "EMPTY"       0 "không xác nhận DB trống"
check_auto "không backup, cờ 1, EMPTY"                1 0 ""   1 "EMPTY"              0 "ghi baseline/version không cần backup"
check_auto "không backup, cờ 1, chỉ-system"           1 0 ""   1 "EMPTY_SYSTEM_ONLY"  0 "EMPTY_SYSTEM_ONLY"
check_auto "không backup, cờ 1, HAS_USERS (đổi giữa chừng)" 0 1 "" 1 "HAS_USERS"      0 "KHÔNG còn trống"
check_auto "không backup, cờ 1, AMBIGUOUS"            0 1 ""   1 "AMBIGUOUS:areas"    0 "bash deploy.sh --no-pull"
check_auto "không backup, cờ 1, không hỏi được Mongo" 0 1 ""   1 ""                   1 "Không hỏi lại được Mongo"
check_auto "không backup, cờ 0, classify EMPTY (không được tin)" 0 1 "" 0 "EMPTY"      0 "không xác nhận DB trống"

# ── m4: JS của nonempty_collections phải dùng findOne và KHÔNG dùng estimatedDocumentCount ───────────────────────────────
# (estimatedDocumentCount đọc số đếm trong metadata, có thể về 0 sau kill -9 mongod => coi DB có dữ liệu là trống => bỏ qua backup oan.)
nonempty_src="$(sed -n '/^nonempty_collections() {/,/^}/p' "$ROOT_DIR/scripts/lib/ops-common.sh")"
[[ -n "$nonempty_src" ]] || fail "không trích được nonempty_collections từ ops-common.sh"
expect_contains "nonempty_collections dùng findOne" "findOne(" "$nonempty_src"
expect_eq "nonempty_collections không dùng estimatedDocumentCount" "0" "$([[ "$nonempty_src" == *estimatedDocumentCount* ]] && echo 1 || echo 0)"
expect_contains "nonempty_collections loại view bằng \$ne" "\$ne: 'view'" "$nonempty_src"

# ── m5: nhánh case "$db_class" của backup_mongo ──────────────────────────────
backup_src="$(extract_fn backup_mongo)"
[[ -n "$backup_src" ]] || { echo "Không trích được backup_mongo từ deploy.sh" >&2; exit 2; }
# Stub: docker (hàm shell, không chạm Docker thật), classify_db (theo FAKE_CLASS/FAKE_CLASS_RC), install (đánh dấu "đã đi qua
# case" rồi thoát mã 77 để không chạy tiếp mongodump). Trả "rc=<mã> | output" (output có RETURNED flag=<DB_EMPTY_NO_BACKUP> nếu return).
run_backup() { # CLASS CLASS_RC
  local out rc=0
  out="$(
    (
    ENV_FILE=.env.docker; DOC=doc.md; BACKUP_DIR=backups; TS=0; DB_EMPTY_NO_BACKUP=0; BACKUP_FILE=""
    FAKE_CLASS="$1"; FAKE_CLASS_RC="$2"
    docker() { case "$1" in inspect) echo running ;; *) return 0 ;; esac; }
    classify_db() { [[ "$FAKE_CLASS_RC" == 0 ]] || return "$FAKE_CLASS_RC"; echo "$FAKE_CLASS"; }
    install() { echo "PASSED_CASE"; exit 77; }
    eval "$backup_src"
    backup_mongo
    echo "RETURNED flag=$DB_EMPTY_NO_BACKUP"
    ) 2>&1
  )" || rc=$?
  printf 'rc=%s | %s' "$rc" "$out"
}
check_backup() { # mô tả rc_mong_đợi chuỗi_phải_có CLASS CLASS_RC
  local res; res="$(run_backup "$4" "$5")"
  expect_eq "backup_mongo: $1 (rc)" "rc=$2" "${res%% |*}"
  expect_contains "backup_mongo: $1 (output)" "$3" "$res"
}
check_backup "HAS_USERS đi tiếp (mongodump bắt buộc)"            77 "PASSED_CASE"          "HAS_USERS" 0
check_backup "EMPTY: bỏ qua backup, đặt cờ, return 0"             0 "RETURNED flag=1"      "EMPTY" 0
check_backup "EMPTY_SYSTEM_ONLY: bỏ qua backup, đặt cờ, return 0" 0 "RETURNED flag=1"      "EMPTY_SYSTEM_ONLY" 0
check_backup "AMBIGUOUS: die, nêu collection"                     1 "(areas)"              "AMBIGUOUS:areas" 0
check_backup "classify_db lỗi: die (không đoán)"                  1 "Không hỏi được Mongo" "" 1
# Chỉ HAS_USERS được đi tiếp tới mongodump; các nhánh còn lại không bao giờ tới `install -d` (đầu bước dump).
expect_eq "backup_mongo EMPTY không đi tiếp"             "0" "$([[ "$(run_backup EMPTY 0)" == *PASSED_CASE* ]] && echo 1 || echo 0)"
expect_eq "backup_mongo EMPTY_SYSTEM_ONLY không đi tiếp" "0" "$([[ "$(run_backup EMPTY_SYSTEM_ONLY 0)" == *PASSED_CASE* ]] && echo 1 || echo 0)"
expect_eq "backup_mongo AMBIGUOUS không đi tiếp"         "0" "$([[ "$(run_backup AMBIGUOUS:x 0)" == *PASSED_CASE* ]] && echo 1 || echo 0)"

printf '\nKết quả: %d đạt, %d hỏng.\n' "$PASS" "$FAIL"
(( FAIL == 0 ))
