import remark from 'remark';
import remarkGfm from 'remark-gfm';
import visit from 'unist-util-visit';
import toString from 'mdast-util-to-string';

// ─── Listing / price / phone patterns (raw text level) ───
const PRICE_PATTERN = /^\d+\s*t.*-\s*\d+m2$/i;
const PHONE_PATTERN = /^\d{4,}\\?\*{2,}$/;
const DATE_FILLER = /^h.m nay$/i;
const ADDRESS_FILLER = /^.{2,30},\s*tp\.?\s*.{2,10}$/i;

function normalizeText(text: string) {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'd')
    .trim();
}

// ─── Boilerplate phrases (normalized, diacritics-stripped) ───
const boilerplateRegexes = [
  /^(?:xem them|tin lien quan|bai viet lien quan|cung chuyen muc|co the ban quan tam|tin khac)/,
  /^quang cao$/,
  /^advertisement$/,
  /^dang ky nhan ban tin/,
  /^chap nhan cookie/,
  /^cookie policy/,
  /^chinh sach bao mat/,
  /^ban quyen thuoc ve/,
  /©\s*\d{4}/,
  /^all rights reserved/,
  /^theo doi chung toi/,
  /^follow us on/,
  /^chia se bai viet/,
  /^share this article/,
  /^tro lai dau trang$/,
  /^de biet them chi tiet/,
  /^vui long lien he/,
  /^nhan vao day/,
  /^click here/,
  /^tu khoa:/,
  /^tags:/,
  /^chu de:/,
  /^bai viet cung chuyen muc/,
  /^doc nhieu$/,
  /^dong bo lo$/,
  /^dang nhap de luu tin$/,
  /^dang nhap$/,
  /^dang ky$/,
  /^bao cao vi pham$/,
  /^bao cao$/,
  /^link bai goc/,
  /^moi y kien dong gop/,
  /^duong day nong/,
  /^thong tin form$/,
  /^luu lai bat dong san/,
  /^\d+ nam nay$/,
  /^ho va ten:/,
  /^so dien thoai:/,
  /^email:/,
  /^noi dung muon bao cao:/,
  /^theo congnghiepnongthon$/,
  /^theo\s+\w+$/,
  /^dong bo lo$/,
];

// ─── URL patterns that identify ad / tracking links ───
const adUrlPatterns = [
  /analytics-ads/,
  /\/ads-header\//,
  /\/ctag\?/,
  /doubleclick\.net/,
  /googlesyndication/,
  /facebook\.com\/sharer/,
  /sub_confirmation=/,
  /news\.google\.com\/publications/,
];

// ─── Video player / UI chrome noise (raw text) ───
const uiNoisePatterns = [
  /video player is loading/i,
  /^play\s*video$/i,
  /^playskip\s*backward/i,
  /^skip\s*forward$/i,
  /^unmute$/i,
  /^current\s*time/i,
  /^duration/i,
  /^remaining\s*time/i,
  /^playback\s*rate$/i,
  /^stream\s*type/i,
  /^seek to live/i,
  /^loaded:\s*\d+%/i,
  /^chapters$/i,
  /^descriptions$/i,
  /^descriptions off/i,
  /^subtitles$/i,
  /^subtitles settings/i,
  /^subtitles off/i,
  /^audio track$/i,
  /^picture-in-picture/i,
  /^fullscreen$/i,
  /^beginning of dialog window/i,
  /^end of dialog window/i,
  /^close modal dialog/i,
  /^this is a modal window/i,
  /^textcolor/i,
  /^font size\d+%/i,
  /^caption area background/i,
  /^text background/i,
  /^resetdone$/i,
  /^your browser does not support/i,
  /^escape will cancel/i,
  /opacity.*semi-transparent/i,
  /^1x$/,
  /^\d+x$/,
  /^loaded:\s*\d/i,
  /^[-:]-?$/,
];

// ─── Form CTA blocks ───
const formCtaPatterns = [
  /^so dien thoai\s*\*/,
  /^dien nhanh \d+ buoc/,
  /^de lai thong tin de duoc ho tro/,
  /tai ngay$/,
  /xem gia ngay$/,
  /tai ban do quy hoach/,
  /^xem va tai bang gia dat/,
];

// ─── Footer / site description ───
const footerPatterns = [
  /cafeland.*la network/i,
  /^cap nhat.*thuc trang thi truong/,
  /cung cap cho.*doc gia/,
  /^dang ky kenh\s*youtube/i,
  /^chat voi bo phan ho tro/i,
];

function isAdUrl(url: string): boolean {
  return adUrlPatterns.some((r) => r.test(url));
}

function isUiNoise(text: string): boolean {
  const t = text.trim();
  return uiNoisePatterns.some((r) => r.test(t));
}

function isFormCta(normalizedText: string): boolean {
  return formCtaPatterns.some((r) => r.test(normalizedText));
}

function isFooter(normalizedText: string): boolean {
  return footerPatterns.some((r) => r.test(normalizedText));
}

function isBoilerplate(normalizedText: string): boolean {
  return boilerplateRegexes.some((r) => r.test(normalizedText));
}

/** True if a node is a single-character "noise" paragraph like ?, !, x, <>, ??, *, /, A */
function isNoiseParagraph(text: string): boolean {
  const t = text.trim();
  if (t.length === 0) return true;
  // Single chars or tiny noise
  if (/^[-?!x<>A*/\u00A0]{1,4}$/.test(t)) return true;
  if (/^\?{2,3}$/.test(t)) return true;
  if (/^<!--.*-->$/.test(t)) return true;
  // Lines that are just asterisks/bullets separated by newlines
  if (/^[*\s]+$/.test(t)) return true;
  // <> as text (remark may preserve this)
  if (t === '<>' || t === '< >') return true;
  return false;
}

/** True if text matches a real-estate listing snippet (price line, phone, address, "Hôm nay") */
function isListingSnippet(text: string): boolean {
  const t = text.trim();
  if (t.length > 80) return false; // Listing snippets are short
  return (
    PRICE_PATTERN.test(t) ||
    PHONE_PATTERN.test(t) ||
    DATE_FILLER.test(t) ||
    ADDRESS_FILLER.test(t)
  );
}

/** True if paragraph is an icon-link navigation block (e.g. category icons in footer) */
function isIconLinkNavigation(node: any): boolean {
  if (node.type !== 'paragraph') return false;
  // Pattern: [![icon alt](icon-url) text](page-url)
  // This manifests as a link containing an image child with an SVG icon
  let hasIconImage = false;
  let hasNavLink = false;
  visit(node, 'link', (lNode: any) => {
    if (!lNode.url) return;
    // Check if link target is a cafeland category/section page
    if (
      /cafeland\.vn\/(du-an|chu-de-nong|nha-dat-ban|bat-dong-san)/.test(
        lNode.url,
      ) ||
      /map\.cafeland\.vn/.test(lNode.url) ||
      /nhadat\.cafeland\.vn\/nha-dat-ban/.test(lNode.url)
    ) {
      hasNavLink = true;
    }
    // Check if it contains an icon image (SVG or small icon)
    visit(lNode, 'image', (imgNode: any) => {
      if (
        imgNode.url &&
        /\.(svg|png)/.test(imgNode.url) &&
        /icon|static\/css\/images/.test(imgNode.url)
      ) {
        hasIconImage = true;
      }
    });
  });
  return hasIconImage && hasNavLink;
}

/** True if paragraph is just an image-link to another cafeland.vn article (sidebar thumbnail) */
function isSidebarArticleThumb(node: any): boolean {
  if (node.type !== 'paragraph') return false;
  const children = (node.children || []).filter(
    (c: any) => !(c.type === 'text' && c.value.trim() === ''),
  );
  // Pattern: a single link wrapping an image, pointing to another cafeland article
  if (children.length !== 1 || children[0].type !== 'link') return false;
  const link = children[0];
  if (
    !link.url ||
    !/(cafeland\.vn\/tin-tuc|cafeland\.vn\/phan-tich)/.test(link.url)
  )
    return false;
  // It should contain just an image
  const linkChildren = (link.children || []).filter(
    (c: any) => !(c.type === 'text' && c.value.trim() === ''),
  );
  return linkChildren.length === 1 && linkChildren[0].type === 'image';
}

/** True if paragraph is a nhadat listing link (image + link to nhadat.cafeland.vn) */
function isNhadatListingParagraph(node: any): boolean {
  if (node.type !== 'paragraph') return false;
  let hasNhadatLink = false;
  visit(node, 'link', (lNode: any) => {
    if (lNode.url && /nhadat\.cafeland\.vn/.test(lNode.url)) {
      hasNhadatLink = true;
    }
  });
  const nodeText = toString(node).trim();
  return hasNhadatLink && nodeText.length < 400;
}

/**
 * Check if a link node points to an ad/tracking URL.
 */
function linkIsAd(node: any): boolean {
  if (node.type === 'link' && node.url) {
    return isAdUrl(node.url);
  }
  return false;
}

/**
 * Check if an image node is a tracking pixel or ad icon.
 */
function imageIsJunk(node: any): boolean {
  if (node.type !== 'image') return false;
  const alt = (node.alt || '').toLowerCase().trim();
  // tracking pixels
  if (['px', 'tracking', '1x1', ''].includes(alt)) return true;
  // ad icons (location markers, support icons)
  if (node.url && /\/adsLib\/icon\//.test(node.url)) return true;
  // tiny UI icons from cafeland static
  if (node.url && /icon-support\.png/.test(node.url)) return true;
  return false;
}

/**
 * Check if a paragraph consists entirely of links to ad URLs.
 */
function paragraphIsAdBlock(node: any): boolean {
  if (node.type !== 'paragraph') return false;
  const children = node.children || [];
  if (children.length === 0) return false;

  // Check if every non-text (or whitespace-only text) child is an ad link or ad image
  const meaningful = children.filter(
    (c: any) => !(c.type === 'text' && c.value.trim() === ''),
  );
  if (meaningful.length === 0) return false;

  return meaningful.every((c: any) => {
    if (c.type === 'link') return isAdUrl(c.url || '');
    if (c.type === 'image') return imageIsJunk(c);
    return false;
  });
}

/**
 * Detect a "related articles" listing block:
 * a heading like "Mua bán nhà đất tại Ngọc Hồi" followed by
 * paragraphs containing links to nhadat.cafeland.vn listings.
 */
function isListingSectionHeading(node: any): boolean {
  if (node.type !== 'heading') return false;
  const text = normalizeText(toString(node));
  return (
    /^mua ban nha dat/.test(text) ||
    /^bat dong san nghi duong/.test(text) ||
    /^khu cong nghiep/.test(text) ||
    /^khu do thi/.test(text) ||
    /^nha pho.*biet thu/.test(text) ||
    /^dat nen du an/.test(text) ||
    /^can ho chung cu/.test(text) ||
    /^loai hinh khac/.test(text)
  );
}

/**
 * Check if a paragraph contains listing-style links (nhadat.cafeland.vn/ban-*)
 */
function isListingParagraph(node: any): boolean {
  if (node.type !== 'paragraph') return false;
  let hasListingLink = false;
  visit(node, 'link', (lNode: any) => {
    if (lNode.url && /nhadat\.cafeland\.vn\/ban-/.test(lNode.url)) {
      hasListingLink = true;
    }
  });
  return hasListingLink;
}

export function cleanMarkdownContent(markdown: string): string {
  if (!markdown) return '';

  // ─── Phase 1: Pre-clean raw text patterns ───
  // Remove video player text blocks that appear as giant merged lines
  let cleaned = markdown;

  // Remove lines that are pure video-player UI (e.g. "TextColorWhiteBlack...")
  cleaned = cleaned.replace(
    /TextColor\w+(?:Opacity\w+)*(?:Text Background\w+)*(?:Caption Area Background\w+)*/g,
    '',
  );
  cleaned = cleaned.replace(
    /Font Size\d+%\d+%\d+%\d+%\d+%Text Edge Style\w+Font Family[\w\s-]+/g,
    '',
  );

  // ─── Phase 2: AST-based cleaning ───
  const file = remark()
    .use(remarkGfm)
    .use(() => (tree) => {
      const nodesToRemove = new Set<any>();
      let inRelatedSection = false;

      // First pass: identify junk nodes
      visit(tree, (node: any, index: number | undefined, parent: any) => {
        if (!parent) return;

        const nodeText = toString(node).trim();
        const normalizedNodeText = normalizeText(nodeText);

        // ── 1. Remove ad links (tracking/analytics URLs) ──
        if (node.type === 'link' && linkIsAd(node)) {
          nodesToRemove.add(node);
          return;
        }

        // ── 2. Remove junk images (tracking pixels, ad icons) ──
        if (imageIsJunk(node)) {
          nodesToRemove.add(node);
          return;
        }

        // ── 3. Remove entire paragraphs that are ad blocks ──
        if (paragraphIsAdBlock(node)) {
          nodesToRemove.add(node);
          return;
        }

        // ── 4. Remove empty links ──
        if (node.type === 'link' && !nodeText) {
          nodesToRemove.add(node);
          return;
        }

        // ── 5. Noise paragraphs (?, !, x, <>, ??, *) ──
        if (node.type === 'paragraph' && isNoiseParagraph(nodeText)) {
          nodesToRemove.add(node);
          return;
        }

        // ── 5b. Listing snippet paragraphs (price, phone, address, "Hôm nay") ──
        if (node.type === 'paragraph' && isListingSnippet(nodeText)) {
          nodesToRemove.add(node);
          return;
        }

        // ── 5c. Icon-link navigation (footer category grid) ──
        if (isIconLinkNavigation(node)) {
          nodesToRemove.add(node);
          return;
        }

        // ── 5d. Sidebar article thumbnails (image-only links to other articles) ──
        if (isSidebarArticleThumb(node)) {
          nodesToRemove.add(node);
          return;
        }

        // 🗑️ 5e. Nhadat listing paragraphs 🗑️
        if (isNhadatListingParagraph(node)) {
          nodesToRemove.add(node);

          // Cascade delete short text sibling paragraphs that follow
          if (index !== undefined && parent && parent.children) {
            let i = index + 1;
            while (i < parent.children.length) {
              const nextNode = parent.children[i];
              if (nextNode.type !== 'paragraph') break;
              if (nodesToRemove.has(nextNode)) {
                i++;
                continue;
              }

              // Check if it's another nhadat link or short text
              let hasLinks = false;
              let hasNhadatLink = false;
              visit(nextNode, 'link', (lNode: any) => {
                hasLinks = true;
                if (lNode.url && /nhadat\.cafeland\.vn/.test(lNode.url)) {
                  hasNhadatLink = true;
                }
              });

              const nextText = toString(nextNode).trim();

              if (hasNhadatLink && nextText.length < 400) {
                nodesToRemove.add(nextNode);
                i++;
                continue;
              }

              if (!hasLinks && nextText.length < 80) {
                // Short plain text like "Gia Bình, Bắc Ninh"
                nodesToRemove.add(nextNode);
                i++;
                continue;
              }

              break;
            }
          }
          return;
        }

        // ── 5f. Promotional >> links ──
        if (node.type === 'paragraph') {
          const children = (node.children || []).filter(
            (c: any) => !(c.type === 'text' && c.value.trim() === ''),
          );
          if (children.length === 1 && children[0].type === 'link') {
            const lt = toString(children[0]).trim();
            if (lt.startsWith('>>') || lt.startsWith('» ')) {
              nodesToRemove.add(node);
              return;
            }
          }
        }

        // ── 6. UI noise paragraphs (video player controls, modal text) ──
        if (
          (node.type === 'paragraph' || node.type === 'heading') &&
          isUiNoise(nodeText)
        ) {
          nodesToRemove.add(node);
          return;
        }

        // ── 7. Boilerplate headings and paragraphs ──
        if (node.type === 'heading' || node.type === 'paragraph') {
          if (isBoilerplate(normalizedNodeText)) {
            nodesToRemove.add(node);

            // Also remove the list right after "related articles" headers
            if (
              /(xem them|tin lien quan|bai viet lien quan|cung chuyen muc|co the ban quan tam|tin khac)/.test(
                normalizedNodeText,
              )
            ) {
              if (index !== undefined && index + 1 < parent.children.length) {
                const nextNode = parent.children[index + 1];
                if (nextNode && nextNode.type === 'list') {
                  nodesToRemove.add(nextNode);
                }
              }
            }
            return;
          }
        }

        // ── 8. Form CTA blocks ──
        if (
          (node.type === 'paragraph' || node.type === 'heading') &&
          isFormCta(normalizedNodeText)
        ) {
          nodesToRemove.add(node);
          return;
        }

        // ── 9. Footer / site description blocks ──
        if (
          (node.type === 'paragraph' || node.type === 'heading') &&
          isFooter(normalizedNodeText)
        ) {
          nodesToRemove.add(node);
          return;
        }

        // ── 10. ADVERTISEMENT links and nhadat help/login links ──
        if (node.type === 'paragraph') {
          let hasAdvert = false;
          visit(node, 'link', (lNode: any) => {
            const lt = toString(lNode).trim().toLowerCase();
            if (lt === 'advertisement' || lt === 'sponsored' || lt === 'save') {
              hasAdvert = true;
            }
            // Login/register links
            if (
              lNode.url &&
              /nhadat\.cafeland\.vn\/(dang-nhap|dang-ky|ho-tro)/.test(lNode.url)
            ) {
              hasAdvert = true;
            }
            if (lt === 'dang nhap' || lt === 'dang ky') {
              hasAdvert = true;
            }
            if (lNode.title && lNode.title.toLowerCase() === 'sponsored') {
              hasAdvert = true;
            }
          });
          if (hasAdvert) {
            nodesToRemove.add(node);
            return;
          }
        }

        // ── 11. Social sharing link paragraphs ──
        if (node.type === 'paragraph') {
          const text = normalizedNodeText;
          if (
            /^(chia se|facebook|luu tin|bao cao)$/.test(text) ||
            /^chia se\s*$/.test(text)
          ) {
            nodesToRemove.add(node);
            return;
          }
        }

        // ── 11b. Form field label paragraphs (bold labels for report forms) ──
        if (node.type === 'paragraph') {
          if (isBoilerplate(normalizedNodeText)) {
            nodesToRemove.add(node);
            return;
          }
        }

        // ── 11c. Save icon images ──
        if (node.type === 'paragraph') {
          const children = (node.children || []).filter(
            (c: any) => !(c.type === 'text' && c.value.trim() === ''),
          );
          if (
            children.length === 1 &&
            children[0].type === 'image' &&
            children[0].url &&
            /SAVE\.svg/i.test(children[0].url)
          ) {
            nodesToRemove.add(node);
            return;
          }
        }

        // ── 11d. Related article link+description blocks from cafeland ──
        if (node.type === 'paragraph') {
          const children = (node.children || []).filter(
            (c: any) => !(c.type === 'text' && c.value.trim() === ''),
          );
          // If entire paragraph is a single link to another cafeland article
          if (children.length === 1 && children[0].type === 'link') {
            const linkUrl = children[0].url || '';
            if (
              /cafeland\.vn\/(tin-tuc|phan-tich|du-an|quy-hoach)/.test(
                linkUrl,
              ) &&
              nodeText.length < 300
            ) {
              nodesToRemove.add(node);

              // Also check the next sibling to see if it's a summary paragraph
              if (index !== undefined && index + 1 < parent.children.length) {
                const nextNode = parent.children[index + 1];
                if (
                  nextNode &&
                  nextNode.type === 'paragraph' &&
                  !nodesToRemove.has(nextNode)
                ) {
                  // A summary is usually text-only, no links, and relatively short
                  let hasLinks = false;
                  visit(nextNode, 'link', () => {
                    hasLinks = true;
                  });
                  const nextText = toString(nextNode).trim();

                  // Summaries are usually plain text paragraphs under 400 chars
                  if (!hasLinks && nextText.length < 400) {
                    nodesToRemove.add(nextNode);
                  }
                }
              }
              return;
            }
          }
        }

        // ── 12. Listing section detection ──
        if (isListingSectionHeading(node)) {
          inRelatedSection = true;
          nodesToRemove.add(node);
          return;
        }

        // While in a listing section, remove listing paragraphs
        if (inRelatedSection && node.type === 'paragraph') {
          if (isListingParagraph(node)) {
            nodesToRemove.add(node);
            return;
          }
          // Stop the section when we hit a long text paragraph (probably article content again)
          if (nodeText.length > 80 && !isListingParagraph(node)) {
            inRelatedSection = false;
          }
        }

        // ── 13. Link-only lists (e.g. footer category grids, "Đọc Nhiều" sidebars) ──
        if (node.type === 'list' && !nodesToRemove.has(node)) {
          let allLinks = true;
          for (const child of node.children) {
            if (child.type === 'listItem') {
              const itemText = toString(child);
              let linkTextLen = 0;
              visit(child, 'link', (lNode: any) => {
                linkTextLen += toString(lNode).length;
              });
              if (linkTextLen < itemText.length * 0.7) {
                allLinks = false;
                break;
              }
            }
          }
          if (allLinks && node.children.length >= 2) {
            nodesToRemove.add(node);
          }
        }

        // ── 14. Headings that are just links (navigation-style) ──
        if (node.type === 'heading') {
          const children = node.children || [];
          const meaningful = children.filter(
            (c: any) => !(c.type === 'text' && c.value.trim() === ''),
          );
          if (meaningful.length > 0) {
            const allLinks = meaningful.every(
              (c: any) => c.type === 'link' || c.type === 'strong',
            );
            if (allLinks) {
              // Check if the heading link points to a cafeland.vn article/section
              let hasCafelandNavLink = false;
              visit(node, 'link', (lNode: any) => {
                if (
                  lNode.url &&
                  /cafeland\.vn\/(tin-tuc|phan-tich|chu-de-nong|du-an|nha-dat)/.test(
                    lNode.url,
                  )
                ) {
                  hasCafelandNavLink = true;
                }
              });
              if (hasCafelandNavLink && nodeText.length < 200) {
                nodesToRemove.add(node);
              }
            }
          }

          // Also catch "## Đọc Nhiều"-style headings inside list items
          if (/^doc nhieu$/.test(normalizedNodeText)) {
            nodesToRemove.add(node);
          }
        }
      });

      // ── Second pass: remove nodes marked for deletion ──
      // We must do this in reverse to avoid index shifting issues
      visit(tree, (node: any) => {
        if (node.children) {
          for (let i = node.children.length - 1; i >= 0; i--) {
            if (nodesToRemove.has(node.children[i])) {
              node.children.splice(i, 1);
            }
          }
        }
      });
    })
    .processSync(cleaned);

  let result = String(file);

  // ─── Phase 3: Post-clean ───
  // Remove HTML comments that remark preserved
  result = result.replace(/<!--[\s\S]*?-->/g, '');
  // Remove lines that are just *, /, A, Â, or other single-char noise (ASCII + Unicode lookalikes)
  result = result.replace(/^[-*/A\u00C2]{1,2}$/gm, '');
  // Remove <> and ‹› (Unicode single angle quotation marks U+2039 U+203A) on own line
  result = result.replace(/^\s*[<\u2039][>\u203A]\s*$/gm, '');
  // Remove ?? ??? and emoji equivalents (U+1F4CC, U+1F5FA) on own line
  result = result.replace(
    /^\s*(?:[?\u{1F4CC}\u{1F5FA}]\uFE0F?){1,3}\s*$/gmu,
    '',
  );
  // Remove stray author/source attribution like "*theo Congnghiepnongthon*"
  result = result.replace(/^\*theo\s+\w+\*$/gm, '');
  // Remove "Đồng bộ lỡ" and similar Vietnamese boilerplate that survived
  result = result.replace(/^.{0,5}ng b.{1,3} l.{1,3}$/gm, '');
  // Remove stray short author names (standalone like "Tâm An")
  // Only if they're on their own line and very short
  result = result.replace(
    /^[A-Z\u00C0-\u024F][a-z\u00C0-\u024F]+\s[A-Z\u00C0-\u024F][a-z\u00C0-\u024F]+$/gm,
    (match) => {
      return match.length < 30 ? '' : match;
    },
  );
  // Remove excessive blank lines
  result = result.replace(/\n{3,}/g, '\n\n').trim();

  return result;
}
