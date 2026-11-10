# Diễn tập staging bằng bản sao dump production (v1.0.5, FR-21)

Nguồn: `docs/06_Module_Customer_Management/11_Dinh_Danh_Khach_Hang_Architecture.md` mục 5.10; task T-18 (chuẩn bị) và T-36 (chạy thật); T-37 (nghiệm thu).
Mọi lệnh dưới đây chỉ nhắm project `realestate-staging` và container `rhstg_*` (cùng rào tên/cổng của `scripts/staging.sh`). Không bao giờ chạm production.

## An toàn dữ liệu (đọc trước)

- Dump production chứa **dữ liệu cá nhân thật**. Chỉ để trong `.staging/` (đã gitignore; `restore-dump` từ chối archive nằm ngoài `.staging/`). Không commit, không gửi đi, không mở nội dung.
- Ảnh chụp (`snapshot`) chỉ chứa **số đếm, spec index, doc `system`** (đã ẩn trường lỗi/thông điệp), không có tên/SĐT. Lưu ở `.staging/snapshots/`.
- Xong diễn tập: `bash scripts/staging.sh reset --yes` (xóa container và volume staging; thêm `--images` nếu muốn xóa cả image), rồi xóa bản sao dump trong `.staging/` (đã chốt: giữ nguyên dump, lưu cục bộ, xóa sau diễn tập; Architecture 11.1b #10).
- `restore-dump` XÓA DB `realestate` của staging. Bắt buộc `--yes`; không hỏi tương tác.

## Chuẩn bị (một lần)

```bash
bash scripts/staging.sh init                    # sinh .staging/env (secret giả), kiểm tiền đề
cp <bản-sao-dump>.archive.gz .staging/prod-copy.archive.gz   # mongodump --archive --gzip của DB realestate
```

## Các bước

Ghi mọi kết quả vào bảng cuối tài liệu (cột "Thực tế" và "Đạt?"). Đo giờ từng bước bằng `date` hoặc `time`.

### Bước 1. Nạp dump và chụp TRƯỚC

```bash
bash scripts/staging.sh restore-dump .staging/prod-copy.archive.gz --yes
bash scripts/staging.sh snapshot truoc          # in JSON và lưu .staging/snapshots/truoc-<giờ>.json
```

Kết quả snapshot cần ghi: `customers.total`, `duplicatePhoneCustomers`/`duplicatePhoneGroups` (khách có SĐT trùng), `phoneAnonymized` (số khách `phone` bắt đầu `anonymized:`), `careTeamWithoutPrimary` (**phải 0**, bất biến FR-10), `customerIndexes` (có `phone_1` **unique**, chưa có index mã), doc `system` (`version`, sổ `migration:*` mới nhất là 006 hoặc 009 tùy bản dump).

### Bước 2. Lập kế hoạch

```bash
bash scripts/staging.sh deploy --plan-only
```

Mong đợi: liệt kê các migration còn chờ **tính từ sổ của dump** (sổ ở 006 thì chờ 007..011; sổ ở 009 thì chỉ chờ 010 và 011), trong đó 007..010 thuộc pre-up và 011 thuộc post-up; không ghi gì (so `snapshot` ngay sau: không đổi).

### Bước 3. Giả lập khoảng giữa 6b và `up` (image cũ v1.0.3 còn phục vụ)

```bash
bash scripts/staging.sh runner reconcile --apply --skip-version --phase pre-up   # tay: 007..010, KHÔNG ghi version
bash scripts/staging.sh step3
```

`step3` (script `scripts/staging/rehearsal-step3.js`, doc chèn có `rehearsalMarker: 'T-18'`) mong đợi `{"insertedWithoutCode":2,...,"duplicatePhoneRejected":true,"ok":true}`:
chèn 2 khách **không có `customerCode`** thành công (unique mã là partial); chèn khách trùng SĐT một khách có sẵn bị **E11000** (unique `phone_1` còn, xác nhận 011 chưa chạy). Thoát mã 1 nếu sai.
Chụp giữa chừng: `bash scripts/staging.sh snapshot giua` (có index mã partial unique, `phone_1` vẫn unique, `withoutCode` bằng toàn bộ khách).

### Bước 4. Deploy đầy đủ

```bash
time bash scripts/staging.sh deploy
bash scripts/staging.sh snapshot sau
```

Mong đợi (so `truoc` với `sau`):
- `up` -> bước 10 (mã danh mục) -> **bước 20** (mọi khách có mã, theo `createdAt`; 2 khách vừa chèn có mã) -> **bước 90** (011).
- `customers.withoutCode` = 0; `duplicateCodeGroups` = 0; `customers.total` = trước + 2 (hai khách chèn ở bước 3).
- `phoneAnonymized` = 0 (đã chuyển `null`, `phoneNull` tăng tương ứng); `customerIndexes` có `phone_1` **không unique** và có index mã **unique partial**.
- `counters` có counter mã khách >= số khách có mã; `system` có `migration:010...` và `migration:011...`.
- Tạo hai khách cùng SĐT qua API (admin trong `.staging/env`, `http://127.0.0.1:13100/api/v1`) thành công cả hai.
- `careTeamWithoutPrimary` vẫn 0.

### Bước 5. Chạy lại và lỗi giữa chừng

1. `bash scripts/staging.sh snapshot truoc-lan2; bash scripts/staging.sh deploy; bash scripts/staging.sh snapshot sau-lan2; diff` hai ảnh: **không đổi** (mã không đổi, 010/011 no-op, bước 20 báo 0 việc trong `.staging/logs/deploy-*.log`).
2. Kịch bản `up` lỗi giữa chừng. Sau bước 4, 011 đã chạy (`phone_1` không còn unique), nên phải **đưa DB về trạng thái trước 011** trước khi thử:
   1. `bash scripts/staging.sh restore-dump .staging/prod-copy.archive.gz --yes` (về đúng dump gốc; sổ và index như bước 1).
   2. `bash scripts/staging.sh runner reconcile --apply --skip-version --phase pre-up` (chạy các migration pre-up còn chờ; 011 vẫn chưa chạy). Kiểm `bash scripts/staging.sh snapshot truoc-up-loi`: có index mã partial unique, `phone_1` **còn unique**.
   3. Tạm làm hỏng khởi động backend staging (ví dụ sửa tạm một biến bắt buộc trong `.staging/backend.env`/override compose; **chỉ staging**), rồi `bash scripts/staging.sh deploy`. Mong đợi: `deploy` dừng trước/trong `up` (mã khác 0), **không** chạy bước 90 nên 011 vẫn chưa chạy (`runner status` còn "Chờ post-up: 1"; `snapshot` cho thấy `phone_1` vẫn unique).
   4. `bash scripts/staging.sh step3`: lúc này mong đợi `ok:true` (chèn 2 khách không mã được; khách trùng SĐT bị E11000 vì `phone_1` còn unique). Đây là cách tạo "khách phát sinh trong khoảng trống" của bước 5.2.
   5. Khôi phục cấu hình backend, `bash scripts/staging.sh deploy` lại. Mong đợi: bước 20 bù mã đủ cho khách tạo trong khoảng trống (`withoutCode` = 0, `duplicateCodeGroups` = 0), rồi bước 90 chạy 011 sau cùng (`phone_1` không unique, `phoneAnonymized` = 0).

### Bước 6. Thời gian, log, nhánh phụ

- Ghi thời gian từng bước (backup, build, migrate, up, bước 10/20/90). Kiểm `.staging/logs/deploy-*.log` và `deploy-customer-codes-*.log`: không có cảnh báo đỏ ngoài dự kiến.
- `--no-migrate`: dựng lại tình huống sổ chưa có 010 (restore lại dump rồi `bash scripts/staging.sh deploy --no-migrate`): bước 20 thoát 0 "chưa áp dụng, bỏ qua", bước 90 từ chối chạy 011 khi còn pre-up chờ.
- Downgrade có chủ ý (`DEPLOY_ALLOW_DOWNGRADE=1`, deploy bản cũ hơn DB): bỏ qua **toàn bộ** điểm gọi hậu-migrate.
- Xác nhận `deploy.sh` không chứa logic bù mã (`grep -n customerCode deploy.sh` không có kết quả nghiệp vụ).

## Bảng ghi kết quả (T-36 điền, T-37 đối chiếu)

| # | Kiểm tra | Mong đợi | Thực tế | Đạt? |
|---|---|---|---|---|
| 1 | `careTeamWithoutPrimary` trước | 0 | | |
| 2 | Kế hoạch `--plan-only` | các migration chờ tính từ sổ của dump: pre-up đến 010, rồi 011 (post-up) | | |
| 3a | `step3`: chèn khách không mã | 2 thành công | | |
| 3b | `step3`: trùng SĐT | E11000 | | |
| 4a | `withoutCode` / `duplicateCodeGroups` sau | 0 / 0 | | |
| 4b | `phoneAnonymized` sau | 0 | | |
| 4c | `phone_1` / index mã sau | thường / unique partial | | |
| 4d | Hai khách cùng SĐT qua API | thành công | | |
| 5a | Deploy lần hai | ảnh không đổi, bước 20 báo 0 việc | | |
| 5b | `up` lỗi rồi deploy lại | bước 20 bù đủ; 011 chỉ chạy sau cùng | | |
| 6a | Thời gian từng bước | ghi nhận | | |
| 6b | `--no-migrate` | bước 20 thoát 0; 011 bị từ chối | | |
| 6c | Downgrade có chủ ý | bỏ qua hậu-migrate | | |
| 6d | `deploy.sh` không chứa logic bù mã | đúng | | |

So sánh hai ảnh: `diff .staging/snapshots/truoc-*.json .staging/snapshots/sau-*.json`.
