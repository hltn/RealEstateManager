import { cleanMarkdownContent } from './content-cleaner';

describe('cleanMarkdownContent', () => {
  it('keeps normal text intact', () => {
    const input = `This is a normal paragraph.\n\nIt has multiple lines.\n\nAnd some **bold** text.`;
    expect(cleanMarkdownContent(input)).toBe(input);
  });

  it('correctly deletes boilerplate like "Xem thêm", "Quảng cáo"', () => {
    const input = `Some text.\n\nQuảng cáo\n\nMore text.\n\n*Xem thêm*\n\nEnd text.`;
    expect(cleanMarkdownContent(input)).toBe(
      `Some text.\n\nMore text.\n\nEnd text.`,
    );
  });

  it('correctly deletes boilerplate with Vietnamese letter "đ"', () => {
    const input = `Bài viết rất hay.\n\nĐăng ký nhận bản tin\n\nChủ đề: Bất động sản\n\nĐể biết thêm chi tiết vui lòng liên hệ\n\nKết thúc.`;
    expect(cleanMarkdownContent(input)).toBe(`Bài viết rất hay.\n\nKết thúc.`);
  });

  it('correctly leaves images (![alt](url)) alone', () => {
    const input = `Look at this image:\n\n![A beautiful landscape](https://example.com/image.jpg)\n\nNice, right?`;
    expect(cleanMarkdownContent(input)).toBe(input);
  });

  it('removes empty links and tracking pixels', () => {
    const input = `Normal text.\n\n[](https://empty.com)\n\n![px](https://track.com)\n\n![tracking](https://track.com/2)\n\n![1x1](https://track.com/3)\n\nEnd of text.`;
    expect(cleanMarkdownContent(input)).toBe(`Normal text.\n\nEnd of text.`);
  });

  it('removes clusters of consecutive links (link-only lists)', () => {
    const input = `Here are some links:\n\n* [Link 1](https://link1.com)\n* [Link 2](https://link2.com)\n* [Link 3](https://link3.com)\n\nBack to normal text.`;
    expect(cleanMarkdownContent(input)).toBe(
      `Here are some links:\n\nBack to normal text.`,
    );
  });

  it('removes links inside inRelatedBlock', () => {
    const input = `Normal text.\n\nTin liên quan\n\n* [Related 1](https://rel1.com)\n* [Related 2](https://rel2.com)\n\nNormal text continues here with more than 50 characters to reset the block.`;
    expect(cleanMarkdownContent(input)).toBe(
      `Normal text.\n\nNormal text continues here with more than 50 characters to reset the block.`,
    );
  });

  // ─── New tests for real-world crawled content ───

  it('removes ad tracking links (analytics-ads/ctag)', () => {
    const input = `Article content here.\n\n[!\\\\\\\\\\nSome Ad Text\\\\\\\\\\nXem thêm](https://nhadat.cafeland.vn/analytics-ads/ctag?ctm=abc123)\n\nMore article content.`;
    const result = cleanMarkdownContent(input);
    expect(result).not.toContain('analytics-ads');
    expect(result).toContain('Article content here.');
    expect(result).toContain('More article content.');
  });

  it('removes ADVERTISEMENT links', () => {
    const input = `Good content.\n\n[ADVERTISEMENT](https://cafeland.vn/ho-tro/quang-cao-banner-66.html "Sponsored")\n\nMore good content.`;
    const result = cleanMarkdownContent(input);
    expect(result).not.toContain('ADVERTISEMENT');
    expect(result).toContain('Good content.');
    expect(result).toContain('More good content.');
  });

  it('removes noise paragraphs (?, !, x, <>)', () => {
    const input = `Real text.\n\n?\n\n!\n\nx\n\n<>\n\n??\n\nMore real text.`;
    const result = cleanMarkdownContent(input);
    expect(result).toBe(`Real text.\n\nMore real text.`);
  });

  it('removes "Đọc Nhiều" header', () => {
    const input = `Article body.\n\nĐọc Nhiều\n\nMore stuff.`;
    const result = cleanMarkdownContent(input);
    expect(result).not.toContain('Đọc Nhiều');
  });

  it('removes social sharing button text', () => {
    const input = `Article body.\n\nFacebook\n\nChia sẻ\n\nLưu tin\n\nBáo cáo\n\nEnd of article.`;
    const result = cleanMarkdownContent(input);
    expect(result).not.toContain('Facebook');
    expect(result).not.toContain('Chia sẻ');
    expect(result).not.toContain('Lưu tin');
    expect(result).toContain('Article body.');
    expect(result).toContain('End of article.');
  });

  it('removes footer description text', () => {
    const input = `Good content.\n\nCafeLand.vn là Network bất động sản hàng đầu tại Việt Nam.\n\nEnd.`;
    const result = cleanMarkdownContent(input);
    expect(result).not.toContain('CafeLand.vn là Network');
    expect(result).toContain('Good content.');
  });

  it('removes form CTA blocks', () => {
    const input = `Content.\n\nSố điện thoại *\n\nĐiền nhanh 1 bước để được hỗ trợ sớm hơn.\n\nMore content.`;
    const result = cleanMarkdownContent(input);
    expect(result).not.toContain('Số điện thoại');
    expect(result).not.toContain('Điền nhanh');
    expect(result).toContain('Content.');
    expect(result).toContain('More content.');
  });

  it('removes "Báo cáo vi phạm" form', () => {
    const input = `Content.\n\nBáo cáo vi phạm\n\nEnd.`;
    const result = cleanMarkdownContent(input);
    expect(result).not.toContain('Báo cáo vi phạm');
  });

  it('removes "Đăng nhập để lưu tin"', () => {
    const input = `Content.\n\nĐăng nhập để lưu tin\n\nEnd.`;
    const result = cleanMarkdownContent(input);
    expect(result).not.toContain('Đăng nhập');
  });

  it('removes "Đồng bộ lỡ"', () => {
    const input = `Content.\n\nĐồng bộ lỡ\n\nEnd.`;
    const result = cleanMarkdownContent(input);
    expect(result).not.toContain('Đồng bộ lỡ');
  });

  it('removes "Thông tin form"', () => {
    const input = `Content.\n\nThông tin form\n\nEnd.`;
    const result = cleanMarkdownContent(input);
    expect(result).not.toContain('Thông tin form');
  });

  it('handles empty input', () => {
    expect(cleanMarkdownContent('')).toBe('');
    expect(cleanMarkdownContent(null as any)).toBe('');
    expect(cleanMarkdownContent(undefined as any)).toBe('');
  });

  it('preserves article images with meaningful alt text', () => {
    const input = `Article text.\n\n![Dự án khu đô thị mới](https://example.com/project.jpg)\n\nMore text.`;
    const result = cleanMarkdownContent(input);
    expect(result).toContain(
      '![Dự án khu đô thị mới](https://example.com/project.jpg)',
    );
  });

  it('removes video player UI text when present', () => {
    const input = `Article text.\n\nVideo Player is loading.\n\nPlay Video\n\nMore article text.`;
    const result = cleanMarkdownContent(input);
    expect(result).not.toContain('Video Player');
    expect(result).not.toContain('Play Video');
    expect(result).toContain('Article text.');
    expect(result).toContain('More article text.');
  });
});
