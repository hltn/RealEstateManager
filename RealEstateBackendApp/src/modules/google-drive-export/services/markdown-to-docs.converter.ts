import { lexer } from 'marked';
import type {
  docs_v1 as DocsV1,
} from 'googleapis';

/**
 * MarkdownToGoogleDocsConverter — convert Markdown string to Google Docs API requests.
 *
 * Strategy:
 *   1. Parse Markdown via `marked.lexer` → token tree
 *   2. Walk tokens top-down, emit `insertText` + style requests
 *   3. Track `currentIndex` — every insertText shifts subsequent positions
 *
 * Supported: headings (H1-H6), bold, italic, monospace, inline code,
 *            ordered/unordered lists, code blocks, blockquotes, paragraphs,
 *            links (with hyperlink), images (alt text placeholder),
 *            tables (tab-separated), HTML (stripped to plain text),
 *            hard line breaks (br).
 *
 * Document structure: Google Docs starts with 1 empty paragraph (index 0).
 * First insertText at index 1 (after that empty paragraph).
 */

/** Union of Google Docs API request bodies we emit. */
export type DocRequest =
  | DocsV1.Schema$Request
  | { insertText: DocsV1.Schema$InsertTextRequest }
  | { updateParagraphStyle: DocsV1.Schema$UpdateParagraphStyleRequest }
  | { updateTextStyle: DocsV1.Schema$UpdateTextStyleRequest }
  | { createParagraphBullets: DocsV1.Schema$CreateParagraphBulletsRequest };

/** Request body for the Docs API batchUpdate call. */
export interface BatchUpdateRequest {
  requests: DocsV1.Schema$Request[];
}

// ─── Pre-built style objects (reused across calls) ───────────────────────────

const BOLD_STYLE: DocsV1.Schema$TextStyle = {
  bold: true,
};

const ITALIC_STYLE: DocsV1.Schema$TextStyle = {
  italic: true,
};

const MONOSPACE_STYLE: DocsV1.Schema$TextStyle = {
  weightedFontFamily: { fontFamily: 'Courier New' },
};

// Heading paragraph styles keyed by depth.
const HEADING_STYLES: Record<
  number,
  DocsV1.Schema$ParagraphStyle
> = {
  1: { namedStyleType: 'HEADING_1' },
  2: { namedStyleType: 'HEADING_2' },
  3: { namedStyleType: 'HEADING_3' },
  4: { namedStyleType: 'HEADING_4' },
  5: { namedStyleType: 'HEADING_5' },
  6: { namedStyleType: 'HEADING_6' },
};

// ─── HTML tag stripping regex ────────────────────────────────────────────────

const HTML_TAG_REGEX = /<[^>]+>/g;

/** Strip HTML tags from a string, returning plain text. */
function stripHtmlTags(html: string): string {
  return html.replace(HTML_TAG_REGEX, '');
}

// ─── Converter ───────────────────────────────────────────────────────────────

export class MarkdownToGoogleDocsConverter {
  /**
   * Convert a Markdown string into an ordered array of Google Docs API requests.
   *
   * @param markdown - Raw Markdown content (e.g. from MarketAnalysisHistory.content)
   * @returns Array of Docs API request objects suitable for `documents.batchUpdate`
   */
  static convert(markdown: string): DocRequest[] {
    if (!markdown || !markdown.trim()) {
      return [];
    }

    const tokens = lexer(markdown);
    const converter = new MarkdownToGoogleDocsConverter();
    return converter.processTokens(tokens);
  }

  /** Current insertion index in the document. Starts at 1 (after the initial empty paragraph). */
  private currentIndex = 1;

  /** Accumulated requests. */
  private requests: DocsV1.Schema$Request[] = [];

  /** Bullet indices collected during list processing — applied after all list items are inserted. */
  private pendingBulletIndices: Array<{
    startIndex: number;
    endIndex: number;
  }> = [];

  // ─── Token processing ────────────────────────────────────────────────────

  private processTokens(tokens: ReturnType<typeof lexer>): DocRequest[] {
    for (const token of tokens) {
      switch (token.type) {
        case 'heading':
          this.processHeading(token as { depth: number; tokens: any[] });
          break;
        case 'paragraph':
          this.processParagraph(token as { tokens: any[] });
          break;
        case 'code':
          this.processCodeBlock(token as { text: string });
          break;
        case 'list':
          this.processList(token as { items: any[]; ordered: boolean });
          break;
        case 'blockquote':
          this.processBlockquote(token as { tokens: any[] });
          break;
        case 'table':
          this.processTable(token as { header: any[]; rows: any[][] });
          break;
        case 'html':
          this.processHtml(token as { text: string });
          break;
        case 'hr':
          // Horizontal rule: insert a line of dashes as visual separator.
          this.insertTextSegment('────────────');
          this.requests.push({
            insertText: {
              location: { index: this.currentIndex },
              text: '\n',
            },
          });
          this.currentIndex += 1;
          break;
        case 'space':
          // Space tokens are blank lines between block elements — no action needed.
          break;
        default:
          break;
      }
    }

    // Flush pending bullets after all content is inserted.
    this.flushBullets();

    return this.requests;
  }

  // ─── Heading ──────────────────────────────────────────────────────────────

  private processHeading(token: { depth: number; tokens: any[] }): void {
    const depth = Math.min(Math.max(token.depth, 1), 6);
    const start = this.currentIndex;

    // Process inline tokens inside heading (handles nested bold/italic/etc.)
    for (const inlineToken of token.tokens ?? []) {
      this.processInlineToken(inlineToken);
    }

    const textEnd = this.currentIndex;

    // Insert newline after heading text.
    this.requests.push({
      insertText: {
        location: { index: this.currentIndex },
        text: '\n',
      },
    });

    this.requests.push({
      updateParagraphStyle: {
        range: {
          startIndex: start,
          endIndex: textEnd + 1, // +1 for newline
        },
        paragraphStyle: HEADING_STYLES[depth]!,
        fields: 'namedStyleType',
      },
    });

    this.currentIndex = textEnd + 1;
  }

  // ─── Paragraph (with inline styles) ──────────────────────────────────────

  private processParagraph(token: { tokens: any[] }): void {
    const start = this.currentIndex;

    for (const inlineToken of token.tokens ?? []) {
      this.processInlineToken(inlineToken);
    }

    // Paragraph ending: newline character.
    this.requests.push({
      insertText: {
        location: { index: this.currentIndex },
        text: '\n',
      },
    });

    this.currentIndex += 1;
  }

  // ─── Code block (monospace) ──────────────────────────────────────────────

  private processCodeBlock(token: { text: string }): void {
    const text = token.text;
    const start = this.currentIndex;
    const end = start + text.length;

    this.requests.push({
      insertText: {
        location: { index: start },
        text: text + '\n',
      },
    });

    // Apply monospace style to the code content.
    this.requests.push({
      updateTextStyle: {
        range: { startIndex: start, endIndex: end },
        textStyle: MONOSPACE_STYLE,
        fields: 'weightedFontFamily',
      },
    });

    this.currentIndex = end + 1;
  }

  // ─── List (bullets/numbered) ─────────────────────────────────────────────

  private processList(token: { items: any[]; ordered: boolean }): void {
    for (const item of token.items ?? []) {
      const text = this.extractTextFromTokens(item.tokens);
      const start = this.currentIndex;

      this.requests.push({
        insertText: {
          location: { index: start },
          text: text + '\n',
        },
      });

      const end = start + text.length + 1;
      this.pendingBulletIndices.push({
        startIndex: start,
        endIndex: end,
      });

      this.currentIndex = end;
    }
  }

  /** Create paragraph bullets for all pending list item ranges. */
  private flushBullets(): void {
    if (this.pendingBulletIndices.length === 0) return;

    this.requests.push({
      createParagraphBullets: {
        range: {
          startIndex: this.pendingBulletIndices[0]!.startIndex,
          endIndex:
            this.pendingBulletIndices[this.pendingBulletIndices.length - 1]!
              .endIndex,
        },
        bulletPreset: 'BULLET_DISC_CIRCLE_SQUARE',
      },
    });

    this.pendingBulletIndices = [];
  }

  // ─── Blockquote ──────────────────────────────────────────────────────────

  private processBlockquote(token: { tokens: any[] }): void {
    const start = this.currentIndex;

    for (const childToken of token.tokens ?? []) {
      if (childToken.type === 'paragraph') {
        for (const inlineToken of childToken.tokens ?? []) {
          this.processInlineToken(inlineToken);
        }
      }
    }

    // Blockquote newline.
    this.requests.push({
      insertText: {
        location: { index: this.currentIndex },
        text: '\n',
      },
    });

    // Render blockquote text in italic to visually distinguish it.
    if (this.currentIndex > start) {
      this.requests.push({
        updateTextStyle: {
          range: { startIndex: start, endIndex: this.currentIndex },
          textStyle: ITALIC_STYLE,
          fields: 'italic',
        },
      });
    }

    this.currentIndex += 1;
  }

  // ─── Table ───────────────────────────────────────────────────────────────

  private processTable(token: { header: any[]; rows: any[][] }): void {
    const { header, rows } = token;

    // Insert header row as tab-separated text (bold).
    const headerText = header.map((cell: any) => cell.text).join('\t');
    if (headerText.length > 0) {
      const headerStart = this.currentIndex;
      this.requests.push({
        insertText: {
          location: { index: headerStart },
          text: headerText + '\n',
        },
      });
      this.requests.push({
        updateTextStyle: {
          range: {
            startIndex: headerStart,
            endIndex: headerStart + headerText.length,
          },
          textStyle: BOLD_STYLE,
          fields: 'bold',
        },
      });
      this.currentIndex = headerStart + headerText.length + 1;
    }

    // Insert data rows as tab-separated text.
    for (const row of rows ?? []) {
      const rowText = row.map((cell: any) => cell.text).join('\t');
      if (rowText.length > 0) {
        this.requests.push({
          insertText: {
            location: { index: this.currentIndex },
            text: rowText + '\n',
          },
        });
        this.currentIndex += rowText.length + 1;
      }
    }
  }

  // ─── HTML ────────────────────────────────────────────────────────────────

  private processHtml(token: { text: string }): void {
    const plainText = stripHtmlTags(token.text);
    if (plainText.length > 0) {
      this.insertTextSegment(plainText);
      // Append newline for the paragraph boundary.
      this.requests.push({
        insertText: {
          location: { index: this.currentIndex },
          text: '\n',
        },
      });
      this.currentIndex += 1;
    }
  }

  // ─── Inline tokens ───────────────────────────────────────────────────────

  private processInlineToken(token: any): void {
    switch (token.type) {
      case 'text':
        this.insertTextSegment(token.text);
        break;
      case 'strong':
        this.processStyledInlineTokens(token, BOLD_STYLE, 'bold');
        break;
      case 'em':
        this.processStyledInlineTokens(token, ITALIC_STYLE, 'italic');
        break;
      case 'codespan':
        this.insertStyledSegment(token.text, MONOSPACE_STYLE, 'weightedFontFamily');
        break;
      case 'link':
        this.processLinkToken(token);
        break;
      case 'image':
        this.processImageToken(token);
        break;
      case 'br':
        this.requests.push({
          insertText: {
            location: { index: this.currentIndex },
            text: '\n',
          },
        });
        this.currentIndex += 1;
        break;
      default:
        // Fallback: extract clean text from token.
        if (token.tokens) {
          // Token has children — process them recursively for clean text.
          for (const child of token.tokens) {
            this.processInlineToken(child);
          }
        } else if (token.text) {
          this.insertTextSegment(token.text);
        }
        break;
    }
  }

  /**
   * Process a styled inline token (strong, em, etc.) by recursively handling
   * its child tokens, then applying the style to the entire range.
   *
   * This avoids inserting raw markdown syntax (e.g., `*asterisks*`) when
   * there are nested inline tokens inside the styled span.
   */
  private processStyledInlineTokens(
    token: any,
    style: DocsV1.Schema$TextStyle,
    fields: string,
  ): void {
    const start = this.currentIndex;

    // Process nested tokens (handles cases like **bold *italic* text**)
    if (token.tokens?.length) {
      for (const child of token.tokens) {
        this.processInlineToken(child);
      }
    } else {
      // No nested tokens — use the text directly.
      this.insertTextSegment(token.text);
    }

    // Apply style to the entire range.
    if (this.currentIndex > start) {
      this.requests.push({
        updateTextStyle: {
          range: { startIndex: start, endIndex: this.currentIndex },
          textStyle: style,
          fields,
        },
      });
    }
  }

  /**
   * Process a link token: insert the link text, then apply hyperlink style.
   */
  private processLinkToken(token: any): void {
    const start = this.currentIndex;

    // Process the link's child tokens for clean text extraction.
    if (token.tokens?.length) {
      for (const child of token.tokens) {
        this.processInlineToken(child);
      }
    } else {
      this.insertTextSegment(token.text);
    }

    // Apply hyperlink style to the link text range.
    if (this.currentIndex > start) {
      this.requests.push({
        updateTextStyle: {
          range: { startIndex: start, endIndex: this.currentIndex },
          textStyle: { link: { url: token.href ?? '' } },
          fields: 'link',
        },
      });
    }
  }

  /**
   * Process an image token: insert alt text as placeholder, styled in italic.
   */
  private processImageToken(token: any): void {
    const altText = token.text || '';
    if (altText.length > 0) {
      this.insertStyledSegment(
        `[${altText}]`,
        ITALIC_STYLE,
        'italic',
      );
    }
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  private insertTextSegment(text: string): void {
    this.requests.push({
      insertText: {
        location: { index: this.currentIndex },
        text,
      },
    });
    this.currentIndex += text.length;
  }

  private insertStyledSegment(
    text: string,
    style: DocsV1.Schema$TextStyle,
    fields: string,
  ): void {
    const start = this.currentIndex;

    this.requests.push({
      insertText: {
        location: { index: start },
        text,
      },
    });

    this.requests.push({
      updateTextStyle: {
        range: { startIndex: start, endIndex: start + text.length },
        textStyle: style,
        fields,
      },
    });

    this.currentIndex += text.length;
  }

  /**
   * Extract plain text from a token's inline children.
   * Recursively flattens nested tokens (e.g. strong > text inside a paragraph).
   */
  private extractTextFromTokens(tokens: any[]): string {
    if (!tokens) return '';

    return tokens
      .map((t: any) => {
        if (t.text !== undefined) return t.text;
        if (t.tokens) return this.extractTextFromTokens(t.tokens);
        return '';
      })
      .join('');
  }
}
