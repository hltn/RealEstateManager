# Hướng Dẫn Setup VPS Mới (Zero-Trust): Tailscale + Cloudflared + Docker

Tài liệu hướng dẫn từng bước thiết lập một **VPS Ubuntu/Debian mới tinh** theo kiến trúc bảo mật **Zero-Trust**:
- **SSH & Quản trị nội bộ:** Đi hoàn toàn qua mạng riêng **Tailscale** (đóng cổng SSH public sau khi hoàn tất).
- **Public Web/API ra tên miền:** Đi qua **Cloudflare Tunnel (`cloudflared`)** — không cần mở port `80`/`443` trên VPS, ẩn hoàn toàn IP thật của VPS.
- **Ứng dụng:** Chạy trên **Docker + Docker Compose v2** (chỉ bind vào `127.0.0.1` hoặc IP Tailscale để ngăn Docker tự ý mở port ra ngoài Internet).

---

## Kiến trúc tổng quan

```
[Người dùng Internet] ---> [Cloudflare Edge (HTTPS/WAF)]
                                   |
                          (Cloudflare Tunnel)
                                   v
                      +-------------------------+
                      |        VPS Mới          |
                      |  cloudflared daemon     |
                      |         |               |
                      |         v               |
                      |  127.0.0.1:3000/4000    |
                      |  (Docker Containers)    |
                      +-------------------------+
                                   ^
                            (Tailscale VPN)
                                   |
                    [Máy cá nhân Admin (SSH/DB)]
```

---

## Bước 1: Cập nhật hệ thống, Cài gói cơ bản & Bật OpenSSH Server

Đăng nhập vào máy chủ (hoặc cửa sổ console của máy ảo VirtualBox/VMware) và chạy:

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl wget git ufw ca-certificates gnupg lsb-release htop unzip openssh-server

# Bật và cho phép dịch vụ SSH tự chạy khi khởi động máy
# (Đặc biệt quan trọng khi cài máy ảo Ubuntu trên VirtualBox vì mặc định chưa cài openssh-server)
sudo systemctl enable --now ssh

# Đặt múi giờ Việt Nam
sudo timedatectl set-timezone Asia/Ho_Chi_Minh
```

> **Lưu ý nếu dùng VirtualBox (Unattended Install với tài khoản `vboxuser`):**
> Nếu chạy `sudo` báo lỗi `vboxuser is not in the sudoers file`, hãy gõ:
> ```bash
> su -
> # (Nhập mật khẩu root - mặc định trùng mật khẩu vboxuser)
> usermod -aG sudo vboxuser
> reboot
> ```

---

## Bước 2: Cài đặt và Kết nối Tailscale

### 2.1. Cài Tailscale bằng script chính chủ

```bash
curl -fsSL https://tailscale.com/install.sh | sh
```

### 2.2. Khởi động Tailscale

```bash
sudo tailscale up --ssh
```

- Terminal sẽ in ra một đường link dạng `https://login.tailscale.com/a/...`.
- Copy link đó mở trên trình duyệt để đăng nhập và **Authorize** máy chủ vào mạng Tailscale của bạn.
- *(Nếu gặp lỗi `Connection refused` khi SSH qua IP Tailscale, hãy kiểm tra lại dịch vụ `openssh-server` đã chạy chưa bằng lệnh `sudo systemctl status ssh`).*

### 2.3. Kiểm tra IP Tailscale của VPS

```bash
tailscale ip -4
```

*(Ghi nhớ IP `100.x.y.z` này. Từ giờ bạn có thể SSH thẳng vào VPS bằng `ssh root@100.x.y.z` từ máy cá nhân có bật Tailscale).*

> **Mẹo quan trọng:** Vào trang quản trị [Tailscale Admin Console (Machines)](https://login.tailscale.com/admin/machines), bấm dấu `...` cạnh VPS vừa thêm -> chọn **Disable key expiry** để VPS không bị hết hạn key sau 180 ngày.

---

## Bước 3: Khoá tường lửa UFW (Chỉ cho phép vào qua Tailscale)

Vì Web sẽ đi qua Cloudflare Tunnel và SSH đi qua Tailscale, VPS **không cần mở bất kỳ cổng TCP public nào** ra ngoài Internet:

```bash
# Mặc định chặn mọi kết nối chiều vào, cho phép chiều ra
sudo ufw default deny incoming
sudo ufw default allow outgoing

# Cho phép toàn bộ kết nối nội bộ đi qua card mạng Tailscale (tailscale0)
sudo ufw allow in on tailscale0

# Cho phép cổng UDP 41641 để Tailscale kết nối trực tiếp (Direct peer-to-peer, giảm độ trễ)
sudo ufw allow 41641/udp

# Giữ tạm cổng 22 public để tránh mất kết nối trước khi test SSH qua Tailscale
sudo ufw allow 22/tcp

# Bật tường lửa
sudo ufw enable
sudo ufw status verbose
```

### Khoá hẳn cổng 22 Public (Sau khi đã test SSH qua Tailscale thành công)

1. Mở một cửa sổ Terminal mới trên máy tính của bạn (đã bật Tailscale).
2. Thử đăng nhập qua IP Tailscale:
   ```bash
   ssh root@100.x.y.z
   ```
3. Sau khi xác nhận vào được bình thường, xoá rule mở cổng 22 public:
   ```bash
   sudo ufw delete allow 22/tcp
   sudo ufw status
   ```

---

## Bước 4: Cài đặt Docker & Docker Compose v2

### 4.1. Cài Docker Engine + Compose Plugin từ Docker Repo chính thức

```bash
curl -fsSL https://get.docker.com | sudo sh
```

### 4.2. Cấp quyền chạy Docker không cần `sudo` (nếu dùng user thường)

```bash
sudo usermod -aG docker $USER
newgrp docker
```

### 4.3. Cấu hình giới hạn dung lượng Log cho Docker (Tránh đầy ổ cứng VPS)

```bash
sudo mkdir -p /etc/docker
cat <<EOF | sudo tee /etc/docker/daemon.json
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "3"
  }
}
EOF

sudo systemctl enable docker
sudo systemctl restart docker
docker --version && docker compose version
```

### ⚠️ Lưu ý quan trọng khi viết `docker-compose.yml`

Docker mặc định sẽ can thiệp trực tiếp vào `iptables` và **bỏ qua tường lửa UFW** nếu bạn khai báo `ports: - "3000:3000"`.
Để đảm bảo container chỉ truy cập được bởi `cloudflared` (hoặc từ mạng nội bộ), **luôn chỉ định `127.0.0.1`** trước số cổng:

```yaml
services:
  web:
    image: nginx:alpine
    restart: unless-stopped
    ports:
      - "127.0.0.1:3000:80" # Chỉ lắng nghe ở localhost, không lộ ra IP Public
```

*(Nếu muốn truy cập cổng Database như MongoDB/PostgreSQL từ máy cá nhân qua Tailscale, bạn có thể bind vào IP Tailscale của VPS: `"100.x.y.z:27017:27017"`).*

---

## Bước 5: Chạy `cloudflared` bằng Docker & Trỏ Domain về VPS

Chạy `cloudflared` bằng Docker gọn sạch hơn cài trực tiếp lên hệ điều hành, tự động khởi động lại khi VPS reboot (`--restart unless-stopped`) và dễ quản lý chung với các container ứng dụng.

---

### 5.1. Lấy Tunnel Token trên Cloudflare Zero Trust Dashboard

1. Truy cập **[Cloudflare Zero Trust Dashboard](https://one.dash.cloudflare.com/)** -> vào mục **Networks** -> **Tunnels**.
2. Bấm **Create a tunnel** -> chọn **Cloudflared** -> Đặt tên tunnel (ví dụ: `vps-prod-01`) -> **Save tunnel**.
3. Ở mục **Choose your environment**, chọn **Docker**.
4. Cloudflare sẽ hiện ra một câu lệnh có chứa chuỗi token dài bắt đầu bằng `eyJh...` sau cờ `--token`. Hãy copy chuỗi `<TOKEN_CUA_BAN>` đó.

---

### 5.2. Khởi chạy `cloudflared` bằng Docker (Chọn 1 trong 2 kiểu kết nối mạng)

#### Cách 1: Dùng `--network host` (Đơn giản nhất - Gọi thẳng `127.0.0.1:<PORT>` của VPS)

Khi dùng `--network host`, container `cloudflared` dùng chung mạng localhost của VPS, nên bạn có thể trỏ tới bất kỳ port `127.0.0.1:xxxx` nào trên VPS:

**Chạy nhanh bằng lệnh `docker run`:**
```bash
docker run -d \
  --name cloudflared \
  --network host \
  --restart unless-stopped \
  cloudflare/cloudflared:latest \
  tunnel --no-autoupdate run --token <TOKEN_CUA_BAN>
```

**Hoặc dùng `docker-compose.yml` (Khuyên dùng để lưu lại cấu hình):**
```bash
mkdir -p ~/cloudflared && cd ~/cloudflared
cat <<EOF > docker-compose.yml
services:
  cloudflared:
    image: cloudflare/cloudflared:latest
    container_name: cloudflared
    restart: unless-stopped
    network_mode: "host"
    command: tunnel --no-autoupdate run --token <TOKEN_CUA_BAN>
EOF

docker compose up -d
```

---

#### Cách 2: Dùng Docker Bridge Network riêng (Chuẩn Microservices - Không cần mở port ra localhost luôn)

Nếu toàn bộ Web/API của bạn đều chạy trong Docker, bạn có thể tạo một mạng ảo `cloudflare-net` để `cloudflared` gọi trực tiếp sang các container khác bằng **tên container** (không cần khai báo `ports:` trên các container web/API):

```bash
# 1. Tạo mạng Docker dùng chung
docker network create cloudflare-net

# 2. Chạy cloudflared gắn vào mạng cloudflare-net
docker run -d \
  --name cloudflared \
  --network cloudflare-net \
  --restart unless-stopped \
  cloudflare/cloudflared:latest \
  tunnel --no-autoupdate run --token <TOKEN_CUA_BAN>
```
*(Khi đó, ở các dự án khác trên VPS, bạn chỉ cần gắn container vào mạng `cloudflare-net`, và trên Cloudflare Dashboard điền URL là `http://ten-container:port-noi-bo` thay vì `127.0.0.1:port`).*

---

### 5.3. Cấu hình Trỏ Domain / Subdomain trên Cloudflare Dashboard

1. Kiểm tra container `cloudflared` đã chạy ổn định chưa:
   ```bash
   docker logs -f cloudflared
   ```
   *(Thấy dòng `Registered tunnel connection` và trên trang Cloudflare hiện trạng thái **CONNECTED** màu xanh là thành công. Bấm `Ctrl + C` để thoát xem log).*
2. Trên màn hình Cloudflare Tunnel, bấm **Next** (hoặc vào tab **Public Hostname** -> **Add a public hostname**):
   - **Subdomain:** điền `api` (hoặc để trống nếu muốn trỏ domain gốc `yourdomain.com`)
   - **Domain:** chọn domain của bạn
   - **Service Type:** `HTTP`
   - **URL:**
     - Nếu chạy **Cách 1 (`--network host`)**: điền `127.0.0.1:3000`
     - Nếu chạy **Cách 2 (`cloudflare-net`)**: điền `test-web:80` (tên container + port bên trong container)
3. Bấm **Save hostname**. Cloudflare sẽ tự động tạo bản ghi DNS `CNAME` và kích hoạt SSL HTTPS ngay lập tức!

---

## Bước 6: Kiểm tra tổng thể (Checklist nghiệm thu)

### 6.1. Chạy thử một container web Nginx để test

- **Nếu dùng Cách 1 (`--network host`):**
  ```bash
  docker run -d --name test-web -p 127.0.0.1:3000:80 nginx:alpine
  ```
- **Nếu dùng Cách 2 (`cloudflare-net`):**
  ```bash
  docker run -d --name test-web --network cloudflare-net nginx:alpine
  ```

### 6.2. Kiểm tra kết nối

1. **Qua tên miền:** Truy cập `https://yourdomain.com` trên trình duyệt -> Hiện trang *Welcome to nginx!* kèm chứng chỉ bảo mật HTTPS của Cloudflare.
2. **Qua IP Public của VPS:** Truy cập `http://<IP_PUBLIC_VPS>:3000` -> Phải báo **không thể kết nối** (Timeout / Connection Refused).
3. **Qua SSH Tailscale:** Chạy `ssh root@100.x.y.z` -> Đăng nhập mượt mà.

### 6.3. Xoá container test sau khi nghiệm thu

```bash
docker rm -f test-web
```

---

## Các lệnh quản trị thường dùng sau khi cài xong

| Nhu cầu | Câu lệnh |
| :--- | :--- |
| Kiểm tra trạng thái Tailscale | `tailscale status` |
| Xem IP Tailscale của VPS | `tailscale ip -4` |
| Xem log của Cloudflare Tunnel (Docker) | `docker logs -f cloudflared` |
| Khởi động lại Cloudflare Tunnel (Docker) | `docker restart cloudflared` |
| Cập nhật `cloudflared` lên bản mới nhất | `docker pull cloudflare/cloudflared:latest && docker restart cloudflared` |
| Xem các port đang lắng nghe trên VPS | `sudo ss -tulpn` |
| Xem trạng thái tường lửa UFW | `sudo ufw status verbose` |
| Xem các container Docker đang chạy | `docker ps` |
