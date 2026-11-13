#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# ops/tests/layout.test.sh — test shell KHÔNG cần Docker/Mongo thật cho cấu trúc thư mục script vận hành (Plan 07, Đợt 1):
#   FR-01  backup.sh/restore.sh/deploy.sh cùng ở gốc repo; ROOT_DIR = thư mục CHỨA script (chạy thật từ thư mục khác).
#   FR-02  ops/ chứa đúng phần phụ trợ; scripts/ chỉ còn run-migration.sh và post-migrate/*; không file nào bị mất.
#   FR-03  không còn đường dẫn cũ (scripts/backup.sh, scripts/restore.sh, scripts/lib/, scripts/tests/ ...) trong mã/test/cấu hình;
#          mọi dòng `source ... ops-common.sh` trỏ tới file có thật; restore từ bản sao ngoài repo (RESTORE_REPO_DIR) -> test 21
#          của ops/tests/restore.test.sh (FR-03).
# Mỗi tên ca có tiền tố [FR-xx] = FR mà ca đó kiểm.
#
# Chạy:  bash ops/tests/layout.test.sh      (thoát 0 nếu mọi ca đạt, 1 nếu có ca hỏng)
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$TEST_DIR/../.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

PASS=0
FAIL=0
ok()   { PASS=$((PASS + 1)); }
fail() { FAIL=$((FAIL + 1)); printf 'FAIL: %s\n' "$*" >&2; }
expect_eq() { if [[ "$2" == "$3" ]]; then ok; else fail "$1: mong đợi [$2], nhận [$3]"; fi; }
expect_file() { if [[ -f "$ROOT_DIR/$2" ]]; then ok; else fail "$1: thiếu file $2"; fi; }
expect_no_file() { if [[ ! -e "$ROOT_DIR/$2" ]]; then ok; else fail "$1: $2 không được tồn tại"; fi; }

# ── FR-01: ba script ở gốc repo ──────────────────────────────────────────────
echo "== 1) [FR-01] backup.sh, restore.sh, deploy.sh cùng ở gốc repo =="
for f in backup.sh restore.sh deploy.sh; do
  expect_file "[FR-01] $f ở gốc" "$f"
done
expect_no_file "[FR-01] scripts/backup.sh đã dời" "scripts/backup.sh"
expect_no_file "[FR-01] scripts/restore.sh đã dời" "scripts/restore.sh"

# ROOT_DIR THẬT: dựng cây tạm (script + ops/lib), thay dòng `main "$@"` cuối file bằng lệnh in ROOT_DIR rồi chạy từ một cwd KHÁC.
# Kỳ vọng: ROOT_DIR = thư mục chứa script (không phải thư mục cha của nó, không phụ thuộc cwd).
echo "== 2) [FR-01] ROOT_DIR = thư mục chứa script (chạy thật từ cwd khác) =="
for f in backup.sh restore.sh deploy.sh; do
  T="$TMP/root-$f"; mkdir -p "$T/ops/lib" "$TMP/elsewhere"
  cp "$ROOT_DIR/$f" "$T/$f"; cp "$ROOT_DIR/ops/lib/ops-common.sh" "$T/ops/lib/ops-common.sh"
  sed -i 's/^main "\$@"$/printf "%s" "$ROOT_DIR"; exit 0/' "$T/$f"
  got="$(cd "$TMP/elsewhere" && env -i PATH="$PATH" HOME="${HOME:-/}" bash "$T/$f" 2>&1)"
  want="$(cd "$T" && pwd)"
  expect_eq "[FR-01] ROOT_DIR của $f = thư mục chứa nó" "$want" "$got"
done

# ── FR-02: cây ops/ và scripts/ ──────────────────────────────────────────────
echo "== 3) [FR-02] ops/ chứa đúng phần phụ trợ; không file nào bị mất =="
for p in ops/lib/ops-common.sh ops/check-disk.sh ops/print-image-digests.sh ops/staging.sh \
         ops/staging/REHEARSAL.md ops/staging/rehearsal-snapshot.js ops/staging/rehearsal-step3.js ops/staging/seed-prod102.js \
         ops/staging/shims/chown ops/staging/shims/docker ops/staging/shims/install ops/staging/shims/stat \
         ops/tests/backup.test.sh ops/tests/deploy-catalog-codes.test.sh ops/tests/deploy-code-backup.test.sh \
         ops/tests/deploy-post-migrate.test.sh ops/tests/ops-common.test.sh ops/tests/restore.test.sh ops/tests/staging.test.sh \
         ops/tests/layout.test.sh ops/verify-env.sh ops/tests/verify-env.test.sh; do
  expect_file "[FR-02] $p" "$p"
done

echo "== 4) [FR-02] scripts/ chỉ còn run-migration.sh và post-migrate/* =="
SCRIPTS_LIST="$(cd "$ROOT_DIR" && find scripts -type f | LC_ALL=C sort | tr '\n' ' ')"
expect_eq "[FR-02] scripts/ chỉ còn hai mục" \
  "scripts/post-migrate/10-catalog-codes.sh scripts/post-migrate/20-customer-codes.sh scripts/post-migrate/90-post-up-migrations.sh scripts/run-migration.sh " \
  "$SCRIPTS_LIST"
for d in lib tests staging; do expect_no_file "[FR-02] scripts/$d đã dời" "scripts/$d"; done
for f in check-disk.sh print-image-digests.sh staging.sh; do expect_no_file "[FR-02] scripts/$f đã dời" "scripts/$f"; done

# ── FR-03: không còn đường dẫn cũ, source đúng ──────────────────────────────
echo "== 5) [FR-03] không còn đường dẫn cũ trong mã/test/cấu hình =="
# Mẫu đường dẫn cũ: ghép bằng printf để file test này không tự khớp. Phạm vi: script, test, compose, env mẫu, .gitattributes.
OLD_RE="$(printf 'scripts/(%s)' 'backup\.sh|restore\.sh|lib\b|tests\b|check-disk\.sh|print-image-digests\.sh|staging\.sh|staging\b')"
HITS="$(cd "$ROOT_DIR" && grep -rInE "$OLD_RE" deploy.sh backup.sh restore.sh ops scripts docker-compose.yml docker-compose.staging.yml \
  .env.example .env.staging.example .gitattributes --exclude=layout.test.sh 2>/dev/null | cut -c1-160 || true)"
expect_eq "[FR-03] grep đường dẫn cũ trả về 0 chỗ" "" "$HITS"

echo "== 6) [FR-03] mọi dòng source ops-common.sh trỏ tới file có thật =="
for f in deploy.sh backup.sh ops/check-disk.sh ops/staging.sh scripts/run-migration.sh; do
  expect_eq "[FR-03] $f source \$ROOT_DIR/ops/lib/ops-common.sh" "1" \
    "$(grep -cF 'source "$ROOT_DIR/ops/lib/ops-common.sh"' "$ROOT_DIR/$f")"
done
expect_eq "[FR-03] restore.sh nạp lib từ ops/lib cạnh script" "1" "$(grep -cF 'LIB_DIR="$(cd "$(dirname "$_self")/ops/lib"' "$ROOT_DIR/restore.sh")"
for s in "$ROOT_DIR"/scripts/post-migrate/*.sh; do
  expect_eq "[FR-03] $(basename "$s") source ../../ops/lib/ops-common.sh" "1" "$(grep -cF 'source "$STEP_DIR/../../ops/lib/ops-common.sh"' "$s")"
  [[ -f "$(dirname "$s")/../../ops/lib/ops-common.sh" ]] && ok || fail "[FR-03] $(basename "$s"): ../../ops/lib/ops-common.sh không tồn tại"
done

echo "== 7) [FR-03] cú pháp bash hợp lệ + --help chạy được từ cwd khác =="
for f in deploy.sh backup.sh restore.sh ops/check-disk.sh ops/print-image-digests.sh ops/staging.sh ops/verify-env.sh scripts/run-migration.sh \
         ops/lib/ops-common.sh scripts/post-migrate/10-catalog-codes.sh scripts/post-migrate/20-customer-codes.sh scripts/post-migrate/90-post-up-migrations.sh; do
  if bash -n "$ROOT_DIR/$f" 2>/dev/null; then ok; else fail "[FR-03] bash -n $f lỗi cú pháp"; fi
done
for f in deploy.sh backup.sh restore.sh scripts/run-migration.sh ops/check-disk.sh ops/verify-env.sh; do
  out="$(cd "$TMP" && env -i PATH="$PATH" HOME="${HOME:-/}" bash "$ROOT_DIR/$f" --help 2>&1)"; rc=$?
  expect_eq "[FR-03] bash $f --help thoát 0 (nạp được lib ở đường dẫn mới)" "0" "$rc"
  [[ -n "$out" ]] && ok || fail "[FR-03] $f --help không in gì"
done

printf '\nKết quả: %d đạt, %d hỏng.\n' "$PASS" "$FAIL"
(( FAIL == 0 ))
