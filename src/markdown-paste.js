import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';

const converter = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-' });
converter.use(gfm);
converter.addRule('styledSpan', {
  filter: node => node.nodeName === 'SPAN' && Boolean(node.getAttribute('style')),
  replacement(content, node) {
    if (!content) return '';
    const { fontWeight, fontStyle, textDecorationLine } = node.style;
    if (fontWeight === 'bold' || Number(fontWeight) >= 600) content = '**' + content + '**';
    if (fontStyle === 'italic' || fontStyle === 'oblique') content = '_' + content + '_';
    if (textDecorationLine.includes('line-through')) content = '~~' + content + '~~';
    return content;
  },
});

export function clipboardMarkdown(clipboard) {
  const markdown = clipboard.getData('text/markdown');
  if (markdown) return markdown;
  const html = clipboard.getData('text/html');
  if (!html) return null;

  const plain = clipboard.getData('text/plain');
  const template = document.createElement('template');
  template.innerHTML = html;
  const fragment = template.content;
  fragment.querySelectorAll('script, style, iframe, object, embed, template').forEach(node => node.remove());
  const richElements = 'h1, h2, h3, h4, h5, h6, b, strong, i, em, s, del, strike, ul, ol, pre, code, blockquote, table, a[href], img, hr';
  const styled = [...fragment.querySelectorAll('span[style]')].some(({ style }) =>
    style.fontWeight === 'bold' || Number(style.fontWeight) >= 600
    || /^(italic|oblique)$/.test(style.fontStyle) || style.textDecorationLine.includes('line-through'));
  if (plain && !styled && !fragment.querySelector(richElements)) return null;

  const sourceSyntax = /(?:^|\n)[ \t]*(?:#{1,6}\s|\x60{3}|~~~|>\s|[-+*]\s|\d+\.\s)|(?:\*\*|__|~~)\S|!?\[[^\]]+\]\(/;
  if (sourceSyntax.test(plain) && fragment.querySelector('pre, code')
    && !fragment.querySelector('h1, h2, h3, h4, h5, h6, ul, ol, blockquote, table, a[href], img')
    && fragment.textContent.trim() === plain.trim()) {
    return plain;
  }
  for (const block of fragment.querySelectorAll('pre')) {
    const code = block.querySelector('code');
    if (code && block.textContent.trim() === code.textContent.trim()) block.replaceChildren(code);
  }
  for (const table of fragment.querySelectorAll('table')) {
    const firstRow = table.rows[0];
    if (!firstRow?.cells.length) {
      table.remove();
    } else if (!firstRow.closest('thead')) {
      table.createTHead().append(firstRow);
    }
  }

  return converter.turndown(fragment) || null;
}
