/* ===== Activity log ===== */
window.App = window.App || {};

window.App.logLine = function logLine(level, msg) {
  const log = window.App.$('#log');
  if (!log) return;
  const div = document.createElement('div');
  div.className = 'log-line';
  const tagText = { ok: 'OK', info: 'INFO', warn: 'WARN', err: 'ERR' }[level] || 'INFO';
  div.innerHTML = `[<span class="tag ${level}">${tagText}</span>] ${window.App.escapeHtml(msg)}`;
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
  while (log.children.length > 200) log.removeChild(log.firstChild);
};
