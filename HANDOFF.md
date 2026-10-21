# HANDOFF – stnd-crm-unified (cập nhật 2026-10-21)

Đọc file này trước khi làm tiếp, bất kể đang ở phiên Claude hay gateway nào.

## Mục tiêu
Prototype FRONTEND (không backend) cho module Quản lý khách hàng, hợp nhất 2 thiết kế Stitch (web admin + mobile app) thành 1 web app.
Stitch gốc (chỉ đọc): `stnd-admin-real-estate-manager-crm-oct-16-2026-1-51-45-pm/`, `stnd-real-estate-crm-oct-15-2026-4-14-56-pm/`.

## Quyết định đã chốt
- Breakpoint: <768px = giao diện app (bottom nav, header + drawer Admin); >=768px = giao diện web (sidebar/header Admin). Tablet dùng layout web.
- Chuẩn thiết kế = code của RealEstateAdminApp (xem docs/06_Module_Customer_Management/03_Design_System_Quy_Tac_Phong_Cach.md). Ưu tiên component/style/quy tắc Admin; chỉ làm mới từ template Stitch cái Admin chưa có.
- Màn hình đã có ở Admin thì COPY, không viết lại. Admin mặc định dark mode => mọi màu CRM cần cặp `dark:`.
- KHÔNG viết test. Không backend (mock axios adapter + seeded auth store).
- Các file Admin bị sửa trong prototype đánh dấu `[Prototype]`; bản gốc RealEstateAdminApp không đụng.

## Cấu trúc
- CRM ở `/crm/*` trong `AppLayout`; code tại `src/modules/crm` (alias `@crm/*`).
- Mỗi màn: `index.tsx` + `.desktop.tsx` + `.mobile.tsx`, chọn bằng `useIsMobile` (max-width 767px).
- Dữ liệu: `types/crm.ts`, adapters ở `lib/`, store ở `store/`, localStorage key `stnd_crm_unified_v2`.
- Class dùng chung: `lib/uiClasses.ts`; form kit: `components/form/`; `CrmBreadcrumb`, `CrmModuleTabs`, `CrmBottomNav`.
- Chạy: `npm run dev` (port 5174, launch.json ở `.claude/launch.json`).

## Tiến độ
- [x] Ghép thiết kế, copy Admin, mock backend, responsive shell
- [x] Port 11 màn CRM: CustomerDetail, Customers, DailyTasks, Appointments, CreateAppointment, Reports, CreateCustomer, EditPersona, EditInvestment, Projects, CrmAiConfig
- [x] Dọn dẹp phần lớn (bỏ Material Symbols, gộp uiClasses/form kit, CrmBreadcrumb, min-w-0, key v2, xóa dead code). `npm run lint` + `npm run build` qua (2026-10-21)
- [ ] Chưa xác minh trong cleanup: useSelectedCustomer không fallback customers[0]; điều hướng `replace` sau addCustomer/addAppointment; CrmModuleTabs ẩn trên mobile + scroll tab active; đủ cặp `dark:` (ScreenSkeleton, DropdownItem, DatePicker); đồng nhất STAFF_LIST; README + mục integration notes
- [ ] Kiểm tra bằng mắt: mới xong /crm/today (mobile). Còn Customers, Appointments, Reports, các màn còn lại ở 375/768/1024/1280/1440, dark + light
- [ ] qa-agent review CODE (không viết test)
- [ ] Báo cáo Oniichan

## Hạn chế đã biết (nêu trong báo cáo)
Form chưa dùng react-hook-form + zod; cấu hình AI chưa persist; `timeRange` của bộ lọc nâng cao chưa ảnh hưởng danh sách; số liệu báo cáo là mẫu; light mode một số màn mobile mới chỉ kiểm tra qua DOM.
Lỗi sẵn có ở Admin (để nguyên): `ManageWpScreen` còn console.log debug; thiếu ảnh avatar thông báo.
