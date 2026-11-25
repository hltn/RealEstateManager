# <Tên tính năng> — Architecture Design

> **Phiên bản tài liệu:** vX.Y.Z

> Ngày tạo: YYYY-MM-DD
> Author: <người viết>
> Trạng thái: Draft | Approved
> Dựa trên: `<NN_Module_X>/NN_<Ten>_Plan.md`, audit codebase, skill `nodejs-react-mongo-coding-guidelines`

---

## 1. Tổng quan kiến trúc
<Sơ đồ và mô tả luồng chính.>

## 2. Hiện trạng codebase
| Thành phần | Trạng thái | Ghi chú |
|---|---|---|
| | ✅ ĐÃ CÓ / ⚠️ GAP / 🆕 MỚI | |

## 3. Data Model (MongoDB / Mongoose)
> Cột `FR` (ở mục 3, 4, 10): ghi mã FR-xx mà dòng này đáp ứng.

| Collection | Trường | Kiểu | Ràng buộc / Index | FR |
|---|---|---|---|---|

## 4. API Contract
| Method | Endpoint | Quyền | Request | Response | FR |
|---|---|---|---|---|---|

## 5. Service & luồng xử lý
<Service, job, cronjob, xử lý lỗi, idempotency; mỗi mục ghi FR-xx mà nó đáp ứng.>

## 6. Frontend
<Màn hình, state, query key, component dùng lại; mỗi màn hình ghi FR-xx mà nó đáp ứng.>

## 7. Bảo mật & Phân quyền

## 8. Logging & Giám sát

## 9. Kế hoạch kiểm thử
- Unit:
- Integration / E2E:

## 10. Phân việc cho coder agent
| Task | Agent | Phụ thuộc | FR |
|---|---|---|---|

## 11. Rủi ro & Câu hỏi mở
