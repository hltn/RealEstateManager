#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# scripts/print-image-digests.sh — CHỈ ĐỌC (không pull, không đổi gì): in digest của image mà các container production
# ĐANG CHẠY thật, theo dạng dòng sẵn để dán vào .env.docker (PT-009, tài liệu 06_Production_Deploy.md mục 12).
#
#   bash scripts/print-image-digests.sh
#
# Vì sao lấy từ container đang chạy mà không lấy từ registry: tag trôi (`:latest`, `mongo:7`, `redis:7-alpine`), digest
# trên registry hôm nay có thể KHÁC bản đã pull lúc dựng stack. Ghim digest registry hiện tại nghĩa là đổi phiên bản âm
# thầm. Ở đây lấy RepoDigest của ĐÚNG image ID mà container đang dùng.
#
# Mỗi dòng in ra có dạng  NAME_IMAGE=<repo>@sha256:<digest>  (không bí mật). Dán vào .env.docker (quyền 600), rồi
# `docker compose --env-file .env.docker config | grep image:` để kiểm, và `up -d` có chủ đích theo mục 12.
# Container nào không có RepoDigest (image dựng/nạp cục bộ, hoặc chưa từng pull theo digest) thì in dòng chú thích `#`
# và KHÔNG đoán digest.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

command -v docker >/dev/null 2>&1 || { echo "[digests] LỖI: thiếu lệnh 'docker'." >&2; exit 1; }
docker info >/dev/null 2>&1 || { echo "[digests] LỖI: không nói chuyện được với Docker daemon." >&2; exit 1; }

# "<tên container>:<biến env tương ứng trong docker-compose.yml>"
readonly TARGETS=(
  "realestate_mongo:MONGO_IMAGE"
  "realestate_redis:REDIS_IMAGE"
  "realestate_minio:MINIO_IMAGE"
  "realestate_9router:NINE_ROUTER_IMAGE"
  "realestate_cloudflared:CLOUDFLARED_IMAGE"
)

# Bỏ `@digest` và `:tag` (chỉ khi `:` nằm ở phần tên cuối, không nhầm với cổng registry `host:5000/...`).
repo_of() {
  local r="${1%%@*}"
  [[ "${r##*/}" == *:* ]] && r="${r%:*}"
  printf '%s' "$r"
}

for target in "${TARGETS[@]}"; do
  container="${target%%:*}"
  var="${target##*:}"

  if ! cfg_image="$(docker inspect -f '{{.Config.Image}}' "$container" 2>/dev/null)"; then
    echo "# $var: không thấy container $container (chưa chạy?): bỏ qua"
    continue
  fi
  image_id="$(docker inspect -f '{{.Image}}' "$container")"
  repo="$(repo_of "$cfg_image")"

  digest=""
  while IFS= read -r rd; do
    [[ -n "$rd" ]] || continue
    # RepoDigest dạng <repo>@sha256:...; chỉ nhận cái cùng repo với image mà container khai báo.
    if [[ "$(repo_of "$rd")" == "$repo" || "$(repo_of "$rd")" == "docker.io/$repo" || "docker.io/$(repo_of "$rd")" == "$repo" ]]; then
      digest="$rd"
      break
    fi
  done < <(docker image inspect -f '{{range .RepoDigests}}{{println .}}{{end}}' "$image_id" 2>/dev/null || true)

  if [[ -n "$digest" ]]; then
    echo "# $container đang chạy image khai báo: $cfg_image"
    echo "$var=$digest"
  else
    echo "# $var: $container (image $cfg_image, id $image_id) KHÔNG có RepoDigest khớp: không ghim được từ máy này. Không đoán digest."
  fi
done
