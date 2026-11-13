#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# ops/tests/docs-paths.test.sh — kiểm FR-04 (Plan 07): tài liệu còn hiệu lực dùng đường dẫn script MỚI, lệnh mẫu trỏ tới file có thật.
#   [FR-04] docs/ không còn đường dẫn script cũ (backup, restore, lib, tests, check-disk, print-image-digests, staging nằm dưới scripts/ trước v1.0.6),
#           trừ các tài liệu v1.0.6 mô tả chính việc dời (07/08/10/11 *_Thong_Nhat_Moi_Truong_*, 08_So_Do_CICD) và dòng ghi chú lịch sử
#           trong 06_Production_Deploy.md ("Ghi chú đường dẫn cũ").
#   [FR-04] mọi lệnh `bash <file>.sh` / `bash ops/...` trong 06_Production_Deploy.md trỏ tới file tồn tại.
#   [FR-04] các lệnh mẫu có --help chạy được nguyên văn ở gốc repo (bash restore.sh --help, bash backup.sh --help ...).
#
# Chạy:  bash ops/tests/docs-paths.test.sh      (thoát 0 nếu mọi ca đạt, 1 nếu có ca hỏng)
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$TEST_DIR/../.." && pwd)"
DOC="$ROOT_DIR/docs/01_Infrastructure/06_Production_Deploy.md"

PASS=0
FAIL=0
ok()   { PASS=$((PASS + 1)); }
fail() { FAIL=$((FAIL + 1)); printf 'FAIL: %s\n' "$*" >&2; }
expect_eq() { if [[ "$2" == "$3" ]]; then ok; else fail "$1: mong đợi [$2], nhận [$3]"; fi; }

echo "== 1) [FR-04] docs/ không còn đường dẫn script cũ =="
# Mẫu ghép bằng printf để file này không tự khớp (nó nằm ngoài docs/ nên vẫn an toàn, ghép cho rõ ý).
OLD_RE="$(printf 'scripts/(%s)' 'backup\.sh|restore\.sh|lib\b|tests\b|check-disk\.sh|print-image-digests\.sh|staging\.sh|staging\b')"
HITS="$(cd "$ROOT_DIR" && grep -rInE "$OLD_RE" docs \
  --exclude='*_Thong_Nhat_Moi_Truong_*.md' --exclude='08_So_Do_CICD.md' | grep -v 'Ghi chú đường dẫn cũ' | cut -c1-140 || true)"
expect_eq "[FR-04] grep docs/ (tài liệu còn hiệu lực) trả về 0 chỗ" "" "$HITS"

echo "== 2) [FR-04] lệnh mẫu trong 06_Production_Deploy.md trỏ tới file có thật =="
[[ -f "$DOC" ]] && ok || fail "[FR-04] thiếu $DOC"
# Lấy mọi token đường dẫn sau `bash ` / `./` có đuôi .sh (bỏ qua <bản-sao>/ và /tmp/ là đường dẫn minh họa ngoài repo).
mapfile -t CMDS < <(grep -oE '(bash|\./)[ ]?[A-Za-z0-9_./-]+\.sh' "$DOC" | sed -E 's#^(bash[ ]+|\./)##' | grep -vE '^/|^<|\.\.' | sort -u)
(( ${#CMDS[@]} > 0 )) && ok || fail "[FR-04] không trích được lệnh nào từ doc 06"
for c in "${CMDS[@]}"; do
  if [[ -f "$ROOT_DIR/$c" ]]; then ok; else fail "[FR-04] doc 06 nhắc lệnh '$c' nhưng file không tồn tại ở gốc repo"; fi
done

echo "== 3) [FR-04] lệnh mẫu chạy được nguyên văn từ gốc repo (--help) =="
for c in restore.sh backup.sh deploy.sh scripts/run-migration.sh ops/check-disk.sh; do
  grep -qF "$c" "$DOC" && ok || fail "[FR-04] doc 06 không nhắc '$c'"
  out="$(cd "$ROOT_DIR" && env -i PATH="$PATH" HOME="${HOME:-/}" bash "$c" --help 2>&1)"; rc=$?
  expect_eq "[FR-04] (cd gốc repo) bash $c --help" "0" "$rc"
done

printf '\nKết quả: %d đạt, %d hỏng.\n' "$PASS" "$FAIL"
(( FAIL == 0 ))
