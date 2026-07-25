🏢 PROJECT CONTEXT: DỰ ÁN FULLSTACK NESTJS & REACT (ENTERPRISE LEVEL)

1. Mục tiêu dự án & Tính năng cốt lõi

**Mục tiêu dự án:**
Module NewsFireCrawlManager được xây dựng nhằm tự động hóa quy trình thu thập tin tức bất động sản, sử dụng AI để phân tích/lọc nội dung, và đăng tải tự động lên hệ thống WordPress. Hệ thống được thiết kế theo chuẩn Enterprise, đảm bảo tính ổn định, bảo mật và khả năng chịu tải cao (High Traffic).

**Các tính năng cốt lõi:**
1. **Thu thập tin tức tự động (Web Crawling):** Quản lý danh sách cấu hình nguồn tin (`news_sources`). Thu thập và lưu trữ dữ liệu thô (`raw_articles`) tự động (tích hợp Firecrawl), kèm cơ chế hash URL để chống trùng lặp dữ liệu.
2. **Xử lý và Lọc bằng AI:** Ứng dụng AI để phân tích nội dung, tóm tắt bài viết và đánh giá lý do quan trọng (`summary`, `importanceReason`) trước khi xuất bản.
3. **Đăng tải tự động lên WordPress:** Quản lý vòng đời trạng thái của tin tức (SAVED, POSTED_WP, ERROR) và đồng bộ, tự động đăng bài lên hệ thống WordPress.
4. **Quản trị và Phân quyền Admin:** Giao diện quản lý danh sách tin tức với các bộ lọc nâng cao, hỗ trợ phân quyền Admin chuyên sâu.
5. **Hệ thống hiệu năng cao & An toàn dữ liệu:** Áp dụng Soft Delete để bảo vệ dữ liệu, chống N+1 query, tích hợp Background Jobs/Message Queue cho các tác vụ nặng, đáp ứng các tiêu chuẩn Enterprise khắt khe.

2. Tech Stack (Công nghệ sử dụng)

Frontend: ReactJS, Tailwind CSS, Vite (hoặc Next.js). Bắt buộc TypeScript.

Backend: Node.js, NestJS (Bắt buộc dùng TypeScript 100%).

Database: MongoDB (Sử dụng thư viện Mongoose thông qua @nestjs/mongoose).

Tools: Claude CLI, Graphify, Git.

3. Coding Style & Quy tắc đặt tên (Naming Convention)

Tư duy Thiết kế (Design Principles - Quan trọng):

Bắt buộc tuân thủ nguyên tắc SOLID (đặc biệt là Single Responsibility - mỗi file/class chỉ làm đúng 1 nhiệm vụ).

Tuân thủ DRY (Don't Repeat Yourself - tuyệt đối không duplicate code, logic lặp lại phải tách thành Utils/Helpers).

Nguyên tắc "Biết ít thôi" (Least Privilege Data): Khi query Database, bắt buộc dùng .select() để loại bỏ các trường nhạy cảm (password, refreshToken...). Tuyệt đối không ném nguyên object Database ra API.

Frontend (ReactJS):

Component: Bắt buộc dùng Functional Component kết hợp Hooks. Tên file/Component viết hoa chữ cái đầu PascalCase.

Props & Typing (Bắt buộc): Luôn sử dụng Destructuring cho Props (VD: const UserCard = ({ user, onClick }: UserCardProps) => {}). Mọi Component/Hàm phải khai báo kiểu rõ ràng bằng interface hoặc type.

State: Đặt tên rõ ràng, kiểu boolean bắt buộc dùng tiền tố is, has, should.

Quản lý State (Quy tắc thép): Chỉ dùng useState/useReducer cho state cục bộ. State toàn cục hoặc API bắt buộc dùng Zustand / React Query. Không truyền props quá 3 cấp (Prop drilling).

Backend (NestJS):

Class, Interface, DTO: Bắt buộc viết PascalCase (Ví dụ: UserController, AuthService).

Biến & Phương thức: Tuân thủ camelCase. Ưu tiên const, cấm dùng var.

RESTful API Routing: URL Controller dùng danh từ số nhiều, chữ thường (VD: GET /users). Tuyệt đối không đưa động từ vào URL.

File Naming: Theo chuẩn NestJS tên-chức-năng.loại.ts (VD: user.controller.ts).

Quy tắc Comment & Clean Code:

Mọi phương thức phức tạp đều phải có comment tiếng Việt giải thích rõ luồng chạy.

Tự động dọn dẹp import thừa, biến không sử dụng. Format code bằng Prettier/ESLint.

4. UI/UX Guideline & Design System

Tone màu chủ đạo: Trắng, Xám nhạt và Xanh dương chuyên nghiệp.

Bố cục (Layout): Ưu tiên Mobile-first. Sử dụng Flexbox/CSS Grid. Giao diện sạch sẽ, tối giản.

CSS: Sử dụng class của Tailwind CSS làm chuẩn, hạn chế tối đa CSS inline.

Tài nguyên (Assets): Icon/Ảnh phải tối ưu WebP/SVG. Lưu trong /public.

5. Tiêu chuẩn chất lượng & Quy trình xử lý

Kiến trúc & Hiệu năng (Architecture & Performance):

UX Tối ưu: Sử dụng Skeleton Loading khi fetch data. Áp dụng Optimistic UI (Cập nhật giao diện trước khi API trả về) cho các thao tác like, xóa.

Bundle Size: Nghiêm cấm import toàn bộ thư viện. Bắt buộc import Tree-shaking.

Data Fetching: Cấm dùng useEffect gọi API. Bắt buộc dùng React Query (SWR) để quản lý cache, loading và Race condition.

SEO & Meta Tags: Các trang chi tiết phải cấu hình linh hoạt title, meta description, Open Graph (react-helmet-async).

Timeout & Circuit Breaker: Mọi Request gọi ra ngoài (3rd party) bắt buộc cấu hình Timeout (VD: 5000ms).

Retry & Exponential Backoff: Khi gọi 3rd party thất bại, phải xử lý gọi lại (Retry) với độ trễ tăng dần (Backoff) và ngẫu nhiên (Jitter) để chống nghẽn mạng.

Cache: Với API GET truy vấn nặng, nếu bắt buộc áp dụng Caching (Redis/CacheModule) thì phải thông báo xem có nên dùng không.

Đồng bộ Dữ liệu & Xử lý Lỗi:

Response Format: Mọi API trả danh sách phải có phân trang. Chuẩn: { data: T, meta: { total, page, limit, totalPages } }.

Global Error Handling: Dùng Exception NestJS kết hợp GlobalExceptionFilter. Chuẩn JSON lỗi: { statusCode, message, timestamp, path }.

Tính Luỹ đẳng (Idempotency): API POST/PUT quan trọng (thanh toán, tạo đơn) bắt buộc kiểm tra Idempotency-Key gửi từ Frontend để chống user click đúp.

Bảo mật hệ thống (Security - Tối quan trọng):

CORS & Headers: Chỉ cho phép domain Frontend gọi API. Bắt buộc dùng Helmet.

Authentication: Access Token (Header, sống ngắn), Refresh Token (HTTPOnly Cookie chống XSS).

File Upload: Validate MIME type nghiêm ngặt. Đổi tên file thành UUID ngẫu nhiên.

Chống Tấn Công: Dùng express-mongo-sanitize chống NoSQL Injection. Cài ThrottlerModule (Rate Limit) và khóa tài khoản nếu sai pass > 5 lần.

6. Tiêu chuẩn nâng cao (Enterprise Standards)

Tài liệu API (Swagger): Bắt buộc tích hợp @nestjs/swagger. Controller/DTO phải có @ApiTags(), @ApiOperation(), @ApiProperty().

API Versioning: Mọi Route bắt buộc có tiền tố version (/api/v1/...).

Database (MongoDB - Mongoose):

Hiệu năng: Chống N+1 Query bằng .populate() hoặc Aggregate. Bắt buộc khai báo Index (Chỉ mục) trong Schema.

Transactions (Giao dịch): Update từ 2 Collections trở lên bắt buộc dùng ClientSession Transaction (Yêu cầu DB cấu hình Replica Set).

Mã hóa: Mật khẩu bắt buộc băm bằng Bcrypt/Argon2 (có Salt).

Soft Delete: Không dùng DELETE cứng, thiết lập field deletedAt.

Zero-Downtime Schema: Cấm sửa/xóa field DB đột ngột. Thay đổi schema phải tương thích ngược (Backward Compatible).

DevOps & Môi trường:

Tách biệt logic theo development, staging, production. Chỉ hiện Stack Trace ở dev.

Health Checks: Bắt buộc dùng @nestjs/terminus tạo probe /health/liveness và /health/readiness cho Kubernetes/Docker.

Graceful Shutdown: Bắt buộc cấu hình app.enableShutdownHooks() để xử lý nốt request và đóng DB an toàn trước khi tắt server.

Ghi Log: Cấm dùng console.log. Dùng Winston/Pino.

Feature Flags: Tính năng mới lớn chưa công bố phải được bọc trong cờ cấu hình (Feature Toggle) để merge code an toàn mà không ảnh hưởng Production.

Kiểm tra lỗ hổng bảo mật thư viện qua npm audit.

7. Tiêu chuẩn Kiến trúc Phân tán (High Traffic & Microservices)

Kiến trúc Stateless: Backend hoàn toàn không trạng thái. Session, Cache đẩy ra Redis. File lưu lên Cloud (S3).

Background Jobs: Tác vụ nặng (Email, Export, Xử lý ảnh) bắt buộc tách khỏi luồng chính, dùng Message Queue (RabbitMQ/BullMQ).

Audit Trail (Lưu vết): Mọi hành động Create/Update/Delete dữ liệu quan trọng phải ghi log vào Collection riêng (Ai làm, làm lúc nào, thay đổi gì).

Truy vết Hệ thống (Correlation ID): Frontend bắt buộc sinh X-Request-ID gửi kèm. Backend đính ID này vào mọi dòng log để dễ phá án khi có lỗi xuyên service.