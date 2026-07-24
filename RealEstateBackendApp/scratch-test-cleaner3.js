const { cleanMarkdownContent } = require('./dist/utils/content-cleaner.js');
const fs = require('fs');

const input = `
# Xem thêm: 

* [Tin 1](url)

Bài viết rất hay.

**Quảng cáo**

Đọc Nhiều

Đồng bộ lỡ

Chia sẻ bài viết

Theo Côngnghiệpnôngthôn
`;

const result = cleanMarkdownContent(input);
console.log("--- INPUT ---");
console.log(input);
console.log("--- OUTPUT ---");
console.log(result);
