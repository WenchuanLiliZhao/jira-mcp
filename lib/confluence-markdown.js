/**
 * @file lib/confluence-markdown.js
 * Convert Markdown to Confluence storage format.
 *
 * Fenced code blocks become <ac:structured-macro ac:name="code"> macros so
 * that Confluence renders them with syntax highlighting instead of garbling
 * them as raw HTML.  Everything else is converted via `marked` (GitHub-
 * flavoured Markdown → HTML), which Confluence storage format accepts as-is.
 */

import { marked } from 'marked';

/**
 * Escape text for use inside a CDATA section.
 * The sequence `]]>` closes a CDATA block early, so we split around it.
 * @param {string} text
 * @returns {string}
 */
function escapeCdata(text) {
  return text.replace(/\]\]>/g, ']]]]><![CDATA[>');
}

/**
 * Render a single fenced code block as a Confluence `code` macro.
 * @param {string} lang   Language identifier (e.g. "javascript", "python").
 * @param {string} code   Raw code content.
 * @returns {string}      Confluence storage XML snippet.
 */
function codeBlockMacro(lang, code) {
  const safeCode = escapeCdata(code.replace(/\r\n/g, '\n').trimEnd());
  const langParam = lang && lang !== 'plaintext'
    ? `<ac:parameter ac:name="language">${lang}</ac:parameter>\n  `
    : '';
  return (
    `<ac:structured-macro ac:name="code" ac:schema-version="1">\n` +
    `  ${langParam}<ac:plain-text-body><![CDATA[${safeCode}]]></ac:plain-text-body>\n` +
    `</ac:structured-macro>`
  );
}

/**
 * Convert a Markdown string to Confluence storage format HTML.
 *
 * Fenced code blocks (``` … ```) are extracted first and replaced with
 * Confluence `<ac:structured-macro ac:name="code">` elements.  The
 * remaining Markdown is processed by `marked` with GFM enabled.
 *
 * @param {string} markdown  Input Markdown text.
 * @returns {string}         Confluence storage format string ready to POST.
 */
export function mdToConfluenceStorage(markdown) {
  const parts = [];
  const codeBlockRe = /^```(\w*)\n([\s\S]*?)```$/gm;

  let lastIndex = 0;
  let match;
  while ((match = codeBlockRe.exec(markdown)) !== null) {
    const before = markdown.slice(lastIndex, match.index);
    if (before.trim()) parts.push({ type: 'md', content: before });
    parts.push({ type: 'code', lang: match[1] || 'plaintext', content: match[2] });
    lastIndex = match.index + match[0].length;
  }
  const tail = markdown.slice(lastIndex);
  if (tail.trim()) parts.push({ type: 'md', content: tail });

  let html = '';
  for (const part of parts) {
    if (part.type === 'md') {
      let chunk = marked.parse(part.content, { gfm: true });
      // marked occasionally emits doubled tbody tags for some table inputs
      chunk = chunk.replace(/<tbody><tbody>/g, '<tbody>').replace(/<\/tbody><\/tbody>/g, '</tbody>');
      html += chunk;
    } else {
      html += codeBlockMacro(part.lang, part.content);
    }
  }
  return html;
}
