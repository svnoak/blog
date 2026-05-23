// outline.js — Side panel that derives a navigable outline from the document's
// own headings. Pure navigation — no new content surface.
//
// Call initOutline(panelEl, { getMode, getEditorEl, getMdEl, onClose })
// then call .refresh() whenever the document changes.

function initOutline(panel, opts) {
  const { getMode, getEditorEl, getMdEl, onClose } = opts;

  panel.innerHTML = `
    <header class="side-head">
      <span class="side-title">Outline</span>
      <button type="button" class="side-x" title="Close" aria-label="Close outline">×</button>
    </header>
    <div class="outline-body" style="flex:1 1 auto; overflow:hidden; display:flex; flex-direction:column;"></div>
  `;

  const body  = panel.querySelector('.outline-body');
  const close = panel.querySelector('.side-x');
  close.addEventListener('click', () => onClose && onClose());

  let headings = [];
  let activeIdx = -1;

  function parseHeadings(md) {
    const out = [];
    const lines = (md || '').split('\n');
    let inFence = false;
    lines.forEach((line, idx) => {
      if (/^```/.test(line)) { inFence = !inFence; return; }
      if (inFence) return;
      const m = line.match(/^(#{1,3})\s+(.+?)\s*$/);
      if (!m) return;
      const level = m[1].length;
      const text  = m[2].replace(/[*_`]/g, '').trim();
      out.push({ level, text, line: idx });
    });
    return out;
  }

  function readDoc() {
    if (getMode() === 'markdown') {
      const ta = getMdEl();
      return ta ? ta.value : '';
    }
    // WYSIWYG → derive markdown view for parsing
    const el = getEditorEl();
    if (!el) return '';
    try { return htmlToMd(el.innerHTML); } catch (_) { return ''; }
  }

  function render() {
    if (headings.length === 0) {
      body.innerHTML = `
        <div class="side-empty">
          <p>No headings yet.</p>
          <p class="side-empty-sub">
            Use <span class="side-kbd">#</span> for sections.
            Your outline will build itself as you write.
          </p>
        </div>
      `;
      return;
    }
    const items = headings.map((h, i) => `
      <button type="button" class="outline-item lv-${h.level} ${i === activeIdx ? 'is-active' : ''}" data-idx="${i}" title="${escapeAttr(h.text)}">
        <span class="outline-dot"></span>
        <span class="outline-text">${escapeHtml(h.text || 'Untitled section')}</span>
      </button>
    `).join('');
    body.innerHTML = `<nav class="outline-list">${items}</nav>`;
    body.querySelectorAll('.outline-item').forEach(btn => {
      btn.addEventListener('click', () => jumpTo(parseInt(btn.dataset.idx, 10)));
    });
  }

  function jumpTo(i) {
    const h = headings[i];
    if (!h) return;
    if (getMode() === 'wysiwyg') {
      const root = getEditorEl();
      if (!root) return;
      const live = root.querySelectorAll('h1, h2, h3')[i];
      if (!live) return;
      const rect = live.getBoundingClientRect();
      window.scrollTo({ top: rect.top + window.scrollY - window.innerHeight * 0.22, behavior: 'smooth' });
    } else {
      const ta = getMdEl();
      if (!ta) return;
      const lines = ta.value.split('\n');
      let pos = 0;
      for (let k = 0; k < h.line; k++) pos += lines[k].length + 1;
      ta.focus();
      ta.selectionStart = pos;
      ta.selectionEnd   = pos + (lines[h.line] || '').length;
      const cs = window.getComputedStyle(ta);
      const lh = parseFloat(cs.lineHeight) || 28;
      // textarea is auto-resized, so scroll the window
      const rect = ta.getBoundingClientRect();
      window.scrollTo({ top: rect.top + window.scrollY + (h.line - 2) * lh, behavior: 'smooth' });
    }
  }

  function refresh() {
    headings = parseHeadings(readDoc());
    if (activeIdx >= headings.length) activeIdx = headings.length - 1;
    render();
  }

  // Scroll-spy in WYSIWYG mode: highlight the heading nearest the viewport top.
  function onScroll() {
    if (panel.hidden) return;
    if (getMode() !== 'wysiwyg') return;
    const root = getEditorEl();
    if (!root) return;
    const liveHeads = root.querySelectorAll('h1, h2, h3');
    const threshold = window.innerHeight * 0.25;
    let next = -1;
    liveHeads.forEach((el, i) => {
      const top = el.getBoundingClientRect().top;
      if (top <= threshold) next = i;
    });
    if (next !== activeIdx) {
      activeIdx = next;
      body.querySelectorAll('.outline-item').forEach((btn, i) => {
        btn.classList.toggle('is-active', i === activeIdx);
      });
    }
  }
  window.addEventListener('scroll', onScroll, { passive: true });

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function escapeAttr(s) { return escapeHtml(s); }

  refresh();
  return { refresh };
}
