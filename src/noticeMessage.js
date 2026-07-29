/** Minimal, XSS-safe "rich text" for announcement messages: escapes every character of the raw
    input FIRST, then applies a small whitelist of markdown-like transforms (bold/italic/bullet
    lists/links) that only ever produce a fixed set of tags this function itself writes. Because
    escaping happens before any tag is introduced, nothing in the input can ever break out of
    those tags or inject arbitrary markup — the only HTML in the output is <p>/<br>/<ul>/<li>/
    <strong>/<em>/<a href="https://...">, never anything the author typed directly. Safe to pass
    to dangerouslySetInnerHTML for exactly that reason. */

function escapeHtml(str) {
  return str.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function inlineFormat(text) {
  return text
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*]+)\*(?!\*)/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
}

export function renderNoticeMessage(raw) {
  const lines = escapeHtml(String(raw || '')).split('\n');
  let html = '';
  let inList = false;
  for (const line of lines) {
    const bullet = line.match(/^\s*[-*]\s+(.*)$/);
    if (bullet) {
      if (!inList) { html += '<ul>'; inList = true; }
      html += `<li>${inlineFormat(bullet[1])}</li>`;
      continue;
    }
    if (inList) { html += '</ul>'; inList = false; }
    html += line.trim() === '' ? '<br/>' : `<p>${inlineFormat(line)}</p>`;
  }
  if (inList) html += '</ul>';
  return html;
}
