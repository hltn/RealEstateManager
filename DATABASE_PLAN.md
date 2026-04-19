# Thiết kế Cơ sở Dữ liệu (Database Plan) - Real Estate Manager

Tài liệu này mô tả cấu trúc cơ sở dữ liệu quan hệ cho ứng dụng Quản lý Nguồn hàng Bất động sản, dựa trên các yêu cầu từ `PROJECT_PLAN.md`.

## 1. Sơ đồ Quan hệ (Entity Relationship Overview)

Hệ thống sử dụng **PostgreSQL** với các bảng chính và mối quan hệ sau:

- **Users & Departments**: Phân quyền và tổ chức nhân sự.
- **Real Estates**: Trung tâm của hệ thống, liên kết với Dự án, Địa điểm, Chủ nhà và Người đăng.
- **Landlords**: Quản lý thông tin chủ nhà và lịch sử tương tác.
- **Customer Demands**: Quản lý nhu cầu tìm kiếm của khách hàng để khớp hàng tự động.
- **Real Estate History**: Lưu trữ snapshot để theo dõi biến động dữ liệu.

---

## 2. Chi tiết các Bảng Dữ liệu

### 2.1. Nhóm Người dùng & Tổ chức

#### Bảng `departments` (Phòng ban)
| Trường | Kiểu dữ liệu | Mô tả |
| :--- | :--- | :--- |
| `id` | UUID (PK) | Định danh duy nhất. |
| `name` | VARCHAR(100) | Tên phòng ban. |
| `description` | TEXT | Mô tả chức năng. |
| `created_at` | TIMESTAMP | Thời gian tạo. |

#### Bảng `users` (Nhân viên)
| Trường | Kiểu dữ liệu | Mô tả |
| :--- | :--- | :--- |
| `id` | UUID (PK) | Định danh duy nhất. |
| `full_name` | VARCHAR(100) | Họ và tên. |
| `phone_number` | VARCHAR(20) | Số điện thoại (Dùng để đăng nhập). |
| `email` | VARCHAR(100) | Email công việc. |
| `password_hash` | VARCHAR(255) | Mật khẩu mã hóa. |
| `role_id` | UUID (FK) | Liên kết tới bảng `roles`. |
| `department_id` | UUID (FK) | Liên kết tới bảng `departments`. |
| `is_active` | BOOLEAN | Trạng thái hoạt động. |

#### Bảng `roles` (Vai trò)
| Trường | Kiểu dữ liệu | Mô tả |
| :--- | :--- | :--- |
| `id` | UUID (PK) | Định danh duy nhất. |
| `name` | VARCHAR(50) | Tên vai trò (Admin, Manager, Agent...). |
| `slug` | VARCHAR(50) | Mã vai trò (admin, manager, listing_agent...). |

#### Bảng `permissions` (Quyền hạn)
| Trường | Kiểu dữ liệu | Mô tả |
| :--- | :--- | :--- |
| `id` | UUID (PK) | Định danh duy nhất. |
| `name` | VARCHAR(100) | Tên quyền (Thêm nguồn hàng, Xóa user...). |
| `key` | VARCHAR(100) | Mã quyền (property:create, user:delete...). |

#### Bảng `role_permissions` (Bảng trung gian)
| Trường | Kiểu dữ liệu | Mô tả |
| :--- | :--- | :--- |
| `role_id` | UUID (FK) | Liên kết `roles`. |
| `permission_id` | UUID (FK) | Liên kết `permissions`. |

---

### 2.2. Nhóm Danh mục & Địa điểm

#### Bảng `locations` (Địa điểm tầng bậc)
| Trường | Kiểu dữ liệu | Mô tả |
| :--- | :--- | :--- |
| `id` | UUID (PK) | Định danh duy nhất. |
| `name` | VARCHAR(100) | Tên địa danh (Tỉnh, Quận, Phường). |
| `type` | ENUM | PROVINCE, DISTRICT, WARD. |
| `parent_id` | UUID (FK) | Liên kết chính nó (Đệ quy). |
| `slug` | VARCHAR(100) | Chuẩn hóa tên để tìm kiếm nhanh. |

#### Bảng `projects` (Dự án Bất động sản)
| Trường | Kiểu dữ liệu | Mô tả |
| :--- | :--- | :--- |
| `id` | UUID (PK) | Định danh duy nhất. |
| `name` | VARCHAR(255) | Tên dự án. |
| `developer` | VARCHAR(255) | Chủ đầu tư. |
| `location_id` | UUID (FK) | Liên kết tới `locations` (Phường/Quận). |
| `scale` | TEXT | Quy mô dự án. |
| `legal_status` | TEXT | Pháp lý tổng thể của dự án. |
| `status` | ENUM | UPCOMING, SELLING, HANDED_OVER. |
| `images` | JSONB | Mảng URL ảnh phối cảnh/mặt bằng. |

---

### 2.3. Nhóm Nguồn hàng (Real Estates)

#### Bảng `landlords` (Chủ nhà)
| Trường | Kiểu dữ liệu | Mô tả |
| :--- | :--- | :--- |
| `id` | UUID (PK) | Định danh duy nhất. |
| `full_name` | VARCHAR(100) | Tên chủ nhà. |
| `phones` | JSONB | Mảng các số điện thoại liên hệ. |
| `address` | TEXT | Địa chỉ liên hệ của chủ nhà. |
| `notes` | TEXT | Ghi chú về đặc điểm, tính cách chủ nhà. |

#### Bảng `real_estates` (Nguồn hàng chi tiết)
| Trường | Kiểu dữ liệu | Mô tả |
| :--- | :--- | :--- |
| `id` | UUID (PK) | Định danh duy nhất. |
| `code` | VARCHAR(20) | Mã hàng (Unique, ví dụ: HN-CG-001). |
| `title` | VARCHAR(255) | Tiêu đề tin đăng. |
| `description` | TEXT | Mô tả chi tiết. |
| `real_estate_type` | ENUM | APARTMENT, VILLA, STREET_HOUSE, OFFICE, ALLEY_HOUSE... |
| `transaction_type` | ENUM | SALE (Bán), RENT (Cho thuê). |
| `segment` | ENUM | PRIMARY (Sơ cấp), SECONDARY (Thứ cấp). |
| `status` | ENUM | SELLING, DEPOSIT, SOLD, STOPPED. |
| `project_id` | UUID (FK) | Thuộc dự án nào (Nullable). |
| `location_id` | UUID (FK) | Phường/Xã cụ thể. |
| `address_detail` | VARCHAR(255) | Số nhà, tên đường. |
| `lat`, `lng` | DECIMAL | Tọa độ GPS. |
| `map_link` | TEXT | Link Google Maps. |
| `price` | DECIMAL | Giá trị (Số). |
| `price_unit` | ENUM | BILLION, MILLION. |
| `commission` | JSONB | Thông tin hoa hồng (% hoặc số tiền). |
| `area_documented` | DECIMAL | Diện tích trên sổ. |
| `area_actual` | DECIMAL | Diện tích thực tế. |
| `width`, `depth` | DECIMAL | Mặt tiền và Chiều sâu (Ẩn nếu RENT). |
| `building_area` | DECIMAL | Diện tích xây dựng (Ẩn nếu RENT). |
| `gfa` | DECIMAL | Tổng diện tích sàn (Ẩn nếu RENT). |
| `alley_distance` | DECIMAL | Khoảng cách ra phố (Ẩn nếu RENT). |
| `alley_width` | DECIMAL | Độ rộng ngõ (Ẩn nếu RENT). |
| `floors`, `bedrooms` | INTEGER | Số tầng, số phòng ngủ. |
| `direction_main` | VARCHAR(50) | Hướng cửa chính. |
| `legal_status` | ENUM | RED_BOOK, PERMIT, CONTRACT, WAITING. |
| `furniture` | ENUM | FULL, BASIC, EMPTY. |
| `listing_agent_id` | UUID (FK) | Người phụ trách nguồn (Đầu chủ). |
| `landlord_id` | UUID (FK) | Liên kết tới `landlords`. |

#### Bảng `real_estate_images` (Quản lý hình ảnh)
| Trường | Kiểu dữ liệu | Mô tả |
| :--- | :--- | :--- |
| `id` | UUID (PK) | Định danh duy nhất. |
| `real_estate_id` | UUID (FK) | Liên kết tới `real_estates`. |
| `cloud_url` | TEXT | Link ảnh trên Cloudinary. |
| `local_path` | TEXT | Đường dẫn tương đối trong kho ảnh (Relative path). Base path cấu hình ở biến hệ thống. |
| `category` | ENUM | FRONT, ALLEY, LIVING_ROOM, KITCHEN, BEDROOM, TOILET. |
| `sort_order` | INTEGER | Thứ tự hiển thị. |

#### Bảng `system_settings` (Cấu hình hệ thống)
| Trường | Kiểu dữ liệu | Mô tả |
| :--- | :--- | :--- |
| `id` | UUID (PK) | Định danh duy nhất. |
| `key` | VARCHAR(100) | Mã cấu hình (Vd: `STORAGE_MODE`, `BASE_STORAGE_PATH`). |
| `value` | TEXT | Giá trị cấu hình. |
| `description` | TEXT | Mô tả ý nghĩa của cấu hình. |
| `updated_at` | TIMESTAMP | Thời gian cập nhật gần nhất. |

#### Bảng `marketing_ads` (Tin quảng cáo mẫu)
| Trường | Kiểu dữ liệu | Mô tả |
| :--- | :--- | :--- |
| `id` | UUID (PK) | Định danh duy nhất. |
| `real_estate_id` | UUID (FK) | Liên kết tới `real_estates`. |
| `user_id` | UUID (FK) | Người tạo/biên tập tin đăng. |
| `title` | VARCHAR(255) | Tiêu đề tin đăng marketing. |
| `content` | TEXT | Nội dung tin đăng (Đã biên tập). |
| `images` | JSONB | Danh sách URL/Path ảnh được chọn và thứ tự hiển thị. |
| `platform` | VARCHAR(50) | Loại nền tảng (ZALO, FACEBOOK, TIKTOK...). |
| `created_at` | TIMESTAMP | Thời gian tạo. |

---

### 2.4. Nhóm Khách hàng & Tương tác

#### Bảng `customer_demands` (Nhu cầu khách hàng)
| Trường | Kiểu dữ liệu | Mô tả |
| :--- | :--- | :--- |
| `id` | UUID (PK) | Định danh duy nhất. |
| `sales_agent_id` | UUID (FK) | Đầu khách quản lý nhu cầu này. |
| `customer_name` | VARCHAR(100) | Tên khách hàng. |
| `customer_phone` | VARCHAR(20) | SĐT khách. |
| `target_locations` | JSONB | Mảng các ID `locations` quan tâm. |
| `budget_min`, `budget_max` | DECIMAL | Khoảng tài chính. |
| `real_estate_types` | JSONB | Mảng các loại hình BĐS quan tâm. |
| `purpose` | ENUM | STAY, INVEST. |
| `id_card_number` | VARCHAR(20) | Số CCCD/CMND. |
| `id_card_images` | JSONB | Lưu URL ảnh mặt trước và mặt sau CCCD. |
| `id_card_dob` | DATE | Ngày sinh trên CCCD. |
| `id_card_gender` | ENUM | Giới tính (MALE, FEMALE, OTHER). |
| `id_card_nationality`| VARCHAR(100) | Quốc tịch (Mặc định: Việt Nam). |
| `id_card_origin` | VARCHAR(255) | Quê quán. |
| `id_card_residence`| VARCHAR(255) | Nơi thường trú. |
| `id_card_issued_date` | DATE | Ngày cấp CCCD. |
| `id_card_issued_place`| VARCHAR(255) | Nơi cấp CCCD. |
| `notes` | TEXT | Ghi chú thêm về nhu cầu. |

#### Bảng `real_estate_history` (Lịch sử thay đổi)
| Trường | Kiểu dữ liệu | Mô tả |
| :--- | :--- | :--- |
| `id` | UUID (PK) | Định danh duy nhất. |
| `real_estate_id` | UUID (FK) | Bất động sản bị thay đổi. |
| `user_id` | UUID (FK) | Người thực hiện thay đổi. |
| `snapshot` | JSONB | Bản sao lưu toàn bộ dữ liệu tại thời điểm đó. |
| `diff` | JSONB | Ghi nhận các trường cụ thể đã thay đổi. |
| `created_at` | TIMESTAMP | Thời điểm thay đổi. |

---

## 4. Ma trận Phân quyền (RBAC Matrix)

| Chức năng | Admin | Manager | Listing Agent | Sales Agent |
| :--- | :---: | :---: | :---: | :---: |
| **User: Manage All** | ✅ | ❌ | ❌ | ❌ |
| **User: Manage Dept** | ✅ | ✅ | ❌ | ❌ |
| **Property: Create/Update Own** | ✅ | ✅ | ✅ | ❌ |
| **Property: View All** | ✅ | ✅ | ❌ | ⚠️ (Partial) |
| **Landlord: View/Manage** | ✅ | ✅ | ✅ | ❌ |
| **Demand: Manage Own** | ✅ | ✅ | ✅ | ✅ |
| **Demand: Manage Dept** | ✅ | ✅ | ❌ | ❌ |
| **System: Config (Location, Project)**| ✅ | ❌ | ❌ | ❌ |
