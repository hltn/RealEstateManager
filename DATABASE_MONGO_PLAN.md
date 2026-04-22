# [ PROJECT_PLAN ] | [ DATABASE_PLAN ] | [ DATABASE_MONGO_PLAN ] | [ UI_DESIGN_PLAN ]

> [!IMPORTANT]
> **QUY TẮC ĐỒNG BỘ DỮ LIỆU:**
> Khi 1 trong 4 file kế hoạch (Project, Database, Database Mongo, UI Design) thay đổi hoặc update tính năng, **bắt buộc** phải cập nhật cấu trúc dữ liệu (các trường dữ liệu) vào các file còn lại để đảm bảo tính nhất quán.

# Thiết kế Cơ sở Dữ liệu NoSQL (MongoDB Plan) - Real Estate Manager

Tài liệu này mô tả cấu trúc dữ liệu dưới dạng Document-oriented (JSON-like) dành cho MongoDB, tập trung vào việc tối ưu hóa hiệu năng truy vấn bằng cách nhúng (embedding) dữ liệu liên quan.

## 1. Chiến lược Thiết kế (Design Strategy)

- **Embedding (Nhúng)**: Sử dụng cho các dữ liệu ít thay đổi hoặc luôn đi kèm với nhau (ví dụ: Địa chỉ, Hình ảnh, Thông số kỹ thuật, Thông tin CCCD).
- **Referencing (Tham chiếu)**: Sử dụng cho các quan hệ lớn hoặc dữ liệu cần quản lý độc lập (ví dụ: Nhân viên, Dự án, Chủ nhà).
- **Schema-less Flexibility**: Cho phép linh hoạt thêm các trường đặc thù cho từng loại hình BĐS (Chung cư khác với Nhà ngõ).

---

## 2. Các Collections Chính

### 2.1. Collection `real_estates` (Nguồn hàng)
Lưu trữ toàn bộ thông tin về bất động sản.

```json
{
  "_id": "ObjectId",
  "code": "HN-CG-001",
  "title": "Bán nhà mặt phố Cầu Giấy, 5 tầng, kinh doanh tốt",
  "description": "Mô tả chi tiết về bất động sản...",
  "property_type": "STREET_HOUSE",
  "transaction": {
    "type": "SALE",
    "segment": "SECONDARY",
    "status": "SELLING"
  },
  "location": {
    "province": { "id": "uuid", "name": "Hà Nội" },
    "district": { "id": "uuid", "name": "Cầu Giấy" },
    "ward": { "id": "uuid", "name": "Dịch Vọng" },
    "address_detail": "Số 123 đường Cầu Giấy",
    "coordinates": { "lat": 21.036, "lng": 105.790 },
    "map_link": "https://goo.gl/maps/..."
  },
  "pricing": {
    "value": 15.5,
    "unit": "BILLION",
    "commission": { "type": "PERCENT", "value": 3 }
  },
  "specifications": {
    "area": { "documented": 50, "actual": 55 },
    "dimensions": { "width": 5, "depth": 11 },
    "construction": { "building_area": 50, "gfa": 250 },
    "alley": { "distance": 0, "width": 20 },
    "floors": 5,
    "bedrooms": 6,
    "bathrooms": 5,
    "orientation": { "main": "South", "balcony": "South" }
  },
  "details": {
    "legal_status": "RED_BOOK",
    "furniture": "BASIC",
    "amenities": ["elevator", "gara"]
  },
  "images": [
    { 
      "cloud_url": "https://...", 
      "local_path": "2026/04/properties/HN-CG-001/front.jpg",
      "category": "FRONT", 
      "sort_order": 1 
    }
  ],
  "agent_id": "ObjectId", 
  "landlord_id": "ObjectId",
  "project_id": "ObjectId",
  "created_at": "ISODate",
  "updated_at": "ISODate",
  "is_deleted": false
}
```

### 2.2. Collection `customer_demands` (Nhu cầu khách hàng)
Lưu trữ thông tin khách hàng và tiêu chí tìm kiếm, bao gồm hồ sơ CCCD.

```json
{
  "_id": "ObjectId",
  "agent_id": "ObjectId",
  "customer": {
    "name": "Nguyễn Văn A",
    "phone": "0901234567",
    "age": 35,
    "identity": {
      "number": "001090001234",
      "dob": "1989-01-01",
      "gender": "MALE",
      "nationality": "Việt Nam",
      "origin": "Thái Bình",
      "residence": "Hà Nội",
      "issued": {
        "date": "2021-05-15",
        "place": "Cục Cảnh sát QLHC về trật tự xã hội"
      },
      "images": {
        "front": { "cloud": "...", "local": "..." },
        "back": { "cloud": "...", "local": "..." }
      }
    }
  },
  "search_criteria": {
    "target_locations": [
      { "district_id": "uuid", "name": "Cầu Giấy" },
      { "district_id": "uuid", "name": "Nam Từ Liêm" }
    ],
    "budget": { "min": 5, "max": 8, "unit": "BILLION" },
    "real_estate_types": ["STREET_HOUSE", "ALLEY_HOUSE"],
    "purpose": "STAY"
  },
  "notes": "Khách cần nhà hướng Nam hoặc Đông Nam",
  "created_at": "ISODate",
  "updated_at": "ISODate"
}
```

### 2.3. Collection `users` (Nhân viên & Tài khoản)
```json
{
  "_id": "ObjectId",
  "full_name": "Trần Thị B",
  "phone": "0987654321",
  "email": "agent.b@company.com",
  "role_id": "ObjectId", 
  "department_id": "ObjectId", 
  "is_active": true,
  "created_at": "ISODate"
}
```

### 2.4. Collection `roles` (Vai trò & Quyền hạn)
```json
{
  "_id": "ObjectId",
  "name": "Trưởng phòng Kinh doanh",
  "slug": "manager",
  "permissions": [
    "user:view_dept",
    "user:manage_dept",
    "real_estate:view_dept",
    "real_estate:manage_dept",
    "demand:manage_own",
    "demand:view_dept"
  ]
}
```

### 2.5. Collection `departments` (Phòng ban)
```json
{
  "_id": "ObjectId",
  "name": "Phòng Kinh doanh 1",
  "description": "Chuyên trách khu vực Cầu Giấy",
  "manager_id": "ObjectId",
  "created_at": "ISODate"
}
```

### 2.5. Collection `landlords` (Chủ nhà)
```json
{
  "_id": "ObjectId",
  "full_name": "Bác Hùng Chủ Nhà",
  "phones": ["0912345678", "0243..."],
  "address": "Số 10, ngõ 5, Láng Hạ",
  "notes": "Chủ nhà dễ tính, thích làm việc vào buổi sáng",
  "interaction_summary": {
    "last_contact": "ISODate",
    "total_interactions": 5
  },
  "created_at": "ISODate"
}
```

### 2.6. Collection `interactions` (Nhật ký tương tác)
Lưu vết các cuộc gọi, gặp mặt với chủ nhà hoặc khách hàng.
```json
{
  "_id": "ObjectId",
  "entity_type": "LANDLORD", 
  "entity_id": "ObjectId",
  "agent_id": "ObjectId",
  "content": "Gọi điện thương lượng giảm giá, chủ nhà đồng ý bớt 200tr",
  "interaction_type": "CALL",
  "created_at": "ISODate"
}
```

### 2.7. Collection `projects` (Dự án)
```json
{
  "_id": "ObjectId",
  "name": "Vinhomes Skylake",
  "developer": "Vingroup",
  "location": {
    "district": "Nam Từ Liêm",
    "ward": "Mỹ Đình 1"
  },
  "legal_status": "Sổ hồng vĩnh viễn",
  "amenities": ["Bể bơi", "Gym", "TTTM"],
  "status": "HANDED_OVER"
}
```

### 2.8. Collection `locations` (Địa điểm Master Data)
```json
{
  "_id": "uuid/code",
  "name": "Cầu Giấy",
  "type": "DISTRICT",
  "parent_code": "HN",
  "sub_locations": [
    { "code": "DV", "name": "Dịch Vọng" },
    { "code": "YV", "name": "Yên Hòa" }
  ]
}
```

### 2.9. Collection `system_settings` (Cấu hình hệ thống)
```json
{
  "_id": "ObjectId",
  "key": "STORAGE_MODE",
  "value": "LOCAL",
  "description": "Chế độ lưu trữ ảnh ưu tiên (LOCAL hoặc CLOUD)",
  "updated_at": "ISODate"
}
```

### 2.10. Collection `marketing_ads` (Tin quảng cáo mẫu)
```json
{
  "_id": "ObjectId",
  "real_estate_id": "ObjectId",
  "creator_id": "ObjectId",
  "platform": "ZALO",
  "title": "Căn hộ cao cấp Vinhomes - Giá cực tốt",
  "content": "Nội dung tin đăng đã được tối ưu cho Zalo...",
  "selected_images": [
    { "cloud_url": "...", "local_path": "...", "sort_order": 1 }
  ],
  "created_at": "ISODate"
}
```

### 2.11. Collection `real_estate_interests` (Theo dõi/Quan tâm)
```json
{
  "_id": "ObjectId",
  "user_id": "ObjectId",
  "real_estate_id": "ObjectId",
  "created_at": "ISODate"
}
```

---

## 3. Ưu điểm so với RDBMS trong Dự án này

1.  **Tính linh hoạt của Nguồn hàng**: Dễ dàng thêm các trường mới như `pool_area` cho Villa mà không cần sửa schema toàn bộ bảng.
2.  **Tốc độ truy vấn Tin đăng**: Do dữ liệu Hình ảnh và Thông số đã được nhúng sẵn, chỉ cần 1 câu lệnh `findOne` để lấy toàn bộ dữ liệu trang Chi tiết, không cần JOIN nhiều bảng.
3.  **Hồ sơ CCCD**: Lưu trữ ảnh và thông tin chi tiết CCCD dưới dạng một object lồng nhau giúp quản lý dữ liệu khách hàng tập trung và gọn gàng hơn.
4.  **Dễ dàng mở rộng (Scaling)**: MongoDB hỗ trợ Sharding tốt nếu lượng tin đăng và ảnh lên đến hàng triệu bản ghi.
---

## 4. Ma trận Phân quyền (RBAC Matrix)

| Chức năng | Admin | Manager | Listing Agent | Sales Agent |
| :--- | :---: | :---: | :---: | :---: |
| **User: Manage All** | ✅ | ❌ | ❌ | ❌ |
| **User: Manage Dept** | ✅ | ✅ | ❌ | ❌ |
| **Real Estate: Create/Update Own** | ✅ | ✅ | ✅ | ❌ |
| **Real Estate: View All** | ✅ | ✅ | ❌ | ⚠️ (Partial) |
| **Landlord: View/Manage** | ✅ | ✅ | ✅ | ❌ |
| **Demand: Manage Own** | ✅ | ✅ | ✅ | ✅ |
| **Demand: Manage Dept** | ✅ | ✅ | ❌ | ❌ |
| **System: Config (Location, Project)**| ✅ | ❌ | ❌ | ❌ |
