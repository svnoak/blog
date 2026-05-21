// bubble.js — Selection formatting bubble for the WYSIWYG editor.
// Call initBubble(editorEl) once. It self-positions on selection.

function initBubble(editorEl) {
  const el = document.getElementById('zen-bubble');
  let linkOpen = false;
  let savedRange = null;

  // SVG icons matching the reference design
  const ICONS = {
    bold:   `<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><text x="3" y="12" font-family="Newsreader,serif" font-weight="700" font-size="13">B</text></svg>`,
    italic: `<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><text x="4" y="12" font-family="Newsreader,serif" font-style="italic" font-weight="500" font-size="13">I</text></svg>`,
    strike: `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M3 8h10"/><path d="M5 5c0-1.5 1.4-2 3-2s3 .8 3 2M11 11c0 1.5-1.4 2-3 2s-3-.8-3-2"/></svg>`,
    h1:     `<svg width="15" height="14" viewBox="0 0 16 14"><text x="0" y="11" font-family="Newsreader,serif" font-weight="600" font-size="12" fill="currentColor">H<tspan font-size="7" baseline-shift="sub">1</tspan></text></svg>`,
    h2:     `<svg width="15" height="14" viewBox="0 0 16 14"><text x="0" y="11" font-family="Newsreader,serif" font-weight="600" font-size="12" fill="currentColor">H<tspan font-size="7" baseline-shift="sub">2</tspan></text></svg>`,
    quote:  `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 11.5c0-2 .5-3.5 2.5-4.5M3.5 11.5h2.5v-3H3.5v3zM9.5 11.5c0-2 .5-3.5 2.5-4.5M9.5 11.5H12v-3H9.5v3z"/></svg>`,
    ul:     `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="3" cy="4" r=".9" fill="currentColor"/><circle cx="3" cy="8" r=".9" fill="currentColor"/><circle cx="3" cy="12" r=".9" fill="currentColor"/><path d="M6 4h7M6 8h7M6 12h7"/></svg>`,
    ol:     `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><text x="0.5" y="6.2" font-family="JetBrains Mono,monospace" font-size="5" fill="currentColor" stroke="none">1.</text><text x="0.5" y="13" font-family="JetBrains Mono,monospace" font-size="5" fill="currentColor" stroke="none">2.</text><path d="M6 4.5h7M6 11h7"/></svg>`,
    link:   `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M7 9.5a2.5 2.5 0 0 0 3.5 0L13 7a2.5 2.5 0 0 0-3.5-3.5L8 5M9 6.5a2.5 2.5 0 0 0-3.5 0L3 9a2.5 2.5 0 0 0 3.5 3.5L8 11"/></svg>`,
    code:   `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 4 3 8l3 4M10 4l3 4-3 4"/></svg>`,
  };

  el.innerHTML = `
    <div class="zen-bubble-buttons">
      <button class="zen-bubble-btn" data-cmd="bold"   title="Bold">${ICONS.bold}</button>
      <button class="zen-bubble-btn" data-cmd="italic" title="Italic">${ICONS.italic}</button>
      <button class="zen-bubble-btn" data-cmd="strike" title="Strikethrough">${ICONS.strike}</button>
      <div class="zen-bubble-sep"></div>
      <button class="zen-bubble-btn" data-block="H1"         title="Heading 1">${ICONS.h1}</button>
      <button class="zen-bubble-btn" data-block="H2"         title="Heading 2">${ICONS.h2}</button>
      <button class="zen-bubble-btn" data-block="BLOCKQUOTE" title="Quote">${ICONS.quote}</button>
      <div class="zen-bubble-sep"></div>
      <button class="zen-bubble-btn" data-list="ul" title="Bullet list">${ICONS.ul}</button>
      <button class="zen-bubble-btn" data-list="ol" title="Numbered list">${ICONS.ol}</button>
      <div class="zen-bubble-sep"></div>
      <button class="zen-bubble-btn" id="bubble-link-btn" title="Link">${ICONS.link}</button>
      <button class="zen-bubble-btn" data-wrap="code"     title="Inline code">${ICONS.code}</button>
    </div>
    <div class="zen-bubble-link" style="display:none">
      <input id="bubble-url" type="url" placeholder="https://">
      <button class="zen-bubble-btn" id="bubble-url-apply" title="Apply">↵</button>
    </div>
  `;

  const btnPanel  = el.querySelector('.zen-bubble-buttons');
  const linkPanel = el.querySelector('.zen-bubble-link');
  const urlInput  = el.querySelector('#bubble-url');
  const urlApply  = el.querySelector('#bubble-url-apply');

  function show(rect) {
    el.style.left = `${rect.left + rect.width / 2}px`;
    el.style.top  = `${rect.top + window.scrollY}px`;
    el.classList.add('is-visible');
  }

  function hide() {
    el.classList.remove('is-visible');
    exitLink();
  }

  function exitLink() {
    if (!linkOpen) return;
    linkOpen = false;
    btnPanel.style.display  = '';
    linkPanel.style.display = 'none';
  }

  function updateActiveStates() {
    try {
      el.querySelector('[data-cmd="bold"]').classList.toggle('is-active', document.queryCommandState('bold'));
      el.querySelector('[data-cmd="italic"]').classList.toggle('is-active', document.queryCommandState('italic'));
    } catch (_) {}
  }

  function update() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) { hide(); return; }
    const range = sel.getRangeAt(0);
    if (!editorEl.contains(range.commonAncestorContainer)) { hide(); return; }
    const rect = range.getBoundingClientRect();
    if (!rect.width && !rect.height) { hide(); return; }
    show(rect);
    updateActiveStates();
  }

  // Prevent bubble clicks from collapsing the selection
  el.addEventListener('mousedown', e => e.preventDefault());

  el.querySelectorAll('[data-cmd]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.execCommand(btn.dataset.cmd, false, null);
      editorEl.focus();
      setTimeout(update, 0);
    });
  });

  el.querySelectorAll('[data-block]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.execCommand('formatBlock', false, btn.dataset.block);
      editorEl.focus();
      setTimeout(update, 0);
    });
  });

  el.querySelectorAll('[data-list]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.execCommand(btn.dataset.list === 'ul' ? 'insertUnorderedList' : 'insertOrderedList');
      editorEl.focus();
      setTimeout(update, 0);
    });
  });

  el.querySelector('[data-wrap="code"]').addEventListener('click', () => {
    const sel = window.getSelection();
    if (!sel.rangeCount) return;
    const range = sel.getRangeAt(0);
    const code = document.createElement('code');
    try { range.surroundContents(code); } catch (_) {}
    editorEl.focus();
  });

  el.querySelector('#bubble-link-btn').addEventListener('click', () => {
    const sel = window.getSelection();
    if (!sel || !sel.anchorNode) return;
    savedRange = sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null;

    let existing = '';
    let n = sel.anchorNode;
    while (n && n !== editorEl) {
      if (n.tagName === 'A') { existing = n.getAttribute('href') || ''; break; }
      n = n.parentNode;
    }

    urlInput.value = existing;
    linkOpen = true;
    btnPanel.style.display  = 'none';
    linkPanel.style.display = 'flex';
    setTimeout(() => {
      urlInput.focus();
      if (savedRange) {
        const s = window.getSelection();
        s.removeAllRanges();
        s.addRange(savedRange);
      }
    }, 0);
  });

  function commitLink() {
    const url = urlInput.value.trim();
    if (url) document.execCommand('createLink', false, url);
    else     document.execCommand('unlink');
    exitLink();
    editorEl.focus();
    hide();
  }

  urlApply.addEventListener('click', commitLink);
  urlInput.addEventListener('keydown', e => {
    if (e.key === 'Enter')  { e.preventDefault(); commitLink(); }
    if (e.key === 'Escape') exitLink();
  });

  document.addEventListener('selectionchange', update);
  window.addEventListener('scroll', update, true);
  window.addEventListener('resize', update);

  return { hide, update };
}
