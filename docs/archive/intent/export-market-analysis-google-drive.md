# Intent: Export Market Analysis lên Google Drive

> Date: 2026-08-15
> Confirmed: Yes (Oniichan)

---

## Outcome

Admin/Editor có thể export báo cáo phân tích thị trường (Market Analysis) lên Google Drive trực tiếp từ giao diện quản trị.

## User

Admin, Editor — role có quyền quản lý tin tức và phân tích thị trường trên hệ thống.

## Why now

Báo cáo phân tích thị trường hiện chỉ lưu trong database, không dễ dàng chia sẻ với team hoặc khách hàng bên ngoài. Cần export ra Google Drive để tiện truy cập, share, và lưu trữ.

## Success

1. User connect Google Drive thành công qua tab OAuth trên UI
2. User click Export → file xuất hiện trên Google Drive
3. User có thể mở link và xem report ngay trên Drive
4. Report mới được append (Ưu tiên 1) hoặc tạo file mới (Ưu tiên 2) mà không ghi đè report cũ
5. User chưa connect Drive → không export được (architect quyết định UX)

## Constraint

- Mỗi user tự connect Drive cá nhân (OAuth2 User Flow, không phải Service Account)
- Nút Export bị disabled khi chưa connect → hiện warning, redirect tab OAuth
- Export phải có 2 phương án (Ưu tiên 1 & 2), architect nghiên cứu feasibility

## Out of scope

- Không tự động export khi có report mới (user chủ động click Export)
- Không sync ngược từ Drive về database
- Không share report với user khác trên Drive (user tự share sau khi export)
- Không thay đổi format nội dung report (markdown giữ nguyên)

---

## Requirements chi tiết

### 1. Tab OAuth Google Drive (UI)

- Tab mới trong phần Settings hoặc section riêng trên UI
- Flow OAuth2 User Flow: user tự xác thực tài khoản Google cá nhân
- Hiển thị trạng thái kết nối
- Lưu access token + refresh token vào database (per user)

### 2. Nút Export

**Vị trí:**
- List screen: nút Export ở mỗi row (hoặc bulk export)
- Detail screen: nút Export ở màn hình xem chi tiết report

**Hành động:**
- User click Export → backend upload lên Google Drive → trả về link
- Export không được hoạt động khi user chưa connect Drive (architect quyết định UX)

### 3. Phương án Export (2 ưu tiên)

**Ưu tiên 1 — Export vào 1 file DOCX duy nhất:**
- Mỗi report mới là 1 section trong file, tiêu đề là ngày tạo
- Report mới được **append** vào cuối file, không ghi đè report cũ
- File được tạo lần đầu nếu chưa tồn tại

**Ưu tiên 2 — Export vào folder cấu hình:**
- Folder path được cấu hình sẵn trên backend (env hoặc DB config)
- Mỗi report là 1 file Google Docs riêng
- Tên file: "Báo cáo phân tích thị trường - {date}"

### 4. Architecture Notes (cho architect-agent)

- Cả 2 phương án cần research feasibility
- Cần research: OAuth2 User Flow trong NestJS với googleapis
- Cần research: Token management per user trong MongoDB
