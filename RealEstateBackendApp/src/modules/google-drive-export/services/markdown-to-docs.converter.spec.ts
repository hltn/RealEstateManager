/**
 * MarkdownToGoogleDocsConverter unit spec.
 *
 * Bao phủ:
 * - convert(): empty/whitespace markdown → empty array
 * - Headings (H1-H6): insertText + updateParagraphStyle(HEADING_N)
 * - Bold: insertText + updateTextStyle(BOLD)
 * - Italic: insertText + updateTextStyle(ITALIC)
 * - Inline code (codespan): insertText + updateTextStyle(MONOSPACE)
 * - Code blocks: insertText + updateTextStyle(MONOSPACE) with newline
 * - Lists: insertText per item + createParagraphBullets at end
 * - Paragraphs: plain text with newline
 * - Mixed inline styles: correct index tracking
 * - Blockquote: italic styling
 *
 * No external mocks needed — pure function.
 */
import { MarkdownToGoogleDocsConverter } from './markdown-to-docs.converter';

describe('MarkdownToGoogleDocsConverter', () => {
  describe('convert()', () => {
    it('returns empty array for empty markdown', () => {
      expect(MarkdownToGoogleDocsConverter.convert('')).toEqual([]);
    });

    it('returns empty array for whitespace-only markdown', () => {
      expect(MarkdownToGoogleDocsConverter.convert('   \n\n  ')).toEqual([]);
    });

    it('returns empty array for null/undefined', () => {
      expect(MarkdownToGoogleDocsConverter.convert(null as any)).toEqual([]);
      expect(MarkdownToGoogleDocsConverter.convert(undefined as any)).toEqual(
        [],
      );
    });
  });

  describe('headings', () => {
    it('converts H1 heading to insertText + HEADING_1 style', () => {
      const requests = MarkdownToGoogleDocsConverter.convert('# Title');

      // Should have: insertText for heading text, insertText for newline, updateParagraphStyle
      expect(requests).toHaveLength(3);
      expect(requests[0]).toEqual({
        insertText: {
          location: { index: 1 },
          text: 'Title',
        },
      });
      expect(requests[1]).toEqual({
        insertText: {
          location: { index: 6 },
          text: '\n',
        },
      });
      expect(requests[2]).toEqual({
        updateParagraphStyle: {
          range: { startIndex: 1, endIndex: 7 }, // 'Title' = 5 chars + 1 newline = end at 6+1=7
          paragraphStyle: { namedStyleType: 'HEADING_1' },
          fields: 'namedStyleType',
        },
      });
    });

    it('converts H2-H6 headings with correct style', () => {
      const headings = [
        { md: '## H2', style: 'HEADING_2' },
        { md: '### H3', style: 'HEADING_3' },
        { md: '#### H4', style: 'HEADING_4' },
        { md: '##### H5', style: 'HEADING_5' },
        { md: '###### H6', style: 'HEADING_6' },
      ];

      for (const { md, style } of headings) {
        const requests = MarkdownToGoogleDocsConverter.convert(md);
        const headingReq = requests.find(
          (r: any) => r.updateParagraphStyle,
        ) as any;
        expect(headingReq.updateParagraphStyle.paragraphStyle.namedStyleType).toBe(
          style,
        );
      }
    });
  });

  describe('paragraphs', () => {
    it('converts plain paragraph with newline', () => {
      const requests = MarkdownToGoogleDocsConverter.convert('Hello world');

      // insertText for "Hello world" + insertText for "\n"
      expect(requests).toHaveLength(2);
      expect(requests[0]).toEqual({
        insertText: {
          location: { index: 1 },
          text: 'Hello world',
        },
      });
      expect(requests[1]).toEqual({
        insertText: {
          location: { index: 12 },
          text: '\n',
        },
      });
    });

    it('tracks index correctly across multiple paragraphs', () => {
      const requests = MarkdownToGoogleDocsConverter.convert(
        'First\n\nSecond',
      );

      // Paragraph 1: "First" + "\n" = 6 chars (index 1-6)
      // Paragraph 2: "Second" + "\n" = 7 chars (index 7-12)
      const inserts = requests.filter((r: any) => r.insertText);
      expect(inserts).toHaveLength(4); // First, \n, Second, \n
      expect(inserts[0]).toEqual({
        insertText: { location: { index: 1 }, text: 'First' },
      });
      expect(inserts[1]).toEqual({
        insertText: { location: { index: 6 }, text: '\n' },
      });
      expect(inserts[2]).toEqual({
        insertText: { location: { index: 7 }, text: 'Second' },
      });
      expect(inserts[3]).toEqual({
        insertText: { location: { index: 13 }, text: '\n' },
      });
    });
  });

  describe('bold', () => {
    it('converts bold text with BOLD style', () => {
      const requests = MarkdownToGoogleDocsConverter.convert('**bold**');

      // insertText "bold" at index 1, updateTextStyle BOLD
      const textInsert = requests.find(
        (r: any) => r.insertText?.text === 'bold',
      );
      expect(textInsert).toBeDefined();
      expect((textInsert as any).insertText.location.index).toBe(1);

      const boldStyle = requests.find((r: any) => r.updateTextStyle);
      expect(boldStyle).toBeDefined();
      expect((boldStyle as any).updateTextStyle.textStyle.bold).toBe(true);
      expect((boldStyle as any).updateTextStyle.range.startIndex).toBe(1);
      expect((boldStyle as any).updateTextStyle.range.endIndex).toBe(5);
    });
  });

  describe('italic', () => {
    it('converts italic text with ITALIC style', () => {
      const requests = MarkdownToGoogleDocsConverter.convert('*italic*');

      const italicStyle = requests.find((r: any) => r.updateTextStyle);
      expect(italicStyle).toBeDefined();
      expect((italicStyle as any).updateTextStyle.textStyle.italic).toBe(true);
    });
  });

  describe('inline code', () => {
    it('converts codespan with MONOSPACE style', () => {
      const requests = MarkdownToGoogleDocsConverter.convert('`code`');

      const codeStyle = requests.find((r: any) => r.updateTextStyle);
      expect(codeStyle).toBeDefined();
      expect(
        (codeStyle as any).updateTextStyle.textStyle.weightedFontFamily
          .fontFamily,
      ).toBe('Courier New');
    });
  });

  describe('code blocks', () => {
    it('converts fenced code block with monospace style', () => {
      const md = '```js\nconst x = 1;\n```';
      const requests = MarkdownToGoogleDocsConverter.convert(md);

      // Should have insertText for code + newline, then updateTextStyle
      const textInsert = requests.find((r: any) =>
        r.insertText?.text?.includes('const x = 1;'),
      );
      expect(textInsert).toBeDefined();

      const monospaceStyle = requests.find((r: any) => r.updateTextStyle);
      expect(monospaceStyle).toBeDefined();
      expect(
        (monospaceStyle as any).updateTextStyle.textStyle.weightedFontFamily
          .fontFamily,
      ).toBe('Courier New');
    });
  });

  describe('lists', () => {
    it('converts unordered list with bullet', () => {
      const md = '- Item 1\n- Item 2';
      const requests = MarkdownToGoogleDocsConverter.convert(md);

      // Should have insertText for each item + newline, then createParagraphBullets
      const bullets = requests.find(
        (r: any) => r.createParagraphBullets,
      );
      expect(bullets).toBeDefined();
      expect(
        (bullets as any).createParagraphBullets.bulletPreset,
      ).toBe('BULLET_DISC_CIRCLE_SQUARE');
    });

    it('tracks correct indices for list items', () => {
      const md = '- A\n- B';
      const requests = MarkdownToGoogleDocsConverter.convert(md);

      const inserts = requests.filter((r: any) => r.insertText);
      // Each list item is a single insertText with embedded newline.
      expect(inserts).toHaveLength(2);
      expect(inserts[0]).toEqual({
        insertText: { location: { index: 1 }, text: 'A\n' },
      });
      expect(inserts[1]).toEqual({
        insertText: { location: { index: 3 }, text: 'B\n' },
      });
    });
  });

  describe('mixed inline styles', () => {
    it('handles bold + italic + plain in one paragraph', () => {
      const md = 'Hello **bold** and *italic* end';
      const requests = MarkdownToGoogleDocsConverter.convert(md);

      // Should have: text "Hello ", bold "bold", text " and ", italic "italic", text " end", newline
      const inserts = requests.filter((r: any) => r.insertText);
      expect(inserts.length).toBeGreaterThan(1);

      // Verify bold segment
      const boldInsert = inserts.find(
        (r: any) => r.insertText.text === 'bold',
      );
      expect(boldInsert).toBeDefined();
      // "Hello " = 6 chars → bold starts at index 7
      expect((boldInsert as any).insertText.location.index).toBe(7);

      // Verify italic segment
      const italicInsert = inserts.find(
        (r: any) => r.insertText.text === 'italic',
      );
      expect(italicInsert).toBeDefined();
    });
  });

  describe('blockquote', () => {
    it('converts blockquote with italic styling', () => {
      const md = '> Quote text';
      const requests = MarkdownToGoogleDocsConverter.convert(md);

      // Should have insertText + newline + updateTextStyle(italic)
      const italicReq = requests.find((r: any) => r.updateTextStyle);
      expect(italicReq).toBeDefined();
      expect((italicReq as any).updateTextStyle.textStyle.italic).toBe(true);
    });
  });

  describe('complex document', () => {
    it('handles a full document with headings, paragraphs, and lists', () => {
      const md = [
        '# Report Title',
        '',
        'This is the **introduction** paragraph.',
        '',
        '## Section 1',
        '',
        '- Item A',
        '- Item B',
        '',
        '```',
        'code here',
        '```',
        '',
        '## Section 2',
        '',
        'Final paragraph.',
      ].join('\n');

      const requests = MarkdownToGoogleDocsConverter.convert(md);

      // Verify structure: should have multiple insertTexts, styles, bullets
      expect(requests.length).toBeGreaterThan(10);

      // Should have heading styles for H1 and two H2s
      const headingStyles = requests
        .filter((r: any) => r.updateParagraphStyle)
        .map((r: any) => r.updateParagraphStyle.paragraphStyle.namedStyleType);
      expect(headingStyles).toContain('HEADING_1');
      expect(headingStyles.filter((s: string) => s === 'HEADING_2')).toHaveLength(
        2,
      );

      // Should have bullets
      const bullets = requests.find(
        (r: any) => r.createParagraphBullets,
      );
      expect(bullets).toBeDefined();

      // Should have monospace code block style
      const monospace = requests.find(
        (r: any) =>
          r.updateTextStyle?.textStyle?.weightedFontFamily?.fontFamily ===
          'Courier New',
      );
      expect(monospace).toBeDefined();
    });
  });

  describe('nested inline styles (no raw markdown)', () => {
    it('does not insert raw asterisks for nested bold+italic', () => {
      const md = '**Hello _world_ foo**';
      const requests = MarkdownToGoogleDocsConverter.convert(md);

      // All inserted text should be clean — no raw markdown syntax
      const insertedTexts = requests
        .filter((r: any) => r.insertText)
        .map((r: any) => r.insertText.text);
      const allText = insertedTexts.join('');
      expect(allText).not.toContain('*');
      expect(allText).toContain('Hello');
      expect(allText).toContain('world');
      expect(allText).toContain('foo');
    });

    it('applies bold to the full nested range', () => {
      const md = '**Hello _world_ foo**';
      const requests = MarkdownToGoogleDocsConverter.convert(md);

      // Should have a bold style covering the whole range
      const boldStyles = requests.filter(
        (r: any) => r.updateTextStyle?.textStyle?.bold === true,
      );
      expect(boldStyles.length).toBeGreaterThanOrEqual(1);
    });

    it('applies italic to the nested italic portion', () => {
      const md = '**Hello _world_ foo**';
      const requests = MarkdownToGoogleDocsConverter.convert(md);

      const italicStyles = requests.filter(
        (r: any) => r.updateTextStyle?.textStyle?.italic === true,
      );
      expect(italicStyles.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('links', () => {
    it('inserts clean link text with hyperlink style', () => {
      const md = 'See [Google](https://google.com) for more';
      const requests = MarkdownToGoogleDocsConverter.convert(md);

      // Should contain clean text "Google" — not "[Google](...)"
      const insertedTexts = requests
        .filter((r: any) => r.insertText)
        .map((r: any) => r.insertText.text);
      const allText = insertedTexts.join('');
      expect(allText).toContain('See');
      expect(allText).toContain('Google');
      expect(allText).toContain('for more');
      expect(allText).not.toContain('[');
      expect(allText).not.toContain(']');
      expect(allText).not.toContain('(https://');
    });

    it('applies hyperlink style with correct URL', () => {
      const md = '[Click here](https://example.com "Title")';
      const requests = MarkdownToGoogleDocsConverter.convert(md);

      const linkStyle = requests.find(
        (r: any) => r.updateTextStyle?.textStyle?.link?.url,
      );
      expect(linkStyle).toBeDefined();
      expect((linkStyle as any).updateTextStyle.textStyle.link.url).toBe(
        'https://example.com',
      );
    });

    it('handles nested bold inside link', () => {
      const md = '[**Bold link**](https://example.com)';
      const requests = MarkdownToGoogleDocsConverter.convert(md);

      // Should have bold style for the bold text
      const boldStyles = requests.filter(
        (r: any) => r.updateTextStyle?.textStyle?.bold === true,
      );
      expect(boldStyles.length).toBeGreaterThanOrEqual(1);

      // Should have hyperlink style
      const linkStyles = requests.filter(
        (r: any) => r.updateTextStyle?.textStyle?.link?.url,
      );
      expect(linkStyles.length).toBe(1);
    });
  });

  describe('images', () => {
    it('inserts alt text as italic placeholder', () => {
      const md = '![Alt text](image.png "Image Title")';
      const requests = MarkdownToGoogleDocsConverter.convert(md);

      // Should insert "[Alt text]" as italic placeholder
      const insertedTexts = requests
        .filter((r: any) => r.insertText)
        .map((r: any) => r.insertText.text);
      const allText = insertedTexts.join('');
      expect(allText).toContain('[Alt text]');
      expect(allText).not.toContain('![');
      expect(allText).not.toContain('(image.png');
    });

    it('applies italic to the image placeholder', () => {
      const md = '![Alt text](image.png)';
      const requests = MarkdownToGoogleDocsConverter.convert(md);

      const italicStyles = requests.filter(
        (r: any) => r.updateTextStyle?.textStyle?.italic === true,
      );
      expect(italicStyles.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('hard line breaks (br)', () => {
    it('inserts newline for hard line break', () => {
      const md = 'Line 1  \nLine 2';
      const requests = MarkdownToGoogleDocsConverter.convert(md);

      // Should have inserts for "Line 1", "\n" (from br), "Line 2", "\n" (paragraph end)
      const insertedTexts = requests
        .filter((r: any) => r.insertText)
        .map((r: any) => r.insertText.text);
      expect(insertedTexts).toContain('Line 1');
      expect(insertedTexts).toContain('Line 2');
      // Should have at least 3 inserts (text, newline from br, text)
      expect(insertedTexts.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('tables', () => {
    it('converts table to tab-separated rows with bold header', () => {
      const md = '| Name | Age |\n|------|-----|\n| Alice | 30 |\n| Bob | 25 |';
      const requests = MarkdownToGoogleDocsConverter.convert(md);

      // Should have insertText for header row
      const insertedTexts = requests
        .filter((r: any) => r.insertText)
        .map((r: any) => r.insertText.text);
      expect(insertedTexts).toContain('Name\tAge\n');
      expect(insertedTexts).toContain('Alice\t30\n');
      expect(insertedTexts).toContain('Bob\t25\n');

      // Should have bold style for header row
      const boldStyles = requests.filter(
        (r: any) => r.updateTextStyle?.textStyle?.bold === true,
      );
      expect(boldStyles.length).toBeGreaterThanOrEqual(1);
    });

    it('handles table with single column', () => {
      const md = '| Fruit |\n|-------|\n| Apple |\n| Banana |';
      const requests = MarkdownToGoogleDocsConverter.convert(md);

      const insertedTexts = requests
        .filter((r: any) => r.insertText)
        .map((r: any) => r.insertText.text);
      expect(insertedTexts).toContain('Fruit\n');
      expect(insertedTexts).toContain('Apple\n');
      expect(insertedTexts).toContain('Banana\n');
    });
  });

  describe('HTML', () => {
    it('strips HTML tags and inserts plain text', () => {
      const md = '<div>Hello world</div>';
      const requests = MarkdownToGoogleDocsConverter.convert(md);

      const insertedTexts = requests
        .filter((r: any) => r.insertText)
        .map((r: any) => r.insertText.text);
      const allText = insertedTexts.join('');
      expect(allText).toContain('Hello world');
      expect(allText).not.toContain('<div>');
      expect(allText).not.toContain('</div>');
    });

    it('strips nested HTML tags', () => {
      const md = '<p><strong>Bold in HTML</strong></p>';
      const requests = MarkdownToGoogleDocsConverter.convert(md);

      const insertedTexts = requests
        .filter((r: any) => r.insertText)
        .map((r: any) => r.insertText.text);
      const allText = insertedTexts.join('');
      expect(allText).toContain('Bold in HTML');
      expect(allText).not.toContain('<');
    });
  });

  describe('horizontal rule (hr)', () => {
    it('inserts a visual separator line', () => {
      const md = '---';
      const requests = MarkdownToGoogleDocsConverter.convert(md);

      const insertedTexts = requests
        .filter((r: any) => r.insertText)
        .map((r: any) => r.insertText.text);
      const allText = insertedTexts.join('');
      expect(allText).toContain('────');
    });
  });

  describe('full document with all token types', () => {
    it('handles a comprehensive markdown document without raw syntax', () => {
      const md = [
        '# Title',
        '',
        'Hello **bold** and *italic* and [link](https://example.com).',
        '',
        '| Col1 | Col2 |',
        '|------|------|',
        '| A | B |',
        '',
        '![img](photo.png)',
        '',
        '<p>Raw HTML paragraph</p>',
        '',
        '> Quote text',
        '',
        '- Item 1',
        '- Item 2',
        '',
        '```js',
        'const x = 1;',
        '```',
      ].join('\n');

      const requests = MarkdownToGoogleDocsConverter.convert(md);

      // Verify no raw markdown syntax in any inserted text
      const insertedTexts = requests
        .filter((r: any) => r.insertText)
        .map((r: any) => r.insertText.text);
      const allText = insertedTexts.join('');
      expect(allText).not.toContain('**');
      expect(allText).not.toContain('![(');
      expect(allText).not.toContain('```');
      expect(allText).not.toContain('<p>');
      expect(allText).not.toContain('</p>');
      expect(allText).not.toContain('| Col1');
      expect(allText).not.toContain('|------');

      // Verify all content is present
      expect(allText).toContain('Title');
      expect(allText).toContain('bold');
      expect(allText).toContain('italic');
      expect(allText).toContain('link');
      expect(allText).toContain('Col1');
      expect(allText).toContain('Raw HTML paragraph');
      expect(allText).toContain('Quote text');
      expect(allText).toContain('Item 1');
      expect(allText).toContain('const x = 1;');
      expect(allText).toContain('[img]'); // Image placeholder
    });
  });
});
