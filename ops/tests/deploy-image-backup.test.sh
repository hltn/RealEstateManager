#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# ops/tests/deploy-image-backup.test.sh — test shell KHÔNG cần Docker/Mongo thật cho deploy.sh bản "gói phát hành" (T-34, T-35; FR-21, FR-14).
# Thay deploy-code-backup.test.sh (backup code bằng git bundle đã bỏ: deploy không còn git/build).
#
# Chạy deploy.sh THẬT (bản sao trong thư mục deploy tạm) với `docker`/`curl`/`flock`/`chown` GIẢ đứng đầu PATH và ops/verify-env.sh + scripts/post-migrate/*.sh GIẢ
# (chúng ghi mọi lệnh gọi vào $CALLS). Kiểm:
#   1) thứ tự bước: image -> verify-env -> flock -> compose config -> volume (Q-03) -> mongodump -> sao .env -> manifest -> thẻ pre-<TS> -> promote current -> migrate -> up -> post-migrate
#   2) image thiếu = lỗi; image ID lệch = cảnh báo (DEPLOY_ENFORCE_IMAGE_ID=1 = lỗi); verify-env lỗi = dừng trước khóa/backup/tag/up
#   3) khóa: stub (Git Bash không có flock) báo bận = dừng trước mọi thay đổi; Linux có flock thật thì thêm ca hai deploy chạy chồng nhau
#   4) thẻ pre-<TS> lấy từ image của container ĐANG CHẠY (BE + FE), lần đầu (chưa có container) không gắn thẻ; promote <ver>-<commit> -> current
#   5) KHÔNG build / pull; `up -d --no-build`; cờ --no-pull bị từ chối; hàm/biến đã xóa không còn trong deploy.sh
#   6) Q-03: volume Mongo của project khác tên mà chưa có volume đích = DỪNG (không tạo volume trống), kèm hướng dẫn
#   7) --plan-only: dùng image đã nạp (BACKEND_IMAGE=<name>:<tag>), không backup/tag/promote/up/manifest/post-migrate
#   8) lỗi SAU `up`: KHÔNG rollback (không có docker tag sau up), IN lệnh `bash restore.sh --manifest ...`; lỗi TRƯỚC up (SAU promote): stack không đổi,
#      TỰ trả thẻ current về image cũ (docker tag <name>:pre-<TS> <name>:current), ghi manifest PROMOTE_REVERT=reverted|failed|none; trả lỗi thì cảnh báo +
#      lệnh làm tay mà vẫn giữ mã thoát gốc (kể cả 143 khi bị TERM); promote dở dang chỉ trả phần đã đổi; lần deploy đầu (không image cũ) = none
#   9) manifest (MANIFEST_VERSION=2): RELEASE_VERSION, RELEASE_COMMIT, CD_RUN_ID, PRE_TAG, image dự phòng, DB version, trạng thái; KHÔNG bí mật
#  10) tín hiệu THẬT trong lúc deploy.sh chạy (stub tự gửi TERM/HUP/KILL cho deploy.sh): mã 143/129, manifest `failed`, hướng dẫn đúng nhánh; stderr chết
#      (/dev/full, như SSH rớt) vẫn giữ đúng mã thoát và vẫn trả thẻ
#  11) manifest ghi TỨC THÌ STACK_TOUCHED/POST_UP_REACHED (stub soi manifest tại thời điểm up/reconcile --apply/hậu-migrate; SIGKILL giữa `up` vẫn để lại
#      manifest STACK_TOUCHED=1, DEPLOY_STATUS=started); TS trùng nhau: dừng TRƯỚC mongodump/sao .env, không ghi đè backup/manifest cũ
#  12) mutation tự kiểm (m12 bỏ ghi manifest tức thời, m13 bỏ trả thẻ, m14 bỏ `set +e` khỏi on_exit, m15 bỏ kiểm TS trùng): bản đột biến PHẢI bị bắt
# Ghi chú nền tảng: Git Bash trên Windows không có `flock`: các ca khóa dùng stub; khi `flock` thật có trên máy (Linux/CI) stub chuyển tiếp sang flock thật
# (mọi ca deploy dùng khóa thật) và ca 6b thêm hai deploy chạy chồng nhau.
#
# Chạy:  bash ops/tests/deploy-image-backup.test.sh      (thoát 0 nếu mọi ca đạt, 1 nếu có ca hỏng)
# ─────────────────────────────────────────────────────────────────────────────
# shellcheck disable=SC2034,SC2016,SC2329
set -uo pipefail
# Cô lập khỏi môi trường CI: GitHub luôn đặt GITHUB_RUN_ID, làm CD_RUN_ID không còn rỗng như test giả định.
# Ca cần các biến này tự đặt qua EXTRA_ENV/rd.
unset GITHUB_RUN_ID DEPLOY_CD_RUN_ID

TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$TEST_DIR/../.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

PASS=0
FAIL=0
ok()   { PASS=$((PASS + 1)); }
fail() { FAIL=$((FAIL + 1)); printf 'FAIL: %s\n' "$*" >&2; }
expect_eq() { if [[ "$2" == "$3" ]]; then ok; else fail "$1: mong đợi [$2], nhận [$3]"; fi; }
expect_contains() { if [[ "$3" == *"$2"* ]]; then ok; else fail "$1: không thấy [$2] trong [${3:0:600}]"; fi; }
expect_not_contains() { if [[ "$3" != *"$2"* ]]; then ok; else fail "$1: không được có [$2] trong [${3:0:600}]"; fi; }
expect_rc() { if [[ "$2" == "$3" ]]; then ok; else fail "$1: mã thoát mong đợi $2, nhận $3 (output: ${OUT:0:500})"; fi; }
expect_nonzero() { if [[ "$2" != "0" ]]; then ok; else fail "$1: mong đợi mã thoát khác 0 (output: ${OUT:0:500})"; fi; }
expect_lt() { if [[ "$2" =~ ^[0-9]+$ && "$3" =~ ^[0-9]+$ ]] && (( $2 < $3 )); then ok; else fail "$1: thứ tự sai (dòng $2 phải < dòng $3)"; fi; }

# SIGHUP bị bỏ qua từ lúc khởi động (vd chạy bằng nohup) thì bash không bắt được: bỏ các ca SIGHUP thay vì báo hỏng giả.
HUP_OK=1; [[ "$(bash -c 'kill -HUP $$; echo survived' 2>/dev/null)" == "survived" ]] && HUP_OK=0

# ── Stub ────────────────────────────────────────────────────────────────────
STUB="$TMP/stub"; STUBFL="$TMP/stubfl"; mkdir -p "$STUB" "$STUBFL"
cat > "$STUB/docker" <<'EOS'
#!/usr/bin/env bash
echo "docker $*" >> "$CALLS"
BE_ID="sha256:$(printf 'a%.0s' $(seq 1 64))"; FE_ID="sha256:$(printf 'b%.0s' $(seq 1 64))"
case "${1:-}" in
  compose)
    shift
    [[ "${1:-}" == "--env-file" ]] && shift 2
    case "${1:-}" in
      version) exit 0 ;;
      config) [[ -z "${STUB_CONFIG_SLEEP:-}" ]] || sleep "$STUB_CONFIG_SLEEP"; exit "${STUB_CONFIG_RC:-0}" ;;
      up)
        echo "COMPOSE_UP BACKEND_IMAGE=${BACKEND_IMAGE:-}" >> "$CALLS"
        echo "MANIFEST_AT_UP STACK_TOUCHED=$(sed -n 's/^STACK_TOUCHED=//p' backups/deploy-pre-*.manifest 2>/dev/null | head -n 1)" >> "$CALLS"
        touch .stub-up
        # Tự gửi tín hiệu cho deploy.sh (cha của stub) NGAY trong lúc `up` đang chạy: mô phỏng bị ngắt giữa chừng
        if [[ -n "${STUB_UP_SIGNAL:-}" ]]; then kill "-$STUB_UP_SIGNAL" "$PPID"; sleep 1; fi
        exit "${STUB_UP_RC:-0}" ;;
      ps) echo "NAME STATUS"; exit 0 ;;
      run)
        echo "COMPOSE_RUN BACKEND_IMAGE=${BACKEND_IMAGE:-}" >> "$CALLS"
        case "$*" in
          *"status --json"*) echo '{"pending":[]}'; exit "${STUB_STATUS_RC:-0}" ;;
          *"reconcile --apply"*)
            echo "MANIFEST_AT_APPLY STACK_TOUCHED=$(sed -n 's/^STACK_TOUCHED=//p' backups/deploy-pre-*.manifest 2>/dev/null | head -n 1)" >> "$CALLS"
            exit "${STUB_APPLY_RC:-0}" ;;
          *reconcile*)
            echo "[plan] reconcile dry-run"
            if [[ -n "${STUB_DRY_SIGNAL:-}" ]]; then kill "-$STUB_DRY_SIGNAL" "$PPID"; sleep 1; fi
            exit "${STUB_DRY_RC:-0}" ;;
        esac
        exit 0 ;;
    esac
    exit 0 ;;
  info) exit 0 ;;
  image)
    ref="${*: -1}"
    case "$ref" in *"${STUB_MISSING:-@@none@@}"*) exit 1 ;; esac
    case "$ref" in
      *backend*) echo "${STUB_BE_ID:-$BE_ID}" ;;
      *frontend*) echo "${STUB_FE_ID:-$FE_ID}" ;;
    esac
    exit 0 ;;
  inspect)
    [[ -z "${STUB_NO_CONTAINERS:-}" || -f .stub-up ]] || exit 1   # sau `compose up` container mới tồn tại
    tmpl=""; prev=""; cont="${*: -1}"
    for a in "$@"; do [[ "$prev" == "-f" ]] && tmpl="$a"; prev="$a"; done
    case "$tmpl" in
      *".Image}}"*) case "$cont" in *backend*) echo "sha256:PRE_BE" ;; *frontend*) echo "sha256:PRE_FE" ;; *) echo "sha256:PRE_OTHER" ;; esac ;;
      *".State.Health"*) echo healthy ;;
      *".State.Status"*) echo running ;;
      *) : ;;
    esac
    exit 0 ;;
  volume)
    flt=""; prev=""
    for a in "$@"; do [[ "$prev" == "--filter" ]] && flt="$a"; prev="$a"; done
    flt="${flt#name=}"
    for v in ${STUB_VOLUMES:-}; do
      if [[ "$flt" == ^*\$ ]]; then t="${flt#^}"; t="${t%\$}"; [[ "$v" == "$t" ]] && echo "$v"
      else [[ "$v" == *"$flt"* ]] && echo "$v"; fi
    done
    exit 0 ;;
  tag)
    echo "TAGSTATE env_backups=$(ls backups/*.env 2>/dev/null | wc -l | tr -d ' ') manifests=$(ls backups/*.manifest 2>/dev/null | wc -l | tr -d ' ') dumps=$(ls backups/*.archive.gz 2>/dev/null | wc -l | tr -d ' ')" >> "$CALLS"
    # $2 = nguồn, $3 = đích. Trả thẻ (pre-<TS> -> current) và promote FE có thể bị ép lỗi riêng; STUB_TAG_RC ép lỗi mọi `docker tag`.
    case "${2:-}" in *:pre-*) case "${3:-}" in *:current) [[ -z "${STUB_TAG_REVERT_RC:-}" ]] || exit "$STUB_TAG_REVERT_RC" ;; esac ;; esac
    case "${3:-}" in *frontend*:current) case "${2:-}" in *:1.0.6-*) [[ -z "${STUB_TAG_PROMOTE_FE_RC:-}" ]] || exit "$STUB_TAG_PROMOTE_FE_RC" ;; esac ;; esac
    exit "${STUB_TAG_RC:-0}" ;;
  exec)
    stdin=""; case "$*" in *" -i "*) stdin="$(cat)" ;; esac
    case "$*" in
      *mongodump*) printf 'dump' | gzip -c; exit "${STUB_DUMP_RC:-0}" ;;
      *mongorestore*) echo 'archive prelude `realestate.users`'; exit 0 ;;
      *MONGO_INITDB_ROOT_USERNAME*"&&"*) exit 0 ;;
      *"test -f /app/state/cron.env"*) exit "${STUB_CRON_RC:-0}" ;;
    esac
    case "$stdin" in
      *PENDING_USERS*) echo "PENDING_USERS=0" ;;
      *COLL_EXISTS*) echo "COLL_EXISTS:users=1" ;;
      *NONEMPTY_COLLS*) echo "NONEMPTY_COLLS=users" ;;
      *SYSTEM_VERSION*) echo "SYSTEM_VERSION=${STUB_DB_VERSION-1.0.5}" ;;
    esac
    exit 0 ;;
esac
exit 0
EOS
cat > "$STUB/curl" <<'EOS'
#!/usr/bin/env bash
echo "curl $*" >> "$CALLS"; exit 0
EOS
cat > "$STUB/chown" <<'EOS'
#!/usr/bin/env bash
exit 0
EOS
# `flock` stub: ghi lệnh gọi; STUB_FLOCK_BUSY = báo bận; có flock THẬT (Linux/CI, REAL_FLOCK) thì chuyển tiếp sang nó (khóa thật), không thì coi như giành được.
cat > "$STUBFL/flock" <<'EOS'
#!/usr/bin/env bash
echo "flock $*" >> "$CALLS"
[[ -z "${STUB_FLOCK_BUSY:-}" ]] || exit 1
[[ -z "${REAL_FLOCK:-}" ]] || exec "$REAL_FLOCK" "$@"
exit 0
EOS
# `date` stub: STUB_TS đặt mã thời gian TS của deploy.sh (ca TS trùng nhau); mọi lần gọi khác chuyển tiếp sang date thật.
REAL_DATE="$(command -v date)"
cat > "$STUB/date" <<EOS
#!/usr/bin/env bash
if [[ -n "\${STUB_TS:-}" && "\$*" == "+%Y%m%d-%H%M%S" ]]; then echo "\$STUB_TS"; exit 0; fi
exec "$REAL_DATE" "\$@"
EOS
REAL_FLOCK=""
if [[ "$(uname -s)" == "Linux" ]] && command -v flock >/dev/null 2>&1; then REAL_FLOCK="$(command -v flock)"; fi
# `install -d -m 700` thất bại trên Git Bash/NTFS (không đổi được quyền): dùng shim chỉ khi máy thật sự không làm được.
if ! install -d -m 700 "$TMP/probe-install" 2>/dev/null; then
  cat > "$STUB/install" <<'EOS'
#!/usr/bin/env bash
# shim: install -d [-m MODE] DIR...  -> mkdir -p (+ chmod nếu được)
mode=""; [[ "${1:-}" == "-d" ]] && shift; if [[ "${1:-}" == "-m" ]]; then mode="$2"; shift 2; fi
mkdir -p "$@" || exit 1
[[ -z "$mode" ]] || chmod "$mode" "$@" 2>/dev/null || true
exit 0
EOS
  chmod +x "$STUB/install"
fi
chmod +x "$STUB/docker" "$STUB/curl" "$STUB/chown" "$STUB/date" "$STUBFL/flock"

# ── Thư mục deploy tạm ───────────────────────────────────────────────────────
BE_ID_OK="sha256:$(printf 'a%.0s' $(seq 1 64))"
FE_ID_OK="sha256:$(printf 'b%.0s' $(seq 1 64))"
D=""; N=0
mkdeploy() {
  N=$((N + 1)); D="$TMP/d$N"
  mkdir -p "$D/ops/lib" "$D/scripts/post-migrate"
  cp "${DEPLOY_SRC:-$ROOT_DIR/deploy.sh}" "$D/deploy.sh"
  cp "$ROOT_DIR/ops/lib/ops-common.sh" "$D/ops/lib/ops-common.sh"
  : > "$D/docker-compose.yml"
  printf 'JWT_SECRET=hunter2-canary\nMONGO_ROOT_PASSWORD=canary-pass\n' > "$D/.env"; chmod 600 "$D/.env"
  cat > "$D/release.env" <<EOF
RELEASE_VERSION=1.0.6
RELEASE_LOCAL=0
GIT_COMMIT=abc1234
BACKEND_IMAGE_NAME=realestatemanager-backend
BACKEND_IMAGE_TAG=1.0.6-abc1234
BACKEND_IMAGE_ID=$BE_ID_OK
FRONTEND_IMAGE_NAME=realestatemanager-frontend
FRONTEND_IMAGE_TAG=1.0.6-abc1234
FRONTEND_IMAGE_ID=$FE_ID_OK
EOF
  cat > "$D/ops/verify-env.sh" <<'EOS'
#!/usr/bin/env bash
echo "verify-env $*" >> "$CALLS"; exit "${STUB_VERIFY_RC:-0}"
EOS
  for s in 10-catalog-codes 20-customer-codes 90-post-up-migrations; do
    cat > "$D/scripts/post-migrate/$s.sh" <<'EOS'
#!/usr/bin/env bash
n="$(basename "$0" .sh)"
echo "post-migrate $n" >> "$CALLS"
echo "MANIFEST_AT_PM $n POST_UP_REACHED=$(sed -n 's/^POST_UP_REACHED=//p' backups/deploy-pre-*.manifest 2>/dev/null | head -n 1)" >> "$CALLS"
[[ "${STUB_PM_FAIL:-}" != "$n" ]] || exit 7
exit 0
EOS
  done
  CALLS="$D/calls.log"; : > "$CALLS"
}
# rd [VAR=val ...] [-- deploy-args...]  -> OUT, RC; $CALLS ghi các lệnh gọi.
rd() {
  local -a envs=() args=()
  while (( $# )); do
    if [[ "$1" == "--" ]]; then shift; args=("$@"); break; fi
    envs+=("$1"); shift
  done
  if [[ -n "${RD_DEAD_STDERR:-}" ]]; then
    # stderr chết (mọi ghi ra stderr đều lỗi, như SSH rớt): chỉ thu stdout
    OUT="$(cd "$D" && env CALLS="$CALLS" REAL_FLOCK="$REAL_FLOCK" PATH="$STUB:$STUBFL:$PATH" DEPLOY_MIN_FREE_GB=0 MONGO_TIMEOUT=5 HEALTH_TIMEOUT=5 HEALTH_URL=http://stub/live \
          "${envs[@]+"${envs[@]}"}" bash deploy.sh "${args[@]+"${args[@]}"}" 2>/dev/full)"
  else
    OUT="$(cd "$D" && env CALLS="$CALLS" REAL_FLOCK="$REAL_FLOCK" PATH="$STUB:$STUBFL:$PATH" DEPLOY_MIN_FREE_GB=0 MONGO_TIMEOUT=5 HEALTH_TIMEOUT=5 HEALTH_URL=http://stub/live \
          "${envs[@]+"${envs[@]}"}" bash deploy.sh "${args[@]+"${args[@]}"}" 2>&1)"
  fi
  RC=$?
}
calls() { cat "$CALLS"; }
calls_after() { sed -n "$(( $(ln "$1") + 1 )),\$p" "$CALLS"; }   # các dòng SAU dòng đầu tiên chứa chuỗi $1
ln() { grep -n -m1 -F -- "$1" "$CALLS" | cut -d: -f1; }       # số dòng đầu tiên chứa chuỗi cố định
has() { grep -qF -- "$1" "$CALLS"; }
manifest() { ls "$D"/backups/deploy-pre-*.manifest 2>/dev/null | head -n 1; }
mval() { sed -n "s/^$1=//p" "$(manifest)" | head -n 1; }
no_change_calls() { # kiểm deploy dừng TRƯỚC mọi thay đổi: không dump/tag/up/volume create
  local why="$1"
  has "mongodump" && fail "$why: không được mongodump" || ok
  has "docker tag " && fail "$why: không được docker tag" || ok
  has "up -d" && fail "$why: không được compose up" || ok
  has "volume create" && fail "$why: không được tạo volume" || ok
  [[ ! -d "$D/backups" || -z "$(ls -A "$D/backups" 2>/dev/null)" ]] && ok || fail "$why: không được để lại backup/manifest"
}

BE_REF="realestatemanager-backend:1.0.6-abc1234"
FE_REF="realestatemanager-frontend:1.0.6-abc1234"

echo "== 1) Deploy thường: thứ tự bước, không build/pull, manifest =="
mkdeploy
rd "DEPLOY_CD_RUN_ID=run-4242" "STUB_VOLUMES=realestatemanager_mongo_data"
expect_rc "deploy thường" 0 "$RC"
L_IMG="$(ln 'docker image inspect')"; L_VER="$(ln 'verify-env .env')"; L_LOCK="$(ln 'flock -n 8')"; L_CFG="$(ln 'config -q')"
L_VOL="$(ln 'docker volume ls')"; L_DUMP="$(ln 'mongodump')"
L_PRE="$(ln 'docker tag sha256:PRE_BE realestatemanager-backend:pre-')"; L_PREF="$(ln 'docker tag sha256:PRE_FE realestatemanager-frontend:pre-')"
L_PRO="$(ln "docker tag $BE_REF realestatemanager-backend:current")"; L_PROF="$(ln "docker tag $FE_REF realestatemanager-frontend:current")"
L_REC="$(ln 'reconcile --apply --by deploy --skip-version --phase pre-up')"; L_UP="$(ln 'up -d --no-build')"
L_P10="$(ln 'post-migrate 10-catalog-codes')"; L_P20="$(ln 'post-migrate 20-customer-codes')"; L_P90="$(ln 'post-migrate 90-post-up-migrations')"
expect_lt "image -> verify-env" "$L_IMG" "$L_VER"
expect_lt "verify-env -> flock" "$L_VER" "$L_LOCK"
expect_lt "flock -> compose config" "$L_LOCK" "$L_CFG"
expect_lt "compose config -> volume Q-03" "$L_CFG" "$L_VOL"
expect_lt "volume Q-03 -> mongodump" "$L_VOL" "$L_DUMP"
expect_lt "mongodump -> thẻ pre BE" "$L_DUMP" "$L_PRE"
expect_lt "thẻ pre BE -> thẻ pre FE" "$L_PRE" "$L_PREF"
expect_lt "thẻ pre FE -> promote BE" "$L_PREF" "$L_PRO"
expect_lt "promote BE -> promote FE" "$L_PRO" "$L_PROF"
expect_lt "promote -> migrate" "$L_PROF" "$L_REC"
expect_lt "migrate -> up" "$L_REC" "$L_UP"
expect_lt "up -> post-migrate 10" "$L_UP" "$L_P10"
expect_lt "post-migrate 10 -> 20" "$L_P10" "$L_P20"
expect_lt "post-migrate 20 -> 90" "$L_P20" "$L_P90"
TAGSTATE="$(grep -m1 TAGSTATE "$CALLS")"
expect_contains "khi gắn thẻ pre đã có bản sao .env" "env_backups=1" "$TAGSTATE"
expect_contains "khi gắn thẻ pre đã có manifest" "manifests=1" "$TAGSTATE"
expect_contains "khi gắn thẻ pre đã có backup Mongo" "dumps=1" "$TAGSTATE"
# Không build/pull
expect_not_contains "không gọi build" " build" "$(grep -v -- '--no-build' "$CALLS")"
expect_not_contains "không gọi pull" " pull" "$(calls)"
expect_not_contains "không --pull" "--pull" "$(calls)"
expect_not_contains "không --build" "--build" "$(grep -v -- '--no-build' "$CALLS")"
expect_contains "up không build" "up -d --no-build" "$(calls)"
expect_not_contains "không dùng .env.docker" ".env.docker" "$(calls)"
expect_contains "compose dùng .env gốc" "compose --env-file .env" "$(calls)"
[[ -f "$D/.deploy.lock" ]] && ok || fail "thiếu file khóa .deploy.lock ở thư mục deploy"
# Manifest
M="$(manifest)"; [[ -n "$M" ]] && ok || fail "không có manifest"
expect_eq "MANIFEST_VERSION" "2" "$(mval MANIFEST_VERSION)"
expect_eq "BACKUP_KIND" "deploy" "$(mval BACKUP_KIND)"
expect_eq "RELEASE_VERSION" "1.0.6" "$(mval RELEASE_VERSION)"
expect_eq "RELEASE_COMMIT" "abc1234" "$(mval RELEASE_COMMIT)"
expect_eq "CD_RUN_ID" "run-4242" "$(mval CD_RUN_ID)"
TSV="$(mval TS)"
expect_eq "PRE_TAG = pre-<TS>" "pre-$TSV" "$(mval PRE_TAG)"
expect_eq "BACKEND_PRE_IMAGE" "realestatemanager-backend:pre-$TSV" "$(mval BACKEND_PRE_IMAGE)"
expect_eq "FRONTEND_PRE_IMAGE" "realestatemanager-frontend:pre-$TSV" "$(mval FRONTEND_PRE_IMAGE)"
expect_eq "BACKEND_IMAGE_TAG" "1.0.6-abc1234" "$(mval BACKEND_IMAGE_TAG)"
expect_eq "DB_VERSION_BEFORE" "1.0.5" "$(mval DB_VERSION_BEFORE)"
expect_eq "DB_VERSION_READ" "1" "$(mval DB_VERSION_READ)"
expect_eq "MONGO_BACKUP_FILE" "backups/deploy-pre-$TSV.archive.gz" "$(mval MONGO_BACKUP_FILE)"
expect_eq "ENV_BACKUP_FILE" "backups/deploy-pre-$TSV.env" "$(mval ENV_BACKUP_FILE)"
expect_eq "STACK_TOUCHED" "1" "$(mval STACK_TOUCHED)"
expect_eq "POST_UP_REACHED" "1" "$(mval POST_UP_REACHED)"
expect_eq "DEPLOY_STATUS" "succeeded" "$(mval DEPLOY_STATUS)"
expect_eq "thành công: không có PROMOTE_REVERT" "" "$(mval PROMOTE_REVERT)"
[[ -n "$(mval FINISHED_AT)" ]] && ok || fail "FINISHED_AT rỗng"
expect_not_contains "manifest không bí mật (JWT)" "hunter2" "$(cat "$M")"
expect_not_contains "manifest không bí mật (Mongo)" "canary-pass" "$(cat "$M")"
expect_not_contains "output không lộ bí mật" "hunter2" "$OUT"
expect_eq "bản sao .env giống bản gốc" "$(cat "$D/.env")" "$(cat "$D/backups/deploy-pre-$TSV.env" 2>/dev/null)"
if [[ "$(uname -s)" == "Linux" ]]; then
  expect_eq "backup .env mode 600" "600" "$(stat -c '%a' "$D/backups/deploy-pre-$TSV.env")"
  expect_eq "manifest mode 600" "600" "$(stat -c '%a' "$M")"
  expect_eq "backups mode 700" "700" "$(stat -c '%a' "$D/backups")"
fi
expect_contains "log nói restore bằng manifest" "restore.sh --manifest" "$OUT"

echo "== 1b) CD run id dự phòng GITHUB_RUN_ID; không có thì để trống =="
mkdeploy; rd "GITHUB_RUN_ID=999" "STUB_VOLUMES=realestatemanager_mongo_data"
expect_rc "GITHUB_RUN_ID" 0 "$RC"; expect_eq "CD_RUN_ID từ GITHUB_RUN_ID" "999" "$(mval CD_RUN_ID)"
mkdeploy; rd "STUB_VOLUMES=realestatemanager_mongo_data"
expect_rc "không CD run id" 0 "$RC"; expect_eq "CD_RUN_ID rỗng" "" "$(mval CD_RUN_ID)"
mkdeploy; rd "DEPLOY_CD_RUN_ID=bad id;x" "STUB_VOLUMES=realestatemanager_mongo_data"
expect_nonzero "CD run id sai dạng" "$RC"; expect_contains "báo CD run id" "DEPLOY_CD_RUN_ID" "$OUT"; no_change_calls "CD run id sai"

echo "== 2) Lần deploy đầu (chưa có container): không gắn thẻ pre-<TS>, vẫn promote =="
mkdeploy; rd "STUB_NO_CONTAINERS=1"
expect_rc "deploy lần đầu" 0 "$RC"
has "docker tag sha256:PRE" && fail "không được gắn thẻ pre khi chưa có container" || ok
has "realestate_backend" && ok || ok
expect_eq "BACKEND_PRE_IMAGE rỗng" "" "$(mval BACKEND_PRE_IMAGE)"
expect_eq "FRONTEND_PRE_IMAGE rỗng" "" "$(mval FRONTEND_PRE_IMAGE)"
has "docker tag $BE_REF realestatemanager-backend:current" && ok || fail "vẫn phải promote BE"
has "docker tag $FE_REF realestatemanager-frontend:current" && ok || fail "vẫn phải promote FE"
expect_contains "cài mới: bước 8a reconcile sau liveness" "Bước 8a (cài mới)" "$OUT"

echo "== 3) Image: thiếu = lỗi, ID lệch = cảnh báo (hoặc lỗi khi DEPLOY_ENFORCE_IMAGE_ID=1) =="
mkdeploy; rd "STUB_MISSING=frontend"
expect_nonzero "thiếu image FE" "$RC"; expect_contains "báo thiếu image" "Chưa có image realestatemanager-frontend" "$OUT"
has "verify-env" && fail "thiếu image phải dừng trước verify-env" || ok; no_change_calls "thiếu image"
mkdeploy; rd "STUB_BE_ID=sha256:$(printf 'c%.0s' $(seq 1 64))" "STUB_VOLUMES=realestatemanager_mongo_data"
expect_rc "ID lệch chỉ cảnh báo" 0 "$RC"; expect_contains "cảnh báo ID lệch" "LỆCH" "$OUT"; expect_contains "nhắc cổng cứng" "DEPLOY_ENFORCE_IMAGE_ID=1" "$OUT"
mkdeploy; rd "STUB_BE_ID=sha256:$(printf 'c%.0s' $(seq 1 64))" "DEPLOY_ENFORCE_IMAGE_ID=1"
expect_nonzero "ID lệch + cổng cứng" "$RC"; expect_contains "cổng cứng báo lỗi" "cổng cứng" "$OUT"
has "verify-env" && fail "cổng cứng phải dừng trước verify-env" || ok; no_change_calls "cổng cứng image ID"
mkdeploy; rd "DEPLOY_ENFORCE_IMAGE_ID=2"
expect_nonzero "DEPLOY_ENFORCE_IMAGE_ID sai dạng" "$RC"
mkdeploy; printf 'BACKEND_IMAGE=other:tag\n' >> "$D/.env"; rd "STUB_VOLUMES=realestatemanager_mongo_data"
expect_contains "cảnh báo .env đặt BACKEND_IMAGE" "BACKEND_IMAGE/FRONTEND_IMAGE" "$OUT"

echo "== 4) release.env: thiếu / --local / sai dạng = dừng, chưa đổi gì =="
mkdeploy; rm "$D/release.env"; rd
expect_nonzero "thiếu release.env" "$RC"; expect_contains "báo thiếu release.env" "Thiếu release.env" "$OUT"; no_change_calls "thiếu release.env"
mkdeploy; sed -i 's/RELEASE_LOCAL=0/RELEASE_LOCAL=1/' "$D/release.env"; rd
expect_nonzero "release.env --local" "$RC"; expect_contains "báo --local" "--local" "$OUT"; no_change_calls "--local"
mkdeploy; sed -i 's/^BACKEND_IMAGE_TAG=.*/BACKEND_IMAGE_TAG=9.9.9-abc1234/' "$D/release.env"; rd
expect_nonzero "tag không khớp version" "$RC"; expect_contains "báo tag sai" "BACKEND_IMAGE_TAG" "$OUT"; no_change_calls "tag sai"
mkdeploy; sed -i 's/^BACKEND_IMAGE_ID=.*/BACKEND_IMAGE_ID=latest/' "$D/release.env"; rd
expect_nonzero "image ID sai dạng" "$RC"; expect_contains "báo ID sai" "BACKEND_IMAGE_ID" "$OUT"; no_change_calls "ID sai"
mkdeploy; sed -i 's/^RELEASE_VERSION=.*/RELEASE_VERSION=abc/' "$D/release.env"; rd
expect_nonzero "version sai" "$RC"; expect_contains "báo version sai" "RELEASE_VERSION" "$OUT"

echo "== 5) verify-env lỗi = dừng trước khóa/backup/tag/up =="
mkdeploy; rd "STUB_VERIFY_RC=1"
expect_nonzero "verify-env lỗi" "$RC"; expect_contains "báo verify-env" "ops/verify-env.sh báo lỗi" "$OUT"
has "flock" && fail "verify-env lỗi: không được lấy khóa" || ok; no_change_calls "verify-env lỗi"
mkdeploy; rd "STUB_VERIFY_RC=2"
expect_nonzero "verify-env mã 2" "$RC"; expect_contains "báo mã 2" "mã 2" "$OUT"
mkdeploy; rd "STUB_VERIFY_RC=1" -- --plan-only
expect_nonzero "verify-env lỗi cả khi --plan-only" "$RC"

echo "== 6) Khóa flock: bận = dừng trước mọi thay đổi (stub) =="
mkdeploy; rd "STUB_FLOCK_BUSY=1"
expect_nonzero "khóa bận" "$RC"; expect_contains "báo deploy khác đang chạy" "Một lần deploy/backup/restore khác đang chạy" "$OUT"
expect_lt "verify-env chạy trước khi giành khóa" "$(ln 'verify-env')" "$(ln 'flock -n 8')"
has "config -q" && fail "khóa bận: không được chạm compose" || ok; no_change_calls "khóa bận"
mkdeploy; rd "STUB_FLOCK_BUSY=1" -- --plan-only
expect_nonzero "khóa bận cả khi --plan-only" "$RC"

echo "== 6b) Khóa flock THẬT: hai deploy chạy chồng nhau (chỉ khi máy có flock thật) =="
if command -v flock >/dev/null 2>&1 && [[ "$(uname -s)" == "Linux" ]]; then
  mkdeploy
  ( cd "$D" && env CALLS="$CALLS" PATH="$STUB:$PATH" DEPLOY_MIN_FREE_GB=0 MONGO_TIMEOUT=5 HEALTH_TIMEOUT=5 HEALTH_URL=http://stub/live \
      STUB_VOLUMES=realestatemanager_mongo_data STUB_CONFIG_SLEEP=4 bash deploy.sh > "$D/first.out" 2>&1 ) &
  BG=$!
  sleep 1.5
  OUT="$(cd "$D" && env CALLS="$CALLS" PATH="$STUB:$PATH" DEPLOY_MIN_FREE_GB=0 MONGO_TIMEOUT=5 HEALTH_TIMEOUT=5 HEALTH_URL=http://stub/live bash deploy.sh 2>&1)"; RC=$?
  expect_nonzero "deploy thứ hai bị chặn bởi flock thật" "$RC"
  expect_contains "thông báo khóa" "Một lần deploy/backup/restore khác đang chạy" "$OUT"
  wait "$BG"; expect_rc "deploy đầu vẫn hoàn tất" 0 "$?"
else
  echo "   (bỏ qua: không có flock thật trên nền tảng này ($(uname -s)); ca khóa ở mục 6 dùng stub)"
fi

echo "== 7) Q-03: volume Mongo của project khác tên mà chưa có volume đích =="
mkdeploy; rd "STUB_VOLUMES=oldproj_mongo_data oldproj_redis_data"
expect_nonzero "Q-03 dừng" "$RC"; expect_contains "nêu Q-03" "Q-03" "$OUT"
expect_contains "nêu volume cũ" "oldproj_mongo_data" "$OUT"
expect_contains "hướng dẫn giữ project cũ" "COMPOSE_PROJECT_NAME=oldproj" "$OUT"
expect_contains "hướng dẫn cố ý tạo trống" "DEPLOY_ALLOW_NEW_MONGO_VOLUME=1" "$OUT"
no_change_calls "Q-03"
mkdeploy; rd "STUB_VOLUMES=oldproj_mongo_data" -- --plan-only
expect_nonzero "Q-03 cũng chặn --plan-only" "$RC"
mkdeploy; rd "STUB_VOLUMES=oldproj_mongo_data realestatemanager_mongo_data"
expect_rc "có volume đích thì qua" 0 "$RC"
mkdeploy; rd "STUB_VOLUMES="
expect_rc "không có volume nào (cài mới thật) thì qua" 0 "$RC"
mkdeploy; rd "STUB_VOLUMES=oldproj_mongo_data" "DEPLOY_ALLOW_NEW_MONGO_VOLUME=1"
expect_rc "cố ý cho phép volume trống" 0 "$RC"; expect_contains "cảnh báo volume trống" "volume TRỐNG" "$OUT"
mkdeploy; rd "STUB_VOLUMES=oldproj_mongo_data" "COMPOSE_PROJECT_NAME=oldproj"
expect_rc "COMPOSE_PROJECT_NAME trỏ project cũ thì qua" 0 "$RC"
mkdeploy; printf 'COMPOSE_PROJECT_NAME=oldproj\n' >> "$D/.env"; rd "STUB_VOLUMES=oldproj_mongo_data"
expect_rc "COMPOSE_PROJECT_NAME trong .env trỏ project cũ thì qua" 0 "$RC"
mkdeploy; rd "STUB_VOLUMES=oldproj_mongo_data" "DEPLOY_ALLOW_NEW_MONGO_VOLUME=3"
expect_nonzero "DEPLOY_ALLOW_NEW_MONGO_VOLUME sai dạng" "$RC"

echo "== 8) --plan-only: image đã nạp, không backup/tag/promote/up/manifest/post-migrate =="
mkdeploy; rd "STUB_VOLUMES=realestatemanager_mongo_data" -- --plan-only
expect_rc "plan-only" 0 "$RC"
expect_contains "plan-only dùng image đã nạp" "COMPOSE_RUN BACKEND_IMAGE=$BE_REF" "$(calls)"
expect_contains "plan-only chạy reconcile dry-run" "reconcile --by deploy" "$(calls)"
has "reconcile --apply" && fail "plan-only không được --apply" || ok
no_change_calls "plan-only"
has "post-migrate" && fail "plan-only không chạy post-migrate" || ok
has "docker tag" && fail "plan-only không gắn thẻ/promote" || ok
[[ -z "$(ls "$D"/backups 2>/dev/null)" && ! -d "$D/logs" ]] && ok || fail "plan-only không tạo backups/logs"
expect_contains "plan-only thông báo stack không đổi" "stack, dữ liệu và thẻ image KHÔNG đổi" "$OUT"
expect_contains "plan-only gợi ý deploy thật" "bash deploy.sh" "$OUT"
expect_not_contains "gợi ý không còn --no-pull" "--no-pull" "$OUT"
mkdeploy; rd "STUB_VOLUMES=realestatemanager_mongo_data" "STUB_DRY_RC=4" -- --plan-only
expect_nonzero "plan-only dry-run mã 4" "$RC"; expect_contains "báo cần xử lý tay" "Cần xử lý tay" "$OUT"
mkdeploy; rd "STUB_VOLUMES=realestatemanager_mongo_data" -- --plan-only --no-migrate
expect_rc "plan-only thắng --no-migrate" 0 "$RC"; expect_contains "nói rõ plan-only thắng" "--plan-only thắng" "$OUT"

echo "== 9) Lỗi SAU up: KHÔNG rollback, IN lệnh restore =="
mkdeploy; rd "STUB_VOLUMES=realestatemanager_mongo_data" "STUB_UP_RC=1"
expect_nonzero "up lỗi" "$RC"
TSV="$(mval TS)"
expect_contains "in lệnh restore (dry-run)" "bash restore.sh --manifest backups/deploy-pre-$TSV.manifest" "$OUT"
expect_contains "in lệnh restore --apply --yes" "--apply --yes" "$OUT"
expect_contains "nói rõ không tự rollback" "KHÔNG tự rollback" "$OUT"
expect_contains "in hướng dẫn lùi image bằng thẻ pre" "docker tag realestatemanager-backend:pre-$TSV realestatemanager-backend:current" "$OUT"
expect_lt "up chạy rồi mới lỗi" "$(ln 'up -d --no-build')" "999999"
AFTER_UP="$(sed -n "$(( $(ln 'up -d --no-build') + 1 )),\$p" "$CALLS")"
expect_not_contains "KHÔNG rollback tự động sau up (không docker tag)" "docker tag" "$AFTER_UP"
expect_not_contains "KHÔNG chạy restore tự động" "mongorestore --archive" "$AFTER_UP"
expect_eq "manifest failed" "failed" "$(mval DEPLOY_STATUS)"
expect_eq "manifest STACK_TOUCHED=1" "1" "$(mval STACK_TOUCHED)"
expect_eq "manifest POST_UP_REACHED=0 (lỗi ngay ở up)" "0" "$(mval POST_UP_REACHED)"
mkdeploy; rd "STUB_VOLUMES=realestatemanager_mongo_data" "STUB_PM_FAIL=20-customer-codes"
expect_nonzero "post-migrate bước 20 lỗi" "$RC"
TSV="$(mval TS)"
expect_contains "tên bước lỗi" "20-customer-codes" "$OUT"
expect_contains "lỗi hậu-migrate vẫn in lệnh restore" "bash restore.sh --manifest backups/deploy-pre-$TSV.manifest" "$OUT"
expect_contains "cảnh báo bước 90 một chiều" "011" "$OUT"
has "post-migrate 90-post-up-migrations" && fail "bước 90 không được chạy sau khi bước 20 lỗi" || ok
expect_eq "POST_UP_REACHED=1" "1" "$(mval POST_UP_REACHED)"
expect_eq "manifest failed (post-migrate)" "failed" "$(mval DEPLOY_STATUS)"
mkdeploy; rd "STUB_VOLUMES=realestatemanager_mongo_data" "STUB_APPLY_RC=1"
expect_nonzero "reconcile --apply lỗi (trước up)" "$RC"
expect_contains "in lệnh restore khi migration chạy dở" "bash restore.sh --manifest" "$OUT"
has "up -d" && fail "reconcile lỗi: không được up" || ok
expect_eq "manifest STACK_TOUCHED=1 sau --apply lỗi" "1" "$(mval STACK_TOUCHED)"
expect_not_contains "STACK_TOUCHED=1: KHÔNG tự trả thẻ current sau --apply" "docker tag" "$(calls_after 'reconcile --apply')"
expect_eq "STACK_TOUCHED=1: không có PROMOTE_REVERT" "" "$(mval PROMOTE_REVERT)"
expect_contains "STACK_TOUCHED=1: vẫn in khung khôi phục" "DEPLOY THẤT BẠI" "$OUT"

echo "== 10) Lỗi SAU promote, TRƯỚC up (stack chưa đổi): TỰ trả thẻ current về image cũ, không in khung khôi phục =="
mkdeploy; rd "STUB_VOLUMES=realestatemanager_mongo_data" "STUB_DRY_RC=4"
expect_rc "dry-run mã 4 giữ mã lỗi gốc" 1 "$RC"
expect_contains "stack chưa đổi" "TRƯỚC khi đụng tới stack" "$OUT"
expect_not_contains "không in khung khôi phục" "DEPLOY THẤT BẠI" "$OUT"
TSV="$(mval TS)"
L_PRO="$(ln "docker tag $BE_REF realestatemanager-backend:current")"; L_PROF="$(ln "docker tag $FE_REF realestatemanager-frontend:current")"
L_RB="$(ln "docker tag realestatemanager-backend:pre-$TSV realestatemanager-backend:current")"
L_RF="$(ln "docker tag realestatemanager-frontend:pre-$TSV realestatemanager-frontend:current")"
expect_lt "promote BE -> tự trả thẻ BE" "$L_PRO" "$L_RB"
expect_lt "promote FE -> tự trả thẻ FE" "$L_PROF" "$L_RF"
expect_contains "log nói đã TỰ trả current" "TỰ trả current về image cũ" "$OUT"
expect_not_contains "đã trả thì không bắt làm tay" "docker tag" "$OUT"
has "up -d" && fail "không được up" || ok
expect_eq "manifest failed" "failed" "$(mval DEPLOY_STATUS)"
expect_eq "manifest STACK_TOUCHED=0" "0" "$(mval STACK_TOUCHED)"
expect_eq "manifest PROMOTE_REVERT=reverted" "reverted" "$(mval PROMOTE_REVERT)"
mkdeploy; rd "STUB_VOLUMES=realestatemanager_mongo_data" "STUB_TAG_RC=1"
expect_nonzero "gắn thẻ lỗi" "$RC"; expect_contains "báo lỗi gắn thẻ" "Không gắn được thẻ" "$OUT"
has "up -d" && fail "gắn thẻ lỗi: không được up" || ok
mkdeploy; rd "STUB_VOLUMES=realestatemanager_mongo_data" "STUB_DUMP_RC=1"
expect_nonzero "mongodump lỗi" "$RC"; expect_contains "báo mongodump" "mongodump thất bại" "$OUT"
has "docker tag" && fail "mongodump lỗi: không được gắn thẻ/promote" || ok
[[ -z "$(ls "$D"/backups/*.partial 2>/dev/null)" ]] && ok || fail "không để lại .partial"

echo "== 11) --no-migrate: runner status, không reconcile --apply trước up =="
mkdeploy; rd "STUB_VOLUMES=realestatemanager_mongo_data" -- --no-migrate
expect_rc "--no-migrate" 0 "$RC"; has "status --json" && ok || fail "thiếu runner status"
L_ST="$(ln 'status --json')"; L_UP="$(ln 'up -d --no-build')"; expect_lt "status trước up" "$L_ST" "$L_UP"
expect_not_contains "không reconcile --skip-version --apply" "--skip-version --phase pre-up" "$(sed -n "1,$((L_UP))p" "$CALLS" | grep 'reconcile --apply')"

echo "== 12) Cờ/hàm đã xóa không còn; tham số lạ bị từ chối =="
mkdeploy; rd -- --no-pull
expect_rc "--no-pull bị từ chối (mã 2)" 2 "$RC"; expect_contains "báo tham số không hợp lệ" "Tham số không hợp lệ" "$OUT"
no_change_calls "--no-pull"
mkdeploy; rd -- --migrate --no-migrate
expect_rc "--migrate + --no-migrate" 2 "$RC"
mkdeploy; rd -- --help
expect_rc "--help" 0 "$RC"; expect_contains "usage nêu release.env" "release.env" "$OUT"; expect_not_contains "usage không còn --no-pull" "--no-pull" "$OUT"
SRC="$(cat "$ROOT_DIR/deploy.sh")"
for pat in 'git_update' 'backup_code' 'build_backend' '--no-pull' 'NO_PULL' 'export GIT_COMMIT' 'up -d --build' 'compose build' 'git pull' 'git bundle' 'env.docker.*ENV_FILE'; do
  if grep -qE -- "$pat" "$ROOT_DIR/deploy.sh"; then fail "deploy.sh còn chứa [$pat]"; else ok; fi
done
expect_not_contains "deploy.sh không gọi docker pull" "docker pull" "$SRC"
expect_contains "deploy.sh bắt TERM" "trap 'exit 143' TERM" "$SRC"
expect_contains "deploy.sh bắt HUP" "trap 'exit 129' HUP" "$SRC"
expect_eq "mặc định ENV_FILE là .env" "1" "$(grep -c '^readonly ENV_FILE="${DEPLOY_ENV_FILE:-.env}"' "$ROOT_DIR/deploy.sh")"
mkdeploy; rd "DEPLOY_MIN_FREE_GB=99999999"
expect_nonzero "đĩa không đủ" "$RC"; expect_contains "báo thiếu đĩa" "Không đủ dung lượng" "$OUT"
has "image inspect" && fail "đĩa không đủ: dừng trước khi đọc image" || ok
no_change_calls "đĩa không đủ"

echo "== 13) Daily Crawler: cảnh báo khi chưa có cron.env và .env thiếu DAILY_CRAWLER_* =="
mkdeploy; rd "STUB_VOLUMES=realestatemanager_mongo_data" "STUB_CRON_RC=1"
expect_rc "thiếu cron.env vẫn deploy" 0 "$RC"; expect_contains "cảnh báo crawler" "Daily Crawler khởi tạo ở trạng thái TẮT" "$OUT"
mkdeploy; printf 'DAILY_CRAWLER_ACTIVE=true\n' >> "$D/.env"; rd "STUB_VOLUMES=realestatemanager_mongo_data" "STUB_CRON_RC=1"
expect_rc "thiếu cron.env, .env có khóa" 0 "$RC"; expect_not_contains "không cảnh báo khi .env có khóa" "Daily Crawler khởi tạo ở trạng thái TẮT" "$OUT"

echo "== 14) Tự trả thẻ current (lỗi SAU promote, TRƯỚC up): các nhánh =="
VOL="STUB_VOLUMES=realestatemanager_mongo_data"
REV_BE() { printf 'docker tag realestatemanager-backend:pre-%s realestatemanager-backend:current' "$1"; }
REV_FE() { printf 'docker tag realestatemanager-frontend:pre-%s realestatemanager-frontend:current' "$1"; }
# 14a) reconcile --apply báo mã 3 (runner không ghi gì => STACK_TOUCHED trả về 0) => vẫn trả thẻ, không in khung khôi phục
mkdeploy; rd "$VOL" "STUB_APPLY_RC=3"; TSV="$(mval TS)"
expect_nonzero "reconcile --apply mã 3" "$RC"
expect_eq "apply mã 3: STACK_TOUCHED trả về 0" "0" "$(mval STACK_TOUCHED)"
expect_eq "apply mã 3: PROMOTE_REVERT=reverted" "reverted" "$(mval PROMOTE_REVERT)"
has "$(REV_BE "$TSV")" && ok || fail "apply mã 3: phải trả thẻ BE"
has "$(REV_FE "$TSV")" && ok || fail "apply mã 3: phải trả thẻ FE"
expect_not_contains "apply mã 3: không in khung khôi phục" "DEPLOY THẤT BẠI" "$OUT"
# 14b) --no-migrate: cổng status báo cần baseline (mã 4) => trả thẻ
mkdeploy; rd "$VOL" "STUB_STATUS_RC=4" -- --no-migrate; TSV="$(mval TS)"
expect_nonzero "--no-migrate cần baseline" "$RC"
expect_eq "--no-migrate: PROMOTE_REVERT=reverted" "reverted" "$(mval PROMOTE_REVERT)"
has "$(REV_BE "$TSV")" && ok || fail "--no-migrate: phải trả thẻ BE"
# 14c) promote dở dang (BE đã đổi, FE promote lỗi), có image cũ: chỉ trả phần ĐÃ đổi (BE), không đụng thẻ FE
mkdeploy; rd "$VOL" "STUB_TAG_PROMOTE_FE_RC=1"; TSV="$(mval TS)"
expect_nonzero "promote FE lỗi" "$RC"; expect_contains "báo lỗi promote FE" "Không promote được realestatemanager-frontend" "$OUT"
has "$(REV_BE "$TSV")" && ok || fail "promote dở: phải trả thẻ BE đã đổi"
has "$(REV_FE "$TSV")" && fail "promote dở: FE chưa đổi thì không được đụng thẻ FE" || ok
expect_eq "promote dở: PROMOTE_REVERT=reverted" "reverted" "$(mval PROMOTE_REVERT)"
has "up -d" && fail "promote dở: không được up" || ok
# 14d) lần deploy đầu (không có image cũ), promote dở: không có gì để trả => none, không docker tag pre -> current
mkdeploy; rd "STUB_NO_CONTAINERS=1" "STUB_TAG_PROMOTE_FE_RC=1"
expect_nonzero "lần đầu, promote FE lỗi" "$RC"
expect_eq "lần đầu: PROMOTE_REVERT=none" "none" "$(mval PROMOTE_REVERT)"
expect_not_contains "lần đầu: không trả thẻ" ":pre-" "$(grep 'docker tag' "$CALLS")"
expect_contains "lần đầu: nói rõ không có image cũ" "không có image cũ để trả" "$OUT"
expect_eq "lần đầu: manifest failed" "failed" "$(mval DEPLOY_STATUS)"
# 14e) trả thẻ LỖI: cảnh báo + lệnh làm tay, KHÔNG che lỗi gốc, giữ mã thoát gốc (1)
mkdeploy; rd "$VOL" "STUB_DRY_RC=4" "STUB_TAG_REVERT_RC=1"; TSV="$(mval TS)"
expect_rc "trả thẻ lỗi: giữ mã thoát gốc" 1 "$RC"
expect_contains "trả thẻ lỗi: lỗi gốc vẫn hiện" "Cần xử lý tay" "$OUT"
expect_contains "trả thẻ lỗi: cảnh báo không tự trả được" "KHÔNG tự trả được" "$OUT"
expect_contains "trả thẻ lỗi: lệnh tay BE" "$(REV_BE "$TSV")" "$OUT"
expect_contains "trả thẻ lỗi: lệnh tay FE" "$(REV_FE "$TSV")" "$OUT"
expect_eq "trả thẻ lỗi: PROMOTE_REVERT=failed" "failed" "$(mval PROMOTE_REVERT)"
expect_eq "trả thẻ lỗi: DEPLOY_STATUS=failed (restore.sh chỉ hiểu started|succeeded|failed)" "failed" "$(mval DEPLOY_STATUS)"
# 14f) trả thẻ lỗi + bị TERM: mã thoát vẫn là 143 (không bị che thành 1)
mkdeploy; rd "$VOL" "STUB_DRY_SIGNAL=TERM" "STUB_TAG_REVERT_RC=1"
expect_rc "trả thẻ lỗi + TERM: mã 143" 143 "$RC"
expect_eq "trả thẻ lỗi + TERM: PROMOTE_REVERT=failed" "failed" "$(mval PROMOTE_REVERT)"
expect_eq "trả thẻ lỗi + TERM: manifest failed" "failed" "$(mval DEPLOY_STATUS)"

echo "== 15) Tín hiệu THẬT trong lúc deploy.sh chạy (stub tự gửi TERM/HUP cho deploy.sh) =="
mkdeploy; rd "$VOL" "STUB_UP_SIGNAL=TERM"
expect_rc "TERM trong lúc up: mã 143" 143 "$RC"
expect_eq "TERM trong lúc up: manifest failed (không ghi nhầm succeeded)" "failed" "$(mval DEPLOY_STATUS)"
expect_eq "TERM trong lúc up: STACK_TOUCHED=1" "1" "$(mval STACK_TOUCHED)"
expect_contains "TERM trong lúc up: in hướng dẫn khôi phục" "KHÔNG tự rollback" "$OUT"
expect_contains "TERM trong lúc up: có lệnh restore" "bash restore.sh --manifest" "$OUT"
expect_not_contains "TERM sau khi đụng stack: KHÔNG tự trả thẻ" "docker tag" "$(calls_after 'up -d --no-build')"
expect_eq "TERM trong lúc up: không có PROMOTE_REVERT" "" "$(mval PROMOTE_REVERT)"
if (( HUP_OK == 1 )); then
mkdeploy; rd "$VOL" "STUB_UP_SIGNAL=HUP"
expect_rc "HUP trong lúc up: mã 129" 129 "$RC"; expect_eq "HUP trong lúc up: manifest failed" "failed" "$(mval DEPLOY_STATUS)"
expect_eq "HUP trong lúc up: STACK_TOUCHED=1" "1" "$(mval STACK_TOUCHED)"
else echo "  (bỏ qua ca SIGHUP lúc up: SIGHUP bị bỏ qua từ lúc khởi động, vd chạy bằng nohup)"; fi
mkdeploy; rd "$VOL" "STUB_DRY_SIGNAL=TERM"; TSV="$(mval TS)"
expect_rc "TERM trước up: mã 143" 143 "$RC"; expect_eq "TERM trước up: manifest failed" "failed" "$(mval DEPLOY_STATUS)"
expect_eq "TERM trước up: STACK_TOUCHED=0" "0" "$(mval STACK_TOUCHED)"
expect_not_contains "TERM trước up: không in khung khôi phục" "DEPLOY THẤT BẠI" "$OUT"
expect_eq "TERM trước up: tự trả thẻ" "reverted" "$(mval PROMOTE_REVERT)"
has "$(REV_BE "$TSV")" && ok || fail "TERM trước up: phải trả thẻ BE"
has "up -d" && fail "TERM trước up: không được up" || ok
if (( HUP_OK == 1 )); then
mkdeploy; rd "$VOL" "STUB_DRY_SIGNAL=HUP"
expect_rc "HUP trước up: mã 129" 129 "$RC"; expect_eq "HUP trước up: tự trả thẻ" "reverted" "$(mval PROMOTE_REVERT)"
expect_eq "HUP trước up: manifest failed" "failed" "$(mval DEPLOY_STATUS)"
else echo "  (bỏ qua ca SIGHUP trước up: SIGHUP bị bỏ qua từ lúc khởi động, vd chạy bằng nohup)"; fi
# SIGKILL giữa chừng (trước up): không ai chốt được manifest nhưng nó ĐÃ có, kèm image dự phòng + version DB (ghi trước các bước dài)
mkdeploy; rd "$VOL" "STUB_DRY_SIGNAL=KILL"; TSV="$(mval TS)"
expect_nonzero "SIGKILL trước up: mã khác 0" "$RC"
expect_eq "SIGKILL trước up: manifest vẫn còn, DEPLOY_STATUS=started" "started" "$(mval DEPLOY_STATUS)"
expect_eq "SIGKILL trước up: BACKEND_PRE_IMAGE đã ghi" "realestatemanager-backend:pre-$TSV" "$(mval BACKEND_PRE_IMAGE)"
expect_eq "SIGKILL trước up: DB_VERSION_BEFORE đã ghi" "1.0.5" "$(mval DEPLOY_STATUS >/dev/null; mval DB_VERSION_BEFORE)"
expect_eq "SIGKILL trước up: FINISHED_AT rỗng" "" "$(mval FINISHED_AT)"
expect_eq "SIGKILL trước up: STACK_TOUCHED=0" "0" "$(mval STACK_TOUCHED)"

echo "== 15b) stderr CHẾT (/dev/full, như SSH rớt): giữ ĐÚNG mã thoát, manifest failed, vẫn trả thẻ =="
RD_DEAD_STDERR=1
mkdeploy; rd "$VOL" "STUB_UP_SIGNAL=TERM"
expect_rc "stderr chết + TERM sau khi đụng stack: mã 143 (không bị che thành 1)" 143 "$RC"
expect_eq "stderr chết + TERM trong up: manifest failed" "failed" "$(mval DEPLOY_STATUS)"
expect_eq "stderr chết + TERM trong up: STACK_TOUCHED=1" "1" "$(mval STACK_TOUCHED)"
mkdeploy; rd "$VOL" "STUB_DRY_SIGNAL=TERM"; TSV="$(mval TS)"
expect_rc "stderr chết + TERM trước up: mã 143" 143 "$RC"
expect_eq "stderr chết + TERM trước up: manifest failed" "failed" "$(mval DEPLOY_STATUS)"
expect_eq "stderr chết + TERM trước up: vẫn tự trả thẻ" "reverted" "$(mval PROMOTE_REVERT)"
has "$(REV_BE "$TSV")" && ok || fail "stderr chết + TERM trước up: phải trả thẻ BE"
mkdeploy; rd "$VOL" "STUB_DRY_RC=4"
expect_rc "stderr chết + lỗi trước up (mã 1)" 1 "$RC"
expect_eq "stderr chết + lỗi trước up: manifest failed" "failed" "$(mval DEPLOY_STATUS)"
expect_eq "stderr chết + lỗi trước up: vẫn tự trả thẻ" "reverted" "$(mval PROMOTE_REVERT)"
mkdeploy; rd "$VOL" "STUB_UP_RC=1"
expect_rc "stderr chết + up lỗi sau khi đụng stack (mã 1)" 1 "$RC"
expect_eq "stderr chết + up lỗi: manifest failed" "failed" "$(mval DEPLOY_STATUS)"
expect_eq "stderr chết + up lỗi: STACK_TOUCHED=1" "1" "$(mval STACK_TOUCHED)"
RD_DEAD_STDERR=""

# ── Thuộc tính kiểm được trên MỘT bản deploy.sh bất kỳ (bản thật hoặc bản đột biến), dùng cho mục 16-18. Mỗi prop đặt PROP_OK=1 (đạt) | 0 (hỏng),
#    để lại $D/$CALLS/$OUT/$RC của lần chạy cuối cho các kiểm tra chi tiết. Không gọi ok/fail (bản đột biến phải hỏng mà không làm bộ test hỏng).
prop_immediate() { # manifest được ghi TỨC THÌ (không chờ manifest_finish): soi tại lúc reconcile --apply / up / hậu-migrate, và sau SIGKILL giữa `up`
  local good=1
  DEPLOY_SRC="$1"
  mkdeploy; rd "$VOL"
  [[ "$RC" == "0" ]] || good=0
  grep -qxF 'MANIFEST_AT_APPLY STACK_TOUCHED=1' "$CALLS" || good=0
  grep -qxF 'MANIFEST_AT_UP STACK_TOUCHED=1' "$CALLS" || good=0
  grep -qxF 'MANIFEST_AT_PM 10-catalog-codes POST_UP_REACHED=1' "$CALLS" || good=0
  grep -qxF 'MANIFEST_AT_PM 90-post-up-migrations POST_UP_REACHED=1' "$CALLS" || good=0
  mkdeploy; rd "$VOL" "STUB_UP_SIGNAL=KILL" -- --no-migrate   # --no-migrate: chỉ dòng ghi trước `up` mới đặt được STACK_TOUCHED
  grep -qxF 'MANIFEST_AT_UP STACK_TOUCHED=1' "$CALLS" || good=0
  [[ "$RC" != "0" ]] || good=0
  [[ "$(mval STACK_TOUCHED)" == "1" ]] || good=0
  [[ "$(mval DEPLOY_STATUS)" == "started" ]] || good=0
  DEPLOY_SRC=""; PROP_OK=$good
}
prop_revert() { # lỗi sau promote, trước up => tự trả thẻ current + manifest PROMOTE_REVERT=reverted
  local good=1 tsv
  DEPLOY_SRC="$1"
  mkdeploy; rd "$VOL" "STUB_DRY_RC=4"; tsv="$(mval TS)"
  has "$(REV_BE "$tsv")" || good=0
  has "$(REV_FE "$tsv")" || good=0
  [[ "$(mval PROMOTE_REVERT)" == "reverted" ]] || good=0
  DEPLOY_SRC=""; PROP_OK=$good
}
prop_deadstderr() { # stderr chết + TERM trước up => mã 143 (không bị che) và manifest failed
  local good=1
  DEPLOY_SRC="$1"
  mkdeploy; RD_DEAD_STDERR=1 rd "$VOL" "STUB_DRY_SIGNAL=TERM"
  [[ "$RC" == "143" ]] || good=0
  [[ "$(mval DEPLOY_STATUS)" == "failed" ]] || good=0
  DEPLOY_SRC=""; PROP_OK=$good
}
TS_FIX="20260102-030405"
prop_ts() { # đã có backup cùng TS => dừng, KHÔNG ghi đè archive/.env/manifest cũ, không mongodump/tag/up
  local good=1
  DEPLOY_SRC="$1"
  mkdeploy; mkdir -p "$D/backups"
  printf 'SENTINEL-ARCHIVE' > "$D/backups/deploy-pre-$TS_FIX.archive.gz"
  printf 'SENTINEL-ENV' > "$D/backups/deploy-pre-$TS_FIX.env"
  printf 'SENTINEL-MANIFEST\n' > "$D/backups/deploy-pre-$TS_FIX.manifest"
  rd "$VOL" "STUB_TS=$TS_FIX"
  [[ "$RC" != "0" ]] || good=0
  grep -qaxF "SENTINEL-ARCHIVE" "$D/backups/deploy-pre-$TS_FIX.archive.gz" || good=0
  [[ "$(cat "$D/backups/deploy-pre-$TS_FIX.env")" == "SENTINEL-ENV" ]] || good=0
  [[ "$(cat "$D/backups/deploy-pre-$TS_FIX.manifest")" == "SENTINEL-MANIFEST" ]] || good=0
  ! has "mongodump" || good=0
  ! has "docker tag " || good=0
  ! has "up -d" || good=0
  DEPLOY_SRC=""; PROP_OK=$good
}
mutate() { # <tên> <đối số sed...>: tạo $TMP/<tên>.sh từ deploy.sh THẬT và kiểm nó đã THỰC SỰ khác bản thật (sed không khớp = mutation vô nghĩa)
  local name="$1"; shift
  sed "$@" "$ROOT_DIR/deploy.sh" > "$TMP/$name.sh"
  if cmp -s "$ROOT_DIR/deploy.sh" "$TMP/$name.sh"; then fail "mutation $name không đổi gì (sed không khớp)"; else ok; fi
}

echo "== 16) Manifest ghi TỨC THÌ: STACK_TOUCHED/POST_UP_REACHED có trong manifest ngay lúc làm (không chờ manifest_finish) =="
prop_immediate "$ROOT_DIR/deploy.sh"
expect_eq "manifest ghi tức thời (stub soi manifest tại apply/up/hậu-migrate; SIGKILL giữa up)" "1" "$PROP_OK"
expect_eq "SIGKILL giữa up: FINISHED_AT rỗng (không ai chốt)" "" "$(mval FINISHED_AT)"
expect_eq "SIGKILL giữa up: POST_UP_REACHED=0" "0" "$(mval POST_UP_REACHED)"
expect_eq "SIGKILL giữa up: không có PROMOTE_REVERT (tiến trình đã chết)" "" "$(mval PROMOTE_REVERT)"

echo "== 17) TS trùng nhau: dừng TRƯỚC mongodump/sao .env, không ghi đè backup/manifest cũ =="
# đối chứng: STUB_TS hoạt động và một lần deploy bình thường với TS cố định vẫn thành công (ca TS trùng bên dưới không rỗng nghĩa)
mkdeploy; rd "$VOL" "STUB_TS=$TS_FIX"
expect_rc "TS cố định, chưa có backup cũ" 0 "$RC"; expect_eq "manifest dùng TS của date stub" "$TS_FIX" "$(mval TS)"
prop_ts "$ROOT_DIR/deploy.sh"
expect_eq "TS trùng: dừng, không ghi đè archive/.env/manifest cũ" "1" "$PROP_OK"
expect_contains "TS trùng: báo đã có backup cùng mã thời gian" "cùng mã thời gian" "$OUT"
expect_contains "TS trùng: nói chưa đổi gì" "Chưa đổi gì" "$OUT"
# chỉ trùng manifest, bản deploy.sh bị bỏ kiểm check_ts_free: manifest_init vẫn không ghi đè và on_exit KHÔNG sửa manifest của lần chạy khác
mutate m15 -e '/^  check_ts_free  /d'
DEPLOY_SRC="$TMP/m15.sh"; mkdeploy; DEPLOY_SRC=""
mkdir -p "$D/backups"; printf 'SENTINEL-MANIFEST\n' > "$D/backups/deploy-pre-$TS_FIX.manifest"
rd "$VOL" "STUB_TS=$TS_FIX"
expect_nonzero "manifest_init: manifest cùng TS đã có" "$RC"; expect_contains "manifest_init báo đã có manifest" "Đã có backups/deploy-pre-$TS_FIX.manifest" "$OUT"
expect_eq "manifest_init: manifest cũ KHÔNG bị on_exit sửa" "SENTINEL-MANIFEST" "$(cat "$D/backups/deploy-pre-$TS_FIX.manifest")"
has "docker tag " && fail "manifest_init die: không được gắn thẻ/promote" || ok
has "up -d" && fail "manifest_init die: không được up" || ok

echo "== 17b) Manifest do deploy.sh THẬT sinh -> restore.sh THẬT đọc lại đúng (--list, dry-run, whitelist khóa) =="
# restore.sh THẬT chạy trong cùng thư mục deploy $D (nơi deploy.sh vừa ghi manifest), với docker/stat/flock GIẢ riêng cho restore (không dùng stub của deploy.sh).
STUBR="$TMP/stubr"; mkdir -p "$STUBR"
cat > "$STUBR/docker" <<'EOS'
#!/usr/bin/env bash
echo "docker $*" >> "$RCALLS"
case "${1:-}" in
  info) [[ "$*" == *DockerRootDir* ]] && echo "/"; exit 0 ;;
  inspect) case "$*" in *Health*) echo healthy ;; *State.Status*) echo running ;; esac; exit 0 ;;
  exec) case "$*" in *--dryRun*) cat > /dev/null; echo 'archive prelude `realestate.users`' ;; esac; exit 0 ;;
esac
exit 0
EOS
printf '#!/usr/bin/env bash\nexit 0\n' > "$STUBR/flock"
cat > "$STUBR/stat" <<'EOS'
#!/usr/bin/env bash
if [[ "$1" == "-c" && "$2" == "%a" ]]; then echo 600; exit 0; fi
exec /usr/bin/stat "$@"
EOS
chmod +x "$STUBR/docker" "$STUBR/flock" "$STUBR/stat"
RCALLS="$TMP/rcalls.log"
restore_run() { # <đối số restore.sh...> -> ROUT, RRC  (chạy trong $D hiện tại)
  cp "$ROOT_DIR/restore.sh" "$D/restore.sh"; : > "$RCALLS"
  ROUT="$(cd "$D" && env PATH="$STUBR:$PATH" RCALLS="$RCALLS" DEPLOY_MIN_FREE_GB=0 MONGO_INITDB_ROOT_PASSWORD=x bash restore.sh "$@" 2>&1)"
  RRC=$?
}
RS_KEYS=" $(sed -n 's/^readonly MANIFEST_KEYS="\(.*\)"$/\1/p' "$ROOT_DIR/restore.sh") "
manifest_keys_whitelisted() { # <manifest>: mọi khóa deploy.sh ghi đều nằm trong whitelist của restore.sh (khóa thiếu bị restore.sh lặng lẽ bỏ qua)
  local k bad=""
  for k in $(sed -n 's/^\([A-Z][A-Z0-9_]*\)=.*/\1/p' "$1"); do [[ "$RS_KEYS" == *" $k "* ]] || bad+=" $k"; done
  printf '%s' "$bad"
}
# (a) deploy thành công, đã qua hậu-migrate
mkdeploy; rd "$VOL" "DEPLOY_CD_RUN_ID=run-4242"; TSV="$(mval TS)"
expect_rc "17b(a): deploy thành công" 0 "$RC"
expect_eq "17b(a): restore.sh whitelist đủ khóa deploy.sh ghi" "" "$(manifest_keys_whitelisted "$(manifest)")"
restore_run --list
expect_rc "17b(a): restore --list đọc manifest của deploy.sh" 0 "$RRC"
expect_not_contains "17b(a): --list không báo manifest hỏng" "MANIFEST HỎNG" "$ROUT"
expect_contains "17b(a): --list thấy tên manifest" "deploy-pre-$TSV.manifest" "$ROUT"
expect_contains "17b(a): --list đọc DEPLOY_STATUS" "trạng thái deploy: succeeded" "$ROUT"
expect_contains "17b(a): --list đọc RELEASE_VERSION" "bản phát hành: 1.0.6" "$ROUT"
expect_contains "17b(a): --list đọc CD_RUN_ID" "CD run: run-4242" "$ROUT"
expect_contains "17b(a): --list đọc DB_VERSION_BEFORE" "version DB trước deploy: 1.0.5" "$ROUT"
expect_contains "17b(a): --list thấy backup Mongo" "backup Mongo: có" "$ROUT"
expect_contains "17b(a): --list đọc image dự phòng" "realestatemanager-backend:pre-$TSV + realestatemanager-frontend:pre-$TSV" "$ROUT"
expect_contains "17b(a): --list đọc POST_UP_REACHED (cảnh báo một chiều)" "đã qua điểm hậu-migrate" "$ROUT"
restore_run --manifest "backups/deploy-pre-$TSV.manifest"
expect_rc "17b(a): restore dry-run đọc manifest của deploy.sh" 0 "$RRC"
expect_contains "17b(a): dry-run qua kiểm backup Mongo" "[ĐẠT]  backup Mongo" "$ROUT"
expect_contains "17b(a): dry-run: hai image dự phòng còn" "hai image dự phòng realestatemanager-backend:pre-$TSV và realestatemanager-frontend:pre-$TSV còn trên máy" "$ROUT"
expect_contains "17b(a): dry-run: kế hoạch gắn thẻ current từ pre-<TS>" "gắn thẻ realestatemanager-backend:pre-$TSV -> realestatemanager-backend:current" "$ROUT"
expect_not_contains "17b(a): dry-run: không cảnh báo PROMOTE_REVERT (deploy thành công)" "PROMOTE_REVERT" "$ROUT"
restore_run --latest
expect_rc "17b(a): restore --latest chọn manifest của deploy.sh" 0 "$RRC"; expect_contains "17b(a): --latest dùng đúng manifest" "backups/deploy-pre-$TSV.manifest" "$ROUT"
# (b) lỗi trước up, trả thẻ THẤT BẠI: manifest có PROMOTE_REVERT=failed => restore.sh đọc được khóa và cảnh báo
mkdeploy; rd "$VOL" "STUB_DRY_RC=4" "STUB_TAG_REVERT_RC=1"; TSV="$(mval TS)"
expect_eq "17b(b): deploy ghi PROMOTE_REVERT=failed" "failed" "$(mval PROMOTE_REVERT)"
expect_eq "17b(b): restore.sh whitelist đủ khóa (gồm PROMOTE_REVERT)" "" "$(manifest_keys_whitelisted "$(manifest)")"
restore_run --manifest "backups/deploy-pre-$TSV.manifest"
expect_rc "17b(b): restore dry-run đọc manifest failed" 0 "$RRC"
expect_contains "17b(b): đọc DEPLOY_STATUS=failed" "DEPLOY_STATUS=failed" "$ROUT"
expect_contains "17b(b): đọc PROMOTE_REVERT=failed và cảnh báo" "PROMOTE_REVERT=failed" "$ROUT"
restore_run --list
expect_contains "17b(b): --list nhắc PROMOTE_REVERT=failed" "PROMOTE_REVERT=failed" "$ROUT"
# (c) lỗi trước up, trả thẻ THÀNH CÔNG (reverted): đọc được, không cảnh báo thẻ
mkdeploy; rd "$VOL" "STUB_DRY_RC=4"; TSV="$(mval TS)"
expect_eq "17b(c): deploy ghi PROMOTE_REVERT=reverted" "reverted" "$(mval PROMOTE_REVERT)"
restore_run --manifest "backups/deploy-pre-$TSV.manifest"
expect_rc "17b(c): restore dry-run đọc manifest reverted" 0 "$RRC"; expect_not_contains "17b(c): reverted: không cảnh báo thẻ" "VẪN là image MỚI" "$ROUT"
# (d) lần đầu (không có image cũ) và dừng dở: PROMOTE_REVERT=none; manifest rỗng khóa vẫn đọc được (--list không báo hỏng)
mkdeploy; rd "STUB_NO_CONTAINERS=1" "STUB_TAG_PROMOTE_FE_RC=1"
expect_eq "17b(d): deploy ghi PROMOTE_REVERT=none" "none" "$(mval PROMOTE_REVERT)"
restore_run --list
expect_rc "17b(d): --list đọc manifest lần đầu" 0 "$RRC"; expect_not_contains "17b(d): không báo manifest hỏng" "MANIFEST HỎNG" "$ROUT"
# (e) bị SIGKILL giữa up: manifest ở trạng thái started vẫn đọc được
mkdeploy; rd "$VOL" "STUB_UP_SIGNAL=KILL" -- --no-migrate
expect_eq "17b(e): manifest started" "started" "$(mval DEPLOY_STATUS)"
restore_run --list
expect_rc "17b(e): --list đọc manifest started" 0 "$RRC"; expect_not_contains "17b(e): không báo manifest hỏng" "MANIFEST HỎNG" "$ROUT"; expect_contains "17b(e): thấy trạng thái started" "trạng thái deploy: started" "$ROUT"
# Đối chứng: bỏ PROMOTE_REVERT khỏi whitelist của restore.sh => kiểm whitelist phải BÁO THIẾU (test không rỗng nghĩa).
RS_KEYS_SAVE="$RS_KEYS"; RS_KEYS="${RS_KEYS/ PROMOTE_REVERT / }"
mkdeploy; rd "$VOL" "STUB_DRY_RC=4" "STUB_TAG_REVERT_RC=1"
expect_eq "17b(đối chứng): whitelist thiếu PROMOTE_REVERT bị báo" " PROMOTE_REVERT" "$(manifest_keys_whitelisted "$(manifest)")"
RS_KEYS="$RS_KEYS_SAVE"

echo "== 18) Mutation tự kiểm: bản đột biến PHẢI bị bắt =="
prop_revert "$ROOT_DIR/deploy.sh"; expect_eq "bản thật: tự trả thẻ" "1" "$PROP_OK"
prop_deadstderr "$ROOT_DIR/deploy.sh"; expect_eq "bản thật: stderr chết vẫn mã 143" "1" "$PROP_OK"
# m12: bỏ ghi manifest tức thời (STACK_TOUCHED/POST_UP_REACHED chỉ còn ghi lúc manifest_finish)
mutate m12 -e 's/; manifest_set STACK_TOUCHED 1//' -e 's/; manifest_set POST_UP_REACHED 1//'
expect_eq "m12 không còn dòng ghi tức thời STACK_TOUCHED=1" "0" "$(grep -c 'manifest_set STACK_TOUCHED 1' "$TMP/m12.sh")"
expect_eq "m12 không còn dòng ghi tức thời POST_UP_REACHED=1" "0" "$(grep -c 'manifest_set POST_UP_REACHED 1' "$TMP/m12.sh")"
prop_immediate "$TMP/m12.sh"; expect_eq "m12 (bỏ ghi manifest tức thời) BỊ BẮT" "0" "$PROP_OK"
# m13: bỏ việc tự trả thẻ trong on_exit
mutate m13 -e '/then revert_promoted_images; fi/d'
prop_revert "$TMP/m13.sh"; expect_eq "m13 (bỏ tự trả thẻ) BỊ BẮT" "0" "$PROP_OK"
# m14: bỏ `set +e` khỏi on_exit (stderr chết + set -e che mất mã thoát)
mutate m14 -e '/^on_exit() {/,/^}/{/^  set +e/d}'
prop_deadstderr "$TMP/m14.sh"; expect_eq "m14 (bỏ set +e trong on_exit) BỊ BẮT" "0" "$PROP_OK"
# m15: bỏ kiểm TS trùng trước mongodump/sao .env (backup cũ bị ghi đè)
prop_ts "$TMP/m15.sh"; expect_eq "m15 (bỏ kiểm TS trùng) BỊ BẮT" "0" "$PROP_OK"

echo
echo "Kết quả: $PASS đạt, $FAIL hỏng"
(( FAIL == 0 )) || exit 1
exit 0
