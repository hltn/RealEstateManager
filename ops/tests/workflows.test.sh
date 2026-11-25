#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# ops/tests/workflows.test.sh — kiểm tĩnh .github/workflows (v1.0.7, FR-24/FR-25).
# Repo PUBLIC + self-hosted runner trên máy staging: các quy tắc an toàn nằm ở đây để máy canh, không chỉ ở tài liệu.
#   [1] không `pull_request_target` ở bất cứ workflow nào
#   [2] `self-hosted` chỉ xuất hiện trong cd.yml; mỗi workflow khác chạy trên runner GitHub
#   [3] ci.yml chỉ trigger `pull_request` (không push, không workflow_dispatch) và KHÔNG có `paths:`
#   [4] mọi workflow khai `permissions:` cấp cao nhất
#   [5] mọi action bên ngoài (uses: owner/repo@...) ghim theo SHA 40 ký tự
#   [6] cd.yml: job self-hosted có điều kiện `github.ref == 'refs/heads/main'`; không trigger pull_request
#   [7] không workflow nào gọi `npm run lint` của Backend theo kiểu `--fix` (tự sửa file)
#   [8] đối chứng đột biến: mỗi kiểm tra phải BẮT được mẫu xấu
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WF_DIR="$ROOT_DIR/.github/workflows"
PASS=0
FAIL=0
ok()   { PASS=$((PASS + 1)); }
fail() { FAIL=$((FAIL + 1)); printf 'FAIL: %s\n' "$*" >&2; }

# Nội dung file không có chú thích (tránh khớp nhầm chữ trong comment như "CẤM pull_request_target").
code() { sed 's/#.*//' "$1"; }

# Các hàm kiểm: trả 0 khi file VI PHẠM.
has_prt()          { code "$1" | grep -qE 'pull_request_target'; }
has_self_hosted()  { code "$1" | grep -qE 'self-hosted'; }
has_paths_filter() { code "$1" | grep -qE '^[[:space:]]+paths(-ignore)?:'; }
lacks_permissions() { ! code "$1" | grep -qE '^permissions:'; }
has_unpinned_use() { code "$1" | grep -E '^[[:space:]]*-?[[:space:]]*uses:[[:space:]]*[^./[:space:]]' | grep -vqE '@[0-9a-f]{40}([[:space:]]|$)' && return 0 || return 1; }
has_fix_flag()     { code "$1" | grep -qE '(^|[[:space:]])--fix([[:space:]]|$)'; }

mapfile -t FILES < <(find "$WF_DIR" -maxdepth 1 -type f \( -name '*.yml' -o -name '*.yaml' \) | sort)
[[ "${#FILES[@]}" -gt 0 ]] && ok || fail "không thấy workflow nào trong .github/workflows"

echo "== 1) không pull_request_target =="
for f in "${FILES[@]}"; do has_prt "$f" && fail "[1] $(basename "$f") dùng pull_request_target" || ok; done

echo "== 2) self-hosted chỉ ở cd.yml =="
for f in "${FILES[@]}"; do
  b="$(basename "$f")"
  if has_self_hosted "$f" && [[ "$b" != "cd.yml" ]]; then fail "[2] $b dùng self-hosted (chỉ cd.yml được phép)"; else ok; fi
done

echo "== 3) ci.yml chỉ trigger pull_request, không paths: =="
CI="$WF_DIR/ci.yml"
if [[ -f "$CI" ]]; then
  code "$CI" | grep -qE '^[[:space:]]+pull_request:' && ok || fail "[3] ci.yml thiếu trigger pull_request"
  code "$CI" | grep -qE '^[[:space:]]+(push|workflow_dispatch|schedule):' && fail "[3] ci.yml có trigger ngoài pull_request" || ok
  has_paths_filter "$CI" && fail "[3] ci.yml có paths: (check sẽ vắng trên PR ngoài phạm vi, kẹt required check)" || ok
else
  fail "[3] thiếu ci.yml"
fi

echo "== 4) permissions cấp cao nhất =="
for f in "${FILES[@]}"; do lacks_permissions "$f" && fail "[4] $(basename "$f") thiếu permissions: cấp cao nhất" || ok; done

echo "== 5) action ngoài ghim SHA =="
for f in "${FILES[@]}"; do has_unpinned_use "$f" && fail "[5] $(basename "$f") có action chưa ghim SHA 40 ký tự" || ok; done

echo "== 6) cd.yml: self-hosted chỉ khi ref là main, không chạy từ PR =="
CD="$WF_DIR/cd.yml"
if [[ -f "$CD" ]]; then
  code "$CD" | grep -qE '^[[:space:]]+pull_request' && fail "[6] cd.yml có trigger pull_request" || ok
  if has_self_hosted "$CD"; then
    # Mỗi `runs-on` self-hosted phải có `if: github.ref == 'refs/heads/main'` trong cùng job (job bắt đầu ở thụt lề 2 ký tự).
    awk '
      /^  [A-Za-z0-9_-]+:[[:space:]]*$/ { if (job != "" && sh && !guard) bad = bad " " job; job = $1; sh = 0; guard = 0 }
      /self-hosted/ { sh = 1 }
      /github\.ref == .refs\/heads\/main./ { guard = 1 }
      END { if (job != "" && sh && !guard) bad = bad " " job; if (bad != "") { print bad; exit 1 } }
    ' <(code "$CD") >/dev/null && ok || fail "[6] job self-hosted trong cd.yml thiếu điều kiện github.ref == 'refs/heads/main'"
  else
    ok
  fi
else
  ok
fi

echo "== 7) không --fix =="
for f in "${FILES[@]}"; do has_fix_flag "$f" && fail "[7] $(basename "$f") có --fix (tự sửa file)" || ok; done

echo "== 8) đối chứng đột biến: kiểm tra phải bắt được mẫu xấu =="
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
printf 'on:\n  pull_request_target:\n' > "$T/a.yml";                    has_prt "$T/a.yml" && ok || fail "[8] has_prt không bắt được"
printf 'jobs:\n  x:\n    runs-on: [self-hosted]\n' > "$T/b.yml";       has_self_hosted "$T/b.yml" && ok || fail "[8] has_self_hosted không bắt được"
printf 'on:\n  pull_request:\n    paths:\n      - a\n' > "$T/c.yml"; has_paths_filter "$T/c.yml" && ok || fail "[8] has_paths_filter không bắt được"
printf 'name: x\njobs: {}\n' > "$T/d.yml";                              lacks_permissions "$T/d.yml" && ok || fail "[8] lacks_permissions không bắt được"
printf '      - uses: actions/checkout@v4\n' > "$T/e.yml";             has_unpinned_use "$T/e.yml" && ok || fail "[8] has_unpinned_use không bắt được tag"
printf '      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7\n' > "$T/f.yml"; has_unpinned_use "$T/f.yml" && fail "[8] has_unpinned_use báo nhầm action đã ghim" || ok
printf '      - uses: ./.github/workflows/_tests.yml\n' > "$T/g.yml";   has_unpinned_use "$T/g.yml" && fail "[8] has_unpinned_use báo nhầm action cục bộ" || ok
printf '  run: npm run lint -- --fix\n' > "$T/h.yml";                   has_fix_flag "$T/h.yml" && ok || fail "[8] has_fix_flag không bắt được"
printf '# CẤM pull_request_target\n' > "$T/i.yml";                      has_prt "$T/i.yml" && fail "[8] has_prt khớp nhầm chú thích" || ok

printf '\nKết quả: %d đạt, %d hỏng.\n' "$PASS" "$FAIL"
[[ "$FAIL" -eq 0 ]]
