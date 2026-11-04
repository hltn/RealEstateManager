# Danh sách task: <Tên tính năng / module>

> **Phiên bản tài liệu:** vX.Y.Z

> Ngày tạo: YYYY-MM-DD
> Module: <NN_Module_Ten>
> Trạng thái: Draft | Approved
> Author: <người viết>
> Dựa trên: `<NN_Module_X>/NN_<Ten>_Plan.md`, `<NN_Module_X>/NN_<Ten>_Architecture.md`

---

## Quy ước

- Mã task `T-01, T-02…`, không đổi khi đã Approved (thêm task mới thì đánh mã tiếp theo).
- **Agent:** `BE` = `coder-backend-agent`, `FE` = `coder-frontend-agent`, `DevOps` = `devops-agent`.
- **Nhãn `[P]`:** task làm song song được với các task `[P]` khác cùng đợt (không sửa cùng file/module, không phụ thuộc nhau).
- **FR:** mã yêu cầu trong Plan (`FR-xx`). Mỗi FR có ít nhất một task; mỗi task trỏ về ít nhất một FR.
- **Ô tick:** `[ ]` chưa làm, `[x]` đã xong (code + unit test, `qa-agent` đã review đạt).
- **Hoàn tất:** file Tasks xong khi mọi task đều `[x]`; không có trạng thái riêng.

## Đợt 1: <tên đợt>

| Xong | Mã | Nhãn | Tên task | Agent | Phụ thuộc | FR | Tiêu chí xong |
|---|---|---|---|---|---|---|---|
| [ ] | T-01 | | <việc cần làm, đủ nhỏ để giao một lần cho một coder> | BE | — | FR-01 | <điều kiện kiểm được, gồm test nào> |
| [ ] | T-02 | [P] | | FE | T-01 | FR-01, FR-02 | |
| [ ] | T-03 | [P] | | BE | T-01 | FR-02 | |

## Đợt 2: <tên đợt>

| Xong | Mã | Nhãn | Tên task | Agent | Phụ thuộc | FR | Tiêu chí xong |
|---|---|---|---|---|---|---|---|
| [ ] | T-04 | | | | T-02, T-03 | | |

## Ma trận phủ FR

> `/spec-tasks` điền cột FR ↔ Task (khớp cột FR của bảng task); `/spec-implement` điền "Test tham chiếu" khi task xong. Task DevOps hoặc FR không kiểm bằng unit test thì ghi `kiểm chứng khác: <script/checklist>`.

| FR | Task | Test tham chiếu |
|---|---|---|
| FR-01 | T-01, T-02 | <file test> |

---

Tài liệu liên quan: <đường dẫn tính từ `docs/`>
