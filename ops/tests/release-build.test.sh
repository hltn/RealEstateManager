#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# ops/tests/release-build.test.sh — test shell KHÔNG cần Docker/ssh thật cho `release.sh build` và bước 0 của `send` (v1.0.6, T-30, FR-14).
#
# Mỗi ca dựng một repo git TẠM (kèm remote bare) chứa bản sao release.sh + ops/lib thật, các file whitelist giả và vài file "bẫy"
# (.env, backups/, logs/, docs/, RealEstateApp/ ...). `docker` và `ssh`/`scp` là bản giả đặt đầu PATH: docker ghi lại mọi lệnh và giữ
# "image" trong một thư mục trạng thái (ID suy ra từ tên + build-arg), ssh/scp chỉ ghi nhật ký để chứng minh `send` bị từ chối/--dry-run không chạm mạng.
#
# Phủ: build đạt (lệnh docker, release.env đúng khóa/giá trị, tag current), gói whitelist (danh sách file CHÍNH XÁC, quyền 755/644,
# không lọt .env/backups/logs/docs/RealEstateApp, chặn file bí mật đang được theo dõi), .sha256 (khớp và phát hiện gói bị sửa),
# cây bẩn/chưa push/không upstream bị từ chối (CI chỉ bỏ qua kiểm "chưa push"), version BE/FE lệch, --local (tag, cờ, `send` từ chối),
# lỗi build giữa chừng không để lại gói cũ, --no-current, docker không chạy, tính tái lập, kiểm tĩnh Dockerfile/.dockerignore/.gitignore thật.
#
# Chạy:  bash ops/tests/release-build.test.sh      (thoát 0 nếu mọi ca đạt, 1 nếu có ca hỏng)
# ─────────────────────────────────────────────────────────────────────────────
# shellcheck disable=SC2016  # nháy đơn có chủ ý
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
expect_contains() { if [[ "$3" == *"$2"* ]]; then ok; else fail "$1: không thấy [$2] trong [${3:0:700}]"; fi; }
expect_not_contains() { if [[ "$3" != *"$2"* ]]; then ok; else fail "$1: KHÔNG được chứa [$2] (đầu ra: ${3:0:700})"; fi; }
expect_rc() { if [[ "$2" == "$3" ]]; then ok; else fail "$1: mã thoát mong đợi $2, nhận $3"; fi; }
expect_nonzero() { if [[ "$2" != "0" ]]; then ok; else fail "$1: mong đợi mã thoát khác 0"; fi; }
expect_file() { if [[ -e "$2" ]]; then ok; else fail "$1: thiếu $2"; fi; }
expect_no_file() { if [[ ! -e "$2" ]]; then ok; else fail "$1: $2 không được tồn tại"; fi; }

export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t.test GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t.test
export GIT_CONFIG_GLOBAL="$TMP/gitconfig-global" GIT_CONFIG_NOSYSTEM=1
printf '[core]\n\tautocrlf = false\n[commit]\n\tgpgsign = false\n[init]\n\tdefaultBranch = main\n' > "$GIT_CONFIG_GLOBAL"

# ── docker / ssh / scp giả ───────────────────────────────────────────────────
STUB="$TMP/stub"; mkdir -p "$STUB"
cat > "$STUB/docker" <<'EOS'
#!/usr/bin/env bash
# docker giả: ghi lệnh vào $STUB_STATE/docker.log; "image" = file $STUB_STATE/img/<tên:tag> chứa ID.
S="${STUB_STATE:?}"; mkdir -p "$S/img"
echo "$*" >> "$S/docker.log"
case "${1:-}" in
  info) [[ -z "${STUB_DOCKER_DOWN:-}" ]]; exit $? ;;
  build)
    shift; ref=""; commit=""; target=""
    while (( $# > 0 )); do
      case "$1" in
        -t) ref="$2"; shift 2 ;;
        --build-arg) commit="${2#GIT_COMMIT=}"; shift 2 ;;
        --target) target="$2"; shift 2 ;;
        -f) shift 2 ;;
        *) shift ;;
      esac
    done
    if [[ -n "${STUB_BUILD_FAIL_ON:-}" && "$ref" == *"${STUB_BUILD_FAIL_ON}"* ]]; then echo "build lỗi giả" >&2; exit 1; fi
    printf 'sha256:%s\n' "$(printf '%s|%s|%s' "$ref" "$commit" "$target" | sha256sum | cut -d' ' -f1)" > "$S/img/${ref//[\/:]/_}"
    ;;
  tag) cp "$S/img/${2//[\/:]/_}" "$S/img/${3//[\/:]/_}" ;;
  image)
    [[ "${2:-}" == "inspect" ]] || exit 1
    ref="${*: -1}"; f="$S/img/${ref//[\/:]/_}"; [[ -f "$f" ]] || exit 1; cat "$f" ;;
  *) exit 0 ;;
esac
EOS
for t in ssh scp; do
  cat > "$STUB/$t" <<'EOS'
#!/usr/bin/env bash
echo "$(basename "$0") $*" >> "${STUB_STATE:?}/net.log"
exit 0
EOS
done
# sha256sum giả: STUB_SHA_FAIL=1 làm hỏng RIÊNG lần băm release.tgz; còn lại chuyển cho sha256sum thật.
REAL_SHA="$(command -v sha256sum)"
cat > "$STUB/sha256sum" <<EOS
#!/usr/bin/env bash
if [[ -n "\${STUB_SHA_FAIL:-}" && "\$*" == *release.tgz* ]]; then echo "sha256sum lỗi giả" >&2; exit 1; fi
exec "$REAL_SHA" "\$@"
EOS
chmod +x "$STUB/docker" "$STUB/ssh" "$STUB/scp" "$STUB/sha256sum"

# ── Dựng repo tạm ────────────────────────────────────────────────────────────
# RELEASE_SH: chạy bộ test trên một bản release.sh khác (mutation test).
RELEASE_SH_SRC="${RELEASE_SH:-$ROOT_DIR/release.sh}"
SECRET="zq7TopSecretValue"
# make_repo <tên>: tạo $TMP/<tên>/repo (đã push lên remote bare), in đường dẫn repo qua biến REPO; trạng thái stub ở $TMP/<tên>/state.
# make_repo <tên>: nhân bản repo MẪU (dựng một lần, rẻ hơn init+commit+push mỗi ca) rồi trỏ remote về bản bare riêng của ca đó.
make_repo() {
  local n="$1"
  [[ -d "$TMP/tpl/repo" ]] || build_template_repo tpl
  mkdir -p "$TMP/$n"
  cp -a "$TMP/tpl/repo" "$TMP/$n/repo"; cp -a "$TMP/tpl/remote.git" "$TMP/$n/remote.git"; mkdir -p "$TMP/$n/state"
  git -C "$TMP/$n/repo" remote set-url origin "$TMP/$n/remote.git"
  REPO="$TMP/$n/repo"; STATE="$TMP/$n/state"
}
build_template_repo() {
  local n="$1" r="$TMP/$1/repo"
  mkdir -p "$r" "$TMP/$n/remote.git"
  git init -q --bare "$TMP/$n/remote.git"
  (
    cd "$r" || exit 1
    git init -q
    mkdir -p ops/lib ops/tests scripts RealEstateBackendApp RealEstateAdminApp docs RealEstateApp
    cp "$RELEASE_SH_SRC" release.sh
    cp "$ROOT_DIR/ops/lib/ops-common.sh" ops/lib/ops-common.sh
    echo '#!/usr/bin/env bash' > deploy.sh; echo '#!/usr/bin/env bash' > backup.sh; echo '#!/usr/bin/env bash' > restore.sh
    echo '#!/usr/bin/env bash' > ops/check-disk.sh; echo '#!/usr/bin/env bash' > scripts/run-migration.sh
    echo '#!/usr/bin/env bash' > ops/tests/x.test.sh
    echo 'name: realestatemanager' > docker-compose.yml
    printf '{\n  "name": "be",\n  "version": "1.2.3"\n}\n' > RealEstateBackendApp/package.json
    printf '{\n  "name": "fe",\n  "version": "1.2.3"\n}\n' > RealEstateAdminApp/package.json
    echo 'FROM scratch' > RealEstateBackendApp/Dockerfile; echo 'FROM scratch' > RealEstateAdminApp/Dockerfile
    echo 'tài liệu' > docs/readme.md; echo '{}' > RealEstateApp/app.json; echo '# changelog' > CHANGELOG.md
    printf '.env\n.env.*\n!.env.example\nbackups/\nlogs/\n*.dump\n/release.env\n/release.tgz\n/release.tgz.sha256\n' > .gitignore
    # chmod thật trên đĩa (không chỉ trong index): trên Linux (CI) file 644 mà index 755 bị coi là cây bẩn.
    chmod +x release.sh deploy.sh backup.sh restore.sh ops/check-disk.sh scripts/run-migration.sh
    git add -A
    git update-index --chmod=+x release.sh deploy.sh backup.sh restore.sh ops/check-disk.sh scripts/run-migration.sh
    git commit -q -m init
    git remote add origin "$TMP/$n/remote.git"
    git push -q -u origin main 2>/dev/null
    # file "bẫy": bị ignore nên không dính git, và KHÔNG được lọt vào gói
    echo "DB_PASSWORD=$SECRET" > .env; echo "X=$SECRET" > ops/.env
    mkdir -p backups logs; echo "$SECRET" > backups/dump.archive; echo "$SECRET" > logs/app.log; echo "$SECRET" > scripts/data.dump
  )
}

# run_release <repo> <state> [env KEY=VAL ...] -- <args...>: chạy release.sh trong repo tạm; kết quả ở OUT (stdout+stderr) và RC.
OUT=""; RC=0
run_release() {
  local repo="$1" state="$2"; shift 2
  local -a envs=()
  while (( $# > 0 )) && [[ "$1" != "--" ]]; do envs+=("$1"); shift; done
  [[ "${1:-}" == "--" ]] && shift
  OUT="$(cd "$repo" && env -u CI -u GITHUB_ACTIONS "${envs[@]}" PATH="$STUB:$PATH" STUB_STATE="$state" bash release.sh "$@" 2>&1)"; RC=$?
}
build_count() { if [[ -f "$1/docker.log" ]]; then grep -c '^build ' "$1/docker.log" || true; else echo 0; fi; }
dkr_log() { cat "$1/docker.log" 2>/dev/null || true; }
img_id() { cat "$1/img/${2//[\/:]/_}" 2>/dev/null || true; }
env_val() { sed -n "s/^$2=//p" "$1" | head -n 1; }
cr_count() { tr -cd '\r' < "$1" | wc -c | tr -d ' '; }
commit7() { local h; h="$(cd "$1" && git rev-parse HEAD)"; printf '%s' "${h:0:7}"; }

CURRENT_REFS="realestatemanager-backend:current realestatemanager-frontend:current"

# ── 1) Build đạt trên cây sạch đã push ───────────────────────────────────────
echo "== 1) build đạt: lệnh docker, release.env, tag current =="
make_repo c1; R="$REPO"; S="$STATE"; C7="$(commit7 "$R")"
run_release "$R" "$S" -- build
expect_rc "[1] rc" 0 "$RC"
LOG="$(dkr_log "$S")"
expect_eq "[1] đúng 2 lần docker build" 2 "$(build_count "$S")"
expect_contains "[1] BE: tag bất biến" "-t realestatemanager-backend:1.2.3-$C7" "$LOG"
expect_contains "[1] FE: tag bất biến" "-t realestatemanager-frontend:1.2.3-$C7" "$LOG"
expect_eq "[1] --build-arg GIT_COMMIT truyền cho cả 2 image" 2 "$(grep -c -- "--build-arg GIT_COMMIT=$C7 " <<<"$LOG")"
expect_eq "[1] --target production cho cả 2 image" 2 "$(grep -c -- '--target production' <<<"$LOG")"
expect_contains "[1] BE dùng Dockerfile + context của backend" "-f RealEstateBackendApp/Dockerfile RealEstateBackendApp" "$LOG"
expect_contains "[1] FE dùng Dockerfile + context của frontend" "-f RealEstateAdminApp/Dockerfile RealEstateAdminApp" "$LOG"
expect_not_contains "[1] không login/push registry" "login" "$LOG"
expect_not_contains "[1] không push registry" "push" "$LOG"
# release.env: đúng tập khóa, đúng giá trị
RE="$R/release.env"
expect_file "[1] release.env" "$RE"
KEYS="$(grep -vE '^(#|$)' "$RE" | cut -d= -f1 | sort | paste -sd ' ' -)"
expect_eq "[1] release.env đúng tập khóa" "BACKEND_IMAGE_ID BACKEND_IMAGE_NAME BACKEND_IMAGE_TAG FRONTEND_IMAGE_ID FRONTEND_IMAGE_NAME FRONTEND_IMAGE_TAG GIT_COMMIT RELEASE_LOCAL RELEASE_VERSION" "$KEYS"
expect_eq "[1] RELEASE_VERSION" "1.2.3" "$(env_val "$RE" RELEASE_VERSION)"
expect_eq "[1] RELEASE_LOCAL" "0" "$(env_val "$RE" RELEASE_LOCAL)"
expect_eq "[1] GIT_COMMIT = 7 ký tự đầu của HEAD" "$C7" "$(env_val "$RE" GIT_COMMIT)"
expect_eq "[1] GIT_COMMIT dài đúng 7 ký tự" "7" "${#C7}"
expect_eq "[1] GIT_COMMIT là tiền tố của hash đầy đủ" "$(git -C "$R" rev-parse HEAD | cut -c1-7)" "$(env_val "$RE" GIT_COMMIT)"
expect_eq "[1] tên image BE" "realestatemanager-backend" "$(env_val "$RE" BACKEND_IMAGE_NAME)"
expect_eq "[1] tên image FE" "realestatemanager-frontend" "$(env_val "$RE" FRONTEND_IMAGE_NAME)"
expect_eq "[1] tag BE" "1.2.3-$C7" "$(env_val "$RE" BACKEND_IMAGE_TAG)"
expect_eq "[1] tag FE" "1.2.3-$C7" "$(env_val "$RE" FRONTEND_IMAGE_TAG)"
BE_ID="$(env_val "$RE" BACKEND_IMAGE_ID)"; FE_ID="$(env_val "$RE" FRONTEND_IMAGE_ID)"
expect_eq "[1] BACKEND_IMAGE_ID = ID thật của image vừa build" "$(img_id "$S" "realestatemanager-backend:1.2.3-$C7")" "$BE_ID"
expect_eq "[1] FRONTEND_IMAGE_ID = ID thật của image vừa build" "$(img_id "$S" "realestatemanager-frontend:1.2.3-$C7")" "$FE_ID"
[[ "$BE_ID" =~ ^sha256:[0-9a-f]{64}$ && "$FE_ID" =~ ^sha256:[0-9a-f]{64}$ && "$BE_ID" != "$FE_ID" ]] && ok || fail "[1] image ID không đúng dạng sha256 hoặc BE trùng FE"
expect_not_contains "[1] release.env không chứa bí mật" "$SECRET" "$(cat "$RE")"
# tag current cục bộ trỏ đúng image vừa build
expect_eq "[1] BE :current = image vừa build" "$BE_ID" "$(img_id "$S" realestatemanager-backend:current)"
expect_eq "[1] FE :current = image vừa build" "$FE_ID" "$(img_id "$S" realestatemanager-frontend:current)"

# ── 2) Gói release: whitelist CHÍNH XÁC ──────────────────────────────────────
echo "== 2) release.tgz: đúng whitelist, quyền, không lọt bí mật =="
TGZ="$R/release.tgz"
expect_file "[2] release.tgz" "$TGZ"
GOT="$(tar -tzf "$TGZ" | LC_ALL=C sort | paste -sd ' ' -)"
WANT="backup.sh deploy.sh docker-compose.yml ops/check-disk.sh ops/lib/ops-common.sh ops/tests/x.test.sh release.env restore.sh scripts/run-migration.sh"
expect_eq "[2] danh sách file trong gói" "$WANT" "$GOT"
LIST="$(tar -tzf "$TGZ")"
for bad in ".env" "ops/.env" "backups" "logs" "dump" "docs/" "RealEstateApp" "RealEstateBackendApp" "RealEstateAdminApp" "CHANGELOG" ".git" "release.sh" "release.tgz"; do
  # `.env` chỉ được xuất hiện trong tên release.env
  if [[ "$bad" == ".env" ]]; then
    expect_eq "[2] không có file .env nào ngoài release.env" "" "$(grep -E '(^|/)\.env' <<<"$LIST")"
  else
    expect_not_contains "[2] gói không chứa $bad" "$bad" "$LIST"
  fi
done
XD="$TMP/c1/x"; mkdir -p "$XD"; tar -xzf "$TGZ" -C "$XD"
expect_eq "[2] không chuỗi bí mật nào trong ruột gói" "0" "$(grep -rl "$SECRET" "$XD" 2>/dev/null | wc -l | tr -d ' ')"
expect_eq "[2] release.env trong gói = release.env trên đĩa" "$(cat "$RE")" "$(cat "$XD/release.env")"
VERB="$(tar -tvzf "$TGZ")"
for f in deploy.sh backup.sh restore.sh ops/check-disk.sh scripts/run-migration.sh; do
  expect_eq "[2] $f quyền 755, chủ 0/0" "1" "$(grep -cE "^-rwxr-xr-x 0/0 .* $f\$" <<<"$VERB")"
done
for f in docker-compose.yml release.env ops/lib/ops-common.sh; do
  expect_eq "[2] $f quyền 644, chủ 0/0" "1" "$(grep -cE "^-rw-r--r-- 0/0 .* $f\$" <<<"$VERB")"
done

# ── 3) .sha256 ───────────────────────────────────────────────────────────────
echo "== 3) release.tgz.sha256 =="
SHA="$R/release.tgz.sha256"
expect_file "[3] .sha256" "$SHA"
expect_eq "[3] nội dung = sha256 thật của gói + tên file" "$(sha256sum "$TGZ" | cut -d' ' -f1)  release.tgz" "$(tr -d '\r' < "$SHA" | sed -E 's/^([0-9a-f]{64}) [ *]/\1  /')"
(cd "$R" && sha256sum -c release.tgz.sha256 >/dev/null 2>&1); expect_rc "[3] sha256sum -c đạt" 0 "$?"
cp "$TGZ" "$TMP/c1/tgz.bak"; printf 'x' >> "$TGZ"
(cd "$R" && sha256sum -c release.tgz.sha256 >/dev/null 2>&1); expect_nonzero "[3] gói bị sửa thì sha256sum -c báo lỗi" "$?"
cp "$TMP/c1/tgz.bak" "$TGZ"

# ── 4) Tái lập ───────────────────────────────────────────────────────────────
echo "== 4) build lại cùng commit cho gói trùng byte =="
H1="$(sha256sum "$TGZ" | cut -d' ' -f1)"
run_release "$R" "$S" -- build
expect_rc "[4] build lần 2 đạt" 0 "$RC"
expect_eq "[4] sha256 gói giống lần trước" "$H1" "$(sha256sum "$TGZ" | cut -d' ' -f1)"

# ── 5) Cây bẩn ───────────────────────────────────────────────────────────────
echo "== 5) cây bẩn bị từ chối =="
make_repo c5a; R="$REPO"; S="$STATE"
echo "# sửa" >> "$R/deploy.sh"
run_release "$R" "$S" -- build
expect_nonzero "[5] file đã theo dõi bị sửa" "$RC"
expect_contains "[5] thông báo nêu cây bẩn" "chưa commit" "$OUT"
expect_eq "[5] không build gì" 0 "$(build_count "$S")"
expect_no_file "[5] không sinh release.env" "$R/release.env"
expect_no_file "[5] không sinh release.tgz" "$R/release.tgz"
make_repo c5b; R="$REPO"; S="$STATE"
echo x > "$R/ops/new-file.sh"
run_release "$R" "$S" -- build
expect_nonzero "[5] file mới chưa theo dõi (không ignore)" "$RC"
expect_eq "[5] không build gì (untracked)" 0 "$(build_count "$S")"
make_repo c5c; R="$REPO"; S="$STATE"   # .env/backups/logs bị ignore KHÔNG làm cây bẩn (đã có trong make_repo) nên build phải đạt
run_release "$R" "$S" -- build
expect_rc "[5] file bị ignore (.env, backups/) không làm cây bẩn" 0 "$RC"
make_repo c5d; R="$REPO"; S="$STATE"
echo "# sửa" >> "$R/deploy.sh"
run_release "$R" "$S" CI=true -- build
expect_nonzero "[5] trong CI cây bẩn vẫn bị từ chối" "$RC"
expect_eq "[5] CI + bẩn: không build" 0 "$(build_count "$S")"

# ── 6) Chưa push / không upstream / CI ───────────────────────────────────────
echo "== 6) chưa push, không upstream, CI =="
make_repo c6a; R="$REPO"; S="$STATE"
(cd "$R" && echo "# thêm" >> deploy.sh && git commit -q -am "local only")
run_release "$R" "$S" -- build
expect_nonzero "[6] có commit chưa push" "$RC"
expect_contains "[6] thông báo nêu chưa push" "chưa push" "$OUT"
expect_eq "[6] không build gì" 0 "$(build_count "$S")"
make_repo c6b; R="$REPO"; S="$STATE"
(cd "$R" && git checkout -q -b feature-x)
run_release "$R" "$S" -- build
expect_nonzero "[6] nhánh không có upstream" "$RC"
expect_contains "[6] thông báo nêu upstream" "upstream" "$OUT"
make_repo c6c; R="$REPO"; S="$STATE"
(cd "$R" && echo "# thêm" >> deploy.sh && git commit -q -am "local only"); C7="$(commit7 "$R")"
run_release "$R" "$S" CI=true -- build
expect_rc "[6] CI bỏ qua kiểm chưa push" 0 "$RC"
expect_eq "[6] CI: vẫn có tag bất biến" "1" "$([[ -n "$(img_id "$S" "realestatemanager-backend:1.2.3-$C7")" ]] && echo 1 || echo 0)"
expect_eq "[6] CI: KHÔNG đặt tag current (BE)" "" "$(img_id "$S" realestatemanager-backend:current)"
expect_eq "[6] CI: KHÔNG đặt tag current (FE)" "" "$(img_id "$S" realestatemanager-frontend:current)"
expect_not_contains "[6] CI: không có lệnh docker tag" "tag " "$(dkr_log "$S")"
expect_contains "[6] CI: log giải thích" "CI" "$OUT"
make_repo c6d; R="$REPO"; S="$STATE"
(cd "$R" && git checkout -q -b feature-y)
run_release "$R" "$S" GITHUB_ACTIONS=true -- build
expect_rc "[6] GITHUB_ACTIONS=true cũng là CI (không upstream vẫn đạt)" 0 "$RC"
make_repo c6e; R="$REPO"; S="$STATE"
(cd "$R" && git checkout -q -b feature-z)
run_release "$R" "$S" CI=false -- build
expect_nonzero "[6] CI=false không phải CI" "$RC"

# ── 7) Version BE/FE ─────────────────────────────────────────────────────────
echo "== 7) version BE/FE =="
make_repo c7a; R="$REPO"; S="$STATE"
sed -i 's/1.2.3/1.2.4/' "$R/RealEstateAdminApp/package.json"; (cd "$R" && git commit -q -am fe-bump && git push -q)
run_release "$R" "$S" -- build
expect_nonzero "[7] version lệch" "$RC"
expect_contains "[7] nêu version BE" "1.2.3" "$OUT"
expect_contains "[7] nêu version FE" "1.2.4" "$OUT"
expect_eq "[7] không build gì" 0 "$(build_count "$S")"
run_release "$R" "$S" -- build --local
expect_nonzero "[7] --local cũng không bỏ qua kiểm version" "$RC"
expect_eq "[7] --local lệch: không build" 0 "$(build_count "$S")"
make_repo c7b; R="$REPO"; S="$STATE"
sed -i 's/"1.2.3"/"v1"/' "$R/RealEstateBackendApp/package.json"; sed -i 's/"1.2.3"/"v1"/' "$R/RealEstateAdminApp/package.json"; (cd "$R" && git commit -q -am bad-ver && git push -q)
run_release "$R" "$S" -- build
expect_nonzero "[7] version sai định dạng (BE == FE nhưng không phải semver)" "$RC"
make_repo c7c; R="$REPO"; S="$STATE"
sed -i 's/1.2.3/1.2.3+build5/' "$R/RealEstateBackendApp/package.json"; sed -i 's/1.2.3/1.2.3+build5/' "$R/RealEstateAdminApp/package.json"; (cd "$R" && git commit -q -am plus && git push -q)
run_release "$R" "$S" -- build
expect_nonzero "[7] version có '+' (docker tag không nhận) bị từ chối" "$RC"
make_repo c7d; R="$REPO"; S="$STATE"
sed -i 's/1.2.3/1.2.3-rc.1/' "$R/RealEstateBackendApp/package.json"; sed -i 's/1.2.3/1.2.3-rc.1/' "$R/RealEstateAdminApp/package.json"; (cd "$R" && git commit -q -am rc && git push -q); C7="$(commit7 "$R")"
run_release "$R" "$S" -- build
expect_rc "[7] version tiền phát hành (rc) hợp lệ" 0 "$RC"
expect_eq "[7] tag rc" "1.2.3-rc.1-$C7" "$(env_val "$R/release.env" BACKEND_IMAGE_TAG)"

# ── 8) --local và send ───────────────────────────────────────────────────────
echo "== 8) --local và send =="
make_repo c8; R="$REPO"; S="$STATE"; C7="$(commit7 "$R")"
echo "# bẩn" >> "$R/deploy.sh"
run_release "$R" "$S" -- build --local
expect_rc "[8] --local cho phép cây bẩn" 0 "$RC"
RE="$R/release.env"
expect_eq "[8] tag -local (BE)" "1.2.3-local" "$(env_val "$RE" BACKEND_IMAGE_TAG)"
expect_eq "[8] tag -local (FE)" "1.2.3-local" "$(env_val "$RE" FRONTEND_IMAGE_TAG)"
expect_eq "[8] RELEASE_LOCAL=1" "1" "$(env_val "$RE" RELEASE_LOCAL)"
expect_eq "[8] GIT_COMMIT ghi -dirty khi cây bẩn" "${C7}-dirty" "$(env_val "$RE" GIT_COMMIT)"
expect_contains "[8] build-arg có -dirty" "GIT_COMMIT=${C7}-dirty" "$(dkr_log "$S")"
expect_eq "[8] --local vẫn đặt current" "$(env_val "$RE" BACKEND_IMAGE_ID)" "$(img_id "$S" realestatemanager-backend:current)"
expect_eq "[8] gói --local lấy nội dung working tree (file bẩn)" "1" "$(tar -xzOf "$R/release.tgz" deploy.sh | grep -c '# bẩn')"
run_release "$R" "$S" -- send --to some-vps
expect_nonzero "[8] send bản --local bị từ chối" "$RC"
expect_contains "[8] thông báo từ chối --local" "TỪ CHỐI" "$OUT"
expect_not_contains "[8] từ chối vì -local chứ không phải vì chưa hỗ trợ" "chưa được hỗ trợ" "$OUT"
expect_no_file "[8] send không chạm ssh/scp" "$S/net.log"
# Chỉ còn tag -local mà thiếu cờ RELEASE_LOCAL vẫn bị từ chối
sed -i '/^RELEASE_LOCAL=/d' "$RE"
run_release "$R" "$S" -- send --to some-vps
expect_contains "[8] thiếu cờ RELEASE_LOCAL nhưng tag -local vẫn bị từ chối" "TỪ CHỐI" "$OUT"
expect_no_file "[8] vẫn không chạm ssh/scp" "$S/net.log"
# Bản thường: send --dry-run qua bước 0 (gói/ảnh khớp) và chỉ in kế hoạch, không chạm mạng (luồng đầy đủ: release-send.test.sh)
make_repo c8b; R="$REPO"; S="$STATE"
run_release "$R" "$S" -- build
run_release "$R" "$S" -- send --to some-vps --dry-run
expect_rc "[8] send --dry-run bản thường đạt" 0 "$RC"
expect_contains "[8] dry-run in kế hoạch" "dry-run" "$OUT"
expect_not_contains "[8] không còn khung 'chưa hỗ trợ'" "chưa được hỗ trợ" "$OUT"
expect_no_file "[8] dry-run không chạm ssh/scp" "$S/net.log"
run_release "$R" "$S" -- send
expect_nonzero "[8] send thiếu --to" "$RC"
make_repo c8c; R="$REPO"; S="$STATE"
run_release "$R" "$S" -- send --to some-vps
expect_nonzero "[8] send khi chưa build (không có release.env)" "$RC"
expect_contains "[8] nhắc chạy build" "build" "$OUT"

# ── 9) Lỗi giữa chừng ────────────────────────────────────────────────────────
echo "== 9) lỗi build giữa chừng không để lại gói cũ =="
make_repo c9; R="$REPO"; S="$STATE"
echo "gói cũ" > "$R/release.tgz"; echo "x" > "$R/release.tgz.sha256"; echo "RELEASE_VERSION=0.0.1" > "$R/release.env"
run_release "$R" "$S" STUB_BUILD_FAIL_ON=frontend -- build
expect_nonzero "[9] build FE lỗi thì thoát khác 0" "$RC"
expect_no_file "[9] không còn release.env cũ" "$R/release.env"
expect_no_file "[9] không còn release.tgz cũ" "$R/release.tgz"
expect_no_file "[9] không còn .sha256 cũ" "$R/release.tgz.sha256"
expect_eq "[9] không đặt current (BE)" "" "$(img_id "$S" realestatemanager-backend:current)"
make_repo c9b; R="$REPO"; S="$STATE"
run_release "$R" "$S" STUB_DOCKER_DOWN=1 -- build
expect_nonzero "[9] docker không chạy" "$RC"
expect_eq "[9] docker không chạy: không build" 0 "$(build_count "$S")"
make_repo c9c; R="$REPO"; S="$STATE"
git -C "$R" rm -q --cached ops/check-disk.sh && rm -f "$R/ops/check-disk.sh"; git -C "$R" commit -q -m rm-disk; git -C "$R" push -q
git -C "$R" ls-files --error-unmatch ops/lib/ops-common.sh >/dev/null 2>&1   # ops/ vẫn còn file khác
run_release "$R" "$S" -- build
expect_rc "[9] bớt một file trong ops/ vẫn đóng gói bình thường" 0 "$RC"
expect_eq "[9] gói không còn file đã xóa" "0" "$(tar -tzf "$R/release.tgz" | grep -c 'ops/check-disk.sh')"
make_repo c9d; R="$REPO"; S="$STATE"
git -C "$R" rm -q backup.sh; git -C "$R" commit -q -m rm-backup; git -C "$R" push -q
run_release "$R" "$S" -- build
expect_nonzero "[9] thiếu hẳn một mục whitelist (backup.sh) thì dừng" "$RC"
expect_contains "[9] nêu mục thiếu" "backup.sh" "$OUT"
expect_no_file "[9] không để lại gói thiếu mục" "$R/release.tgz"

echo "== 9b) lỗi ở bước sha256 không để lại release.env mồ côi =="
make_repo c9e; R="$REPO"; S="$STATE"
run_release "$R" "$S" STUB_SHA_FAIL=1 -- build
expect_nonzero "[9b] sha256 lỗi thì thoát khác 0" "$RC"
expect_no_file "[9b] không sót release.env mồ côi" "$R/release.env"
expect_no_file "[9b] không sót release.tgz" "$R/release.tgz"
expect_no_file "[9b] không sót .sha256" "$R/release.tgz.sha256"
expect_eq "[9b] không đặt current (BE)" "" "$(img_id "$S" realestatemanager-backend:current)"
expect_eq "[9b] không đặt current (FE)" "" "$(img_id "$S" realestatemanager-frontend:current)"
run_release "$R" "$S" -- build
expect_rc "[9b] chạy lại không lỗi sha256 thì đạt" 0 "$RC"

# ── 10) File bí mật đang được git theo dõi bị chặn ──────────────────────────
echo "== 10) file bí mật đã bị theo dõi trong whitelist bị chặn =="
for leak in "ops/.env.prod" "scripts/backups/x.txt" "ops/logs/a.txt" "scripts/key.pem" "ops/db.archive"; do
  make_repo c10; R="$REPO"; S="$STATE"
  mkdir -p "$(dirname "$R/$leak")"; echo "$SECRET" > "$R/$leak"
  git -C "$R" add -f "$leak"; git -C "$R" commit -q -m leak; git -C "$R" push -q
  run_release "$R" "$S" -- build
  expect_nonzero "[10] $leak bị chặn" "$RC"
  expect_no_file "[10] $leak: không sinh release.tgz" "$R/release.tgz"
  rm -rf "$TMP/c10"
done
make_repo c10x; R="$REPO"; S="$STATE"
echo "A=1" > "$R/ops/.env.example"; git -C "$R" add -f ops/.env.example; git -C "$R" commit -q -m ex; git -C "$R" push -q
run_release "$R" "$S" -- build
expect_rc "[10] .env.example (mẫu, không bí mật) được phép" 0 "$RC"

# ── 11) --no-current, current cũ ─────────────────────────────────────────────
echo "== 11) --no-current và current đang trỏ image khác =="
make_repo c11; R="$REPO"; S="$STATE"
mkdir -p "$S/img"; OLD="sha256:$(printf 'cu' | sha256sum | cut -d' ' -f1)"
echo "$OLD" > "$S/img/realestatemanager-backend_current"; echo "$OLD" > "$S/img/realestatemanager-frontend_current"
run_release "$R" "$S" -- build --no-current
expect_rc "[11] --no-current đạt" 0 "$RC"
expect_eq "[11] --no-current giữ nguyên current cũ (BE)" "$OLD" "$(img_id "$S" realestatemanager-backend:current)"
expect_eq "[11] --no-current giữ nguyên current cũ (FE)" "$OLD" "$(img_id "$S" realestatemanager-frontend:current)"
run_release "$R" "$S" -- build
expect_rc "[11] build thường đạt" 0 "$RC"
expect_eq "[11] current chuyển sang bản mới" "$(env_val "$R/release.env" BACKEND_IMAGE_ID)" "$(img_id "$S" realestatemanager-backend:current)"
expect_contains "[11] log báo current đã chuyển từ bản cũ" "chuyển từ" "$OUT"

# ── 12) Dòng lệnh ────────────────────────────────────────────────────────────
echo "== 12) tham số dòng lệnh =="
make_repo c12; R="$REPO"; S="$STATE"
run_release "$R" "$S" --; expect_rc "[12] không tham số: mã 2 (dùng sai)" 2 "$RC"; expect_contains "[12] in cách dùng" "Cách dùng" "$OUT"
run_release "$R" "$S" -- bogus; expect_nonzero "[12] tiểu lệnh lạ" "$RC"
run_release "$R" "$S" -- build --nope; expect_nonzero "[12] cờ lạ cho build" "$RC"
expect_eq "[12] cờ lạ: không build" 0 "$(build_count "$S")"
run_release "$R" "$S" -- --help; expect_rc "[12] --help" 0 "$RC"

# ── 13) Kiểm tĩnh trên repo thật ─────────────────────────────────────────────
echo "== 13) kiểm tĩnh: Dockerfile, .dockerignore, .gitignore, release.sh thật =="
for d in RealEstateBackendApp RealEstateAdminApp; do
  DF="$ROOT_DIR/$d/Dockerfile"
  expect_eq "[13] $d/Dockerfile có ARG GIT_COMMIT ở stage production" "1" \
    "$(sed -n '/^FROM .* AS production/,$p' "$DF" | tr -d '\r' | grep -cE '^ARG GIT_COMMIT(=.*)?$')"
  expect_eq "[13] $d/Dockerfile có LABEL revision = GIT_COMMIT" "1" \
    "$(sed -n '/^FROM .* AS production/,$p' "$DF" | tr -d '\r' | grep -cF 'LABEL org.opencontainers.image.revision="${GIT_COMMIT}"')"
  # EOL của Dockerfile phụ thuộc máy (index LF hay CRLF, autocrlf): chỉ đòi KHÔNG lẫn EOL (không CR nào, hoặc mọi dòng đều có CR).
  CRS="$(cr_count "$DF")"; LNS="$(wc -l < "$DF" | tr -d ' ')"
  if [[ "$CRS" == "0" || "$CRS" == "$LNS" ]]; then ok; else fail "[13] $d/Dockerfile lẫn EOL: $CRS CR / $LNS dòng"; fi
  expect_eq "[13] $d/.dockerignore loại .env" "1" "$(tr -d '\r' < "$ROOT_DIR/$d/.dockerignore" | grep -cx '\.env')"
  expect_eq "[13] $d/.dockerignore loại .env.*" "1" "$(tr -d '\r' < "$ROOT_DIR/$d/.dockerignore" | grep -cxF '.env.*')"
  expect_eq "[13] $d/.dockerignore loại .git" "1" "$(tr -d '\r' < "$ROOT_DIR/$d/.dockerignore" | grep -cx '\.git')"
done
for f in release.env release.tgz release.tgz.sha256; do
  (cd "$ROOT_DIR" && git check-ignore -q "$f"); expect_rc "[13] .gitignore loại $f" 0 "$?"
done
RS="$ROOT_DIR/release.sh"
expect_eq "[13] release.sh dùng LF" "0" "$(cr_count "$RS")"
expect_eq "[13] release.sh có set -euo pipefail" "1" "$(grep -c '^set -euo pipefail$' "$RS")"
expect_eq "[13] release.sh không có docker login/push" "0" "$(grep -vE '^\s*#' "$RS" | grep -cE 'docker (login|push)|docker buildx .*--push')"
expect_eq "[13] release.sh không có lệnh in giá trị .env" "0" "$(grep -vE '^\s*#' "$RS" | grep -cE '(cat|source|\.) +[^ ]*\.env( |$)')"
bash -n "$RS"; expect_rc "[13] release.sh qua bash -n" 0 "$?"
# Whitelist trong script đúng danh sách của Architecture 5.1
expect_eq "[13] WHITELIST trong release.sh" "readonly WHITELIST=(docker-compose.yml deploy.sh backup.sh restore.sh ops scripts)" "$(grep '^readonly WHITELIST=' "$RS")"

printf '\nKết quả: %d đạt, %d hỏng.\n' "$PASS" "$FAIL"
(( FAIL == 0 ))
