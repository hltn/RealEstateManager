const { cleanMarkdownContent } = require('./dist/utils/content-cleaner.js');

const input = `Bài báo chính.

Nội dung tiếp theo.

[Hà Nội chốt hạn mặt bằng cho loạt cầu vượt sông Hồng](https://cafeland.vn/tin-tuc/ha-noi-chot-han-mat-bang-cho-loat-cau-vuot-song-hong-song-duong-153517.html)

Cầu Tứ Liên phải bàn giao mặt bằng trước 30/7, cầu Lệ Chi trước 15/8; nhiều hạng mục hạ tầng kỹ thuật được yêu cầu hoàn thành ngay trong tháng 7 và 8 để giữ tiến độ các dự án cầu vượt sông Hồng, sông Đuống.`;

console.log("--- BEFORE ---");
console.log(input);
console.log("--- AFTER ---");
console.log(cleanMarkdownContent(input));
