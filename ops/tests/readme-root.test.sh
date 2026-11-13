#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# ops/tests/readme-root.test.sh — kiểm FR-13 (Plan 07, T-13): README.md gốc repo + quy ước đồng bộ prototype. Test tĩnh, không cần Docker/Mongo.
#   [FR-13] README.md gốc có đúng 6 mục `## 1.` .. `## 6.` theo Architecture 5.10, viết tiếng Việt (có dấu).
#   [FR-13] README không chứa IP, `vboxuser`, lệnh ssh, mẫu bí mật (mật khẩu/token/khóa).
#   [FR-13] mọi đường dẫn trong dấu backtick của README tồn tại thật, TRỪ token đã biết là sẽ có ở v1.0.6 (release.sh, .env.example gốc, docker-compose.dev*.yml gốc, .github/workflows) và dòng chứa nó phải có "(sẽ có ở v1.0.6" (chưa có;
#           T-37 sẽ rà lại README cho khớp lệnh thật).
#   [FR-13] README nêu `RealEstateApp/` không thuộc luồng build/deploy, trỏ tài liệu 06/08/09 và mục lục docs/README.md.
#   [FR-13] doc 03 có mục quy ước đồng bộ prototype (ngoại lệ PWA/push/standalone FR-28, FR-27 vẫn đồng bộ).
#   [FR-13] .claude/agents/qa-agent.md (A-03) có đúng MỘT dòng nhắc quy ước đồng bộ prototype (bỏ qua nếu file vắng: thư mục .claude/ không nằm trong git).
#
# Chạy:  bash ops/tests/readme-root.test.sh      (thoát 0 nếu mọi ca đạt, 1 nếu có ca hỏng)
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$TEST_DIR/../.." && pwd)"
README="$ROOT_DIR/README.md"
DOC03="$ROOT_DIR/docs/06_Module_Customer_Management/03_Design_System_Quy_Tac_Phong_Cach.md"
QA="$ROOT_DIR/.claude/agents/qa-agent.md"

PASS=0
FAIL=0
ok()   { PASS=$((PASS + 1)); }
fail() { FAIL=$((FAIL + 1)); printf 'FAIL: %s\n' "$*" >&2; }
expect_eq() { if [[ "$2" == "$3" ]]; then ok; else fail "$1: mong đợi [$2], nhận [$3]"; fi; }
expect_has() { if grep -qF -- "$3" "$2"; then ok; else fail "$1: thiếu chuỗi [$3] trong ${2#"$ROOT_DIR"/}"; fi; }

echo "== 1) [FR-13] README.md gốc có đủ 6 mục =="
[[ -f "$README" ]] && ok || { fail "[FR-13] thiếu README.md ở gốc repo"; printf '\nKết quả: %d đạt, %d hỏng.\n' "$PASS" "$FAIL"; exit 1; }
HEADS="$(grep -E '^## ' "$README" | tr '\n' '|')"
expect_eq "[FR-13] tên 6 tiêu đề mục" "## 1. Dự án gồm những gì|## 2. Cấu trúc thư mục cấp 1|## 3. Chạy môi trường dev|## 4. Build và deploy|## 5. Mục lục tài liệu|## 6. Quy ước đồng bộ giao diện sang prototype|" "$HEADS"
grep -qE '^# ' "$README" && ok || fail "[FR-13] README thiếu tiêu đề cấp 1"
grep -qE '[ạảãàáâấầẩẫậăắằẳẵặẹẻẽèéêếềểễệịỉĩìíọỏõòóôốồổỗộơớờởỡợụủũùúưứừửữựỳỷỹýđ]' "$README" && ok || fail "[FR-13] README không có tiếng Việt có dấu"

echo "== 2) [FR-13] README không chứa IP/bí mật/địa chỉ VPS =="
IP_HITS="$(grep -nE '\b[0-9]{1,3}(\.[0-9]{1,3}){3}\b' "$README" || true)"
expect_eq "[FR-13] không có địa chỉ IP" "" "$IP_HITS"
VPS_HITS="$(grep -niE 'vboxuser|ssh |ssh:|tailscale|100\.[0-9]+\.|\.ts\.net' "$README" || true)"
expect_eq "[FR-13] không có vboxuser/ssh/địa chỉ VPS" "" "$VPS_HITS"
SECRET_HITS="$(grep -niE '(password|passwd|secret|token|api[_-]?key|private[_-]?key)[[:space:]]*[=:][[:space:]]*[^[:space:]]|sk-[A-Za-z0-9]{10,}|BEGIN [A-Z ]*PRIVATE KEY|mongodb(\+srv)?://[^[:space:]]*@' "$README" || true)"
expect_eq "[FR-13] không có mẫu bí mật" "" "$SECRET_HITS"

echo "== 3) [FR-13] mọi đường dẫn trong README tồn tại (trừ token đã biết là 'sẽ có ở v1.0.6') =="
# Token CHƯA có ở gốc repo nhưng README được phép nhắc, miễn dòng chứa nó có đánh dấu "(sẽ có ở v1.0.6" (T-37 rà lại khi lệnh thật xuất hiện).
FUTURE_TOKENS=" release.sh .env.example docker-compose.dev.yml docker-compose.dev-watch.yml .github/workflows "
# Đuôi nhận là đường dẫn: thư mục (/), .sh .md .yml .yaml .json .ts .tsx .py .example, hoặc .env.<hậu tố>; `.env` trần (bí mật, không commit) không kiểm.
PATH_RE='^[A-Za-z0-9_.][A-Za-z0-9_./-]*(/|\.sh|\.md|\.ya?ml|\.json|\.tsx?|\.py|\.example)$|^([A-Za-z0-9_.-]+/)*\.env\.[A-Za-z0-9_.-]+$'
CHECKED=0
while IFS= read -r line; do
  # Lấy từng đoạn nằm trong cặp dấu backtick, tách theo khoảng trắng, giữ token trông như đường dẫn tệp/thư mục.
  while IFS= read -r span; do
    for tok in $span; do
      tok="${tok%%[,;.]}"                                  # bỏ dấu câu cuối
      [[ "$tok" =~ ^(https?:|-|<|/|\.\.) ]] && continue    # URL, cờ, mẫu minh họa, đường dẫn tuyệt đối/ngoài repo
      [[ "$tok" =~ $PATH_RE ]] || continue
      CHECKED=$((CHECKED + 1))
      if [[ -e "$ROOT_DIR/${tok%/}" ]]; then ok
      elif [[ "$FUTURE_TOKENS" == *" ${tok%/} "* ]]; then
        [[ "$line" == *"(sẽ có ở v1.0.6"* ]] && ok || fail "[FR-13] README nhắc '$tok' (chưa có) mà dòng không đánh dấu '(sẽ có ở v1.0.6'"
      else fail "[FR-13] README nhắc '$tok' nhưng không tồn tại ở gốc repo"; fi
    done
  done < <(printf '%s\n' "$line" | grep -oE '`[^`]+`' | tr -d '`')
done < "$README"
(( CHECKED >= 15 )) && ok || fail "[FR-13] chỉ kiểm được $CHECKED đường dẫn (mong đợi >= 15); mẫu trích có thể hỏng"

echo "== 4) [FR-13] nội dung bắt buộc của 6 mục =="
expect_has "[FR-13] mục 2 trỏ sơ đồ thư mục" "$README" "docs/01_Infrastructure/09_So_Do_Cau_Truc_Thu_Muc.md"
grep -E 'RealEstateApp/.*không thuộc luồng build/deploy' "$README" >/dev/null && ok || fail "[FR-13] README không nêu RealEstateApp/ nằm ngoài luồng build/deploy"
expect_has "[FR-13] mục 4 trỏ doc 06" "$README" "docs/01_Infrastructure/06_Production_Deploy.md"
expect_has "[FR-13] mục 4 trỏ doc 08" "$README" "docs/01_Infrastructure/08_So_Do_CICD.md"
expect_has "[FR-13] mục 4 nêu deploy.sh" "$README" "deploy.sh"
expect_has "[FR-13] mục 4 nêu backup.sh" "$README" "backup.sh"
expect_has "[FR-13] mục 4 nêu restore.sh" "$README" "restore.sh"
expect_has "[FR-13] mục 5 trỏ mục lục docs" "$README" "docs/README.md"
expect_has "[FR-13] mục 6 nêu prototype" "$README" "stnd-crm-unified/"
expect_has "[FR-13] mục 6 nêu ngoại lệ FR-28" "$README" "FR-28"
expect_has "[FR-13] lệnh chưa có được đánh dấu v1.0.6" "$README" "(sẽ có ở v1.0.6"
# Mục 3: nếu lệnh/tệp mới chưa tồn tại thì README phải ghi rõ "sẽ có ở v1.0.6" (không được nêu như đang có).
if [[ ! -e "$ROOT_DIR/release.sh" ]]; then
  # shellcheck disable=SC2016
  while IFS= read -r l; do
    [[ "$l" == *"(sẽ có ở v1.0.6"* ]] && ok || fail "[FR-13] README nhắc release.sh (chưa có) mà không đánh dấu v1.0.6: $l"
  done < <(grep -F 'release.sh' "$README")
fi

echo "== 5) [FR-13] doc 03 có quy ước đồng bộ prototype =="
[[ -f "$DOC03" ]] && ok || fail "[FR-13] thiếu doc 03"
grep -qE '^## 11\. Quy ước đồng bộ giao diện sang prototype' "$DOC03" && ok || fail "[FR-13] doc 03 thiếu mục 11 'Quy ước đồng bộ giao diện sang prototype'"
SECTION="$(sed -n '/^## 11\. Quy ước đồng bộ/,$p' "$DOC03" | tr -d '\r')"
for needle in "stnd-crm-unified" "RealEstateAdminApp" "PWA" "FR-28" "FR-27" "standalone"; do
  if grep -qF -- "$needle" <<<"$SECTION"; then ok; else fail "[FR-13] mục 11 doc 03 thiếu '$needle'"; fi
done

echo "== 6) [FR-13][A-03] qa-agent.md có đúng một dòng nhắc đồng bộ prototype =="
if [[ -f "$QA" ]]; then
  N="$(grep -c 'stnd-crm-unified' "$QA" || true)"
  expect_eq "[FR-13] số dòng nhắc stnd-crm-unified trong qa-agent.md" "1" "$N"
  grep 'stnd-crm-unified' "$QA" | grep -q 'FR-28' && ok || fail "[FR-13] dòng đồng bộ prototype thiếu ngoại lệ FR-28"
else
  echo "  (bỏ qua: .claude/agents/qa-agent.md vắng trong bản checkout này)"
fi

printf '\nKết quả: %d đạt, %d hỏng.\n' "$PASS" "$FAIL"
(( FAIL == 0 ))
