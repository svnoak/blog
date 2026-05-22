// app.js — Bloggy editor: mode switching, autosave, chrome, theme, form submit.
// Depends on: md-utils.js, bubble.js, toolbar.js

(function () {
  // ── Page data (injected by Go template) ─────────────────────────────────────
  let POST_ID       = window.EDITOR_POST_ID       || 0;
  const IS_PUBLISHED  = window.EDITOR_IS_PUBLISHED  || false;
  let FORM_ACTION   = window.EDITOR_FORM_ACTION   || '/admin/posts';

  // ── Elements ─────────────────────────────────────────────────────────────────
  const wysiwyg    = document.getElementById('wysiwyg');
  const mdTextarea = document.getElementById('md-editor');
  const titleInput = document.getElementById('title');
  const postForm   = document.getElementById('post-form');
  const saveLabel  = document.getElementById('save-label');
  const saveDot    = document.getElementById('save-dot');
  const statWords  = document.getElementById('stat-words');
  const statChars  = document.getElementById('stat-chars');
  const statRead   = document.getElementById('stat-read');
  const toolbarRow = document.getElementById('toolbar-row');
  const zenMenu    = document.getElementById('zen-menu');
  const focusBtn   = document.getElementById('focus-btn');
  const toolbarBtn = document.getElementById('toolbar-toggle-btn');

  // ── State ────────────────────────────────────────────────────────────────────
  let currentMode    = 'wysiwyg';
  let focusMode      = false;
  let showToolbar    = true;
  let saveLabelTimer = null;
  let saveTimer      = null;
  let hideTimer      = null;

  // ── Expose mode getter for toolbar ──────────────────────────────────────────
  window._editorGetMode   = () => currentMode;
  window._editorOnChange  = () => { updateStats(); scheduleAutosave(); };

  // ── Init content ─────────────────────────────────────────────────────────────
  const initialMd = document.getElementById('initial-content').value;
  wysiwyg.innerHTML = mdToHtml(initialMd);
  mdTextarea.value  = initialMd;
  updateEmptyState();
  updateStats();

  // ── Bubble ───────────────────────────────────────────────────────────────────
  initBubble(wysiwyg);

  // ── Toolbar ──────────────────────────────────────────────────────────────────
  initToolbar(toolbarRow, {
    getMode:     () => currentMode,
    getEditorEl: () => wysiwyg,
    getMdEl:     () => mdTextarea,
  });

  // ── Mode switching ────────────────────────────────────────────────────────────
  function setMode(mode) {
    if (mode === currentMode) return;
    if (currentMode === 'wysiwyg') {
      mdTextarea.value = htmlToMd(wysiwyg.innerHTML);
    } else {
      wysiwyg.innerHTML = mdToHtml(mdTextarea.value);
      updateEmptyState();
    }
    currentMode = mode;
    wysiwyg.style.display    = mode === 'wysiwyg' ? '' : 'none';
    mdTextarea.style.display = mode === 'markdown' ? '' : 'none';
    document.getElementById('btn-write').setAttribute('aria-pressed', String(mode === 'wysiwyg'));
    document.getElementById('btn-md').setAttribute('aria-pressed',    String(mode === 'markdown'));
    updateStats();
    bumpActivity();
  }

  window.setMode = setMode;

  // ── Stats ─────────────────────────────────────────────────────────────────────
  function updateStats() {
    const raw  = currentMode === 'wysiwyg' ? wysiwyg.innerText : mdTextarea.value;
    const text = raw.replace(/[#*`>_~\[\]\(\)]/g, ' ');
    const { words, chars, readMin } = getStats(text);
    statWords.innerHTML = `<b>${words.toLocaleString()}</b> words`;
    statChars.innerHTML = `<b>${chars.toLocaleString()}</b> chars`;
    statRead.innerHTML  = `<b>${readMin}</b> min read`;
  }

  // ── Empty state (wysiwyg placeholder) ────────────────────────────────────────
  function updateEmptyState() {
    wysiwyg.classList.toggle('is-empty', !wysiwyg.innerText.trim());
  }

  // ── WYSIWYG events ────────────────────────────────────────────────────────────
  wysiwyg.addEventListener('input', () => {
    updateEmptyState();
    updateStats();
    scheduleAutosave();
  });

  // Markdown shortcuts: `# `, `> `, `- `, `1. ` on space
  wysiwyg.addEventListener('beforeinput', e => {
    if (e.inputType !== 'insertText' || e.data !== ' ') return;
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount || !sel.getRangeAt(0).collapsed) return;
    const range = sel.getRangeAt(0);
    const node  = range.startContainer;
    if (node.nodeType !== Node.TEXT_NODE) return;
    const before = node.nodeValue.slice(0, range.startOffset);
    const map = [
      [/^###$/, 'H3'], [/^##$/, 'H2'], [/^#$/, 'H1'],
      [/^>$/,   'BLOCKQUOTE'],
      [/^[-*]$/, 'UL_LIST'],
      [/^1\.$/, 'OL_LIST'],
    ];
    for (const [re, kind] of map) {
      if (!re.test(before)) continue;
      e.preventDefault();
      node.nodeValue = node.nodeValue.slice(before.length);
      range.setStart(node, 0); range.setEnd(node, 0);
      if (kind === 'UL_LIST')      document.execCommand('insertUnorderedList');
      else if (kind === 'OL_LIST') document.execCommand('insertOrderedList');
      else                         document.execCommand('formatBlock', false, kind);
      return;
    }
  });

  // Enter key: escape from headings, blockquotes, and code blocks
  wysiwyg.addEventListener('keydown', e => {
    if (e.key !== 'Enter' || e.shiftKey) return;
    const sel = window.getSelection();
    if (!sel.rangeCount) return;

    // Find the direct child of wysiwyg that contains the cursor
    let blockEl = sel.anchorNode;
    while (blockEl && blockEl.parentNode !== wysiwyg) blockEl = blockEl.parentNode;
    if (!blockEl || blockEl === wysiwyg) return;
    const tag = blockEl.tagName ? blockEl.tagName.toUpperCase() : '';

    // ── Escape from BLOCKQUOTE: Enter on an empty line exits to a new paragraph ──
    if (tag === 'BLOCKQUOTE') {
      // Find the line element (direct child of blockquote) containing the cursor
      let lineEl = sel.anchorNode;
      if (lineEl.nodeType === Node.TEXT_NODE) lineEl = lineEl.parentNode;
      while (lineEl && lineEl !== blockEl && lineEl.parentNode !== blockEl) lineEl = lineEl.parentNode;
      const lineIsEmpty = !lineEl || lineEl === blockEl || !lineEl.textContent.trim();
      if (lineIsEmpty) {
        e.preventDefault();
        if (lineEl && lineEl !== blockEl) blockEl.removeChild(lineEl);
        const p = document.createElement('p'); p.innerHTML = '<br>';
        blockEl.insertAdjacentElement('afterend', p);
        const r = document.createRange(); r.setStart(p, 0); r.collapse(true);
        sel.removeAllRanges(); sel.addRange(r);
      }
      return; // let default Enter add lines within the blockquote otherwise
    }

    // ── Escape from PRE/code block: Enter at the very end exits to a new paragraph ──
    if (tag === 'PRE') {
      const curRange = sel.getRangeAt(0);
      const afterRange = document.createRange();
      afterRange.selectNodeContents(blockEl);
      afterRange.setStart(curRange.endContainer, curRange.endOffset);
      const atEnd = afterRange.toString() === '';
      if (atEnd) {
        e.preventDefault();
        const p = document.createElement('p'); p.innerHTML = '<br>';
        blockEl.insertAdjacentElement('afterend', p);
        const r = document.createRange(); r.setStart(p, 0); r.collapse(true);
        sel.removeAllRanges(); sel.addRange(r);
      }
      return; // let default Enter add newlines within pre otherwise
    }

    // ── Escape from headings: Enter creates empty heading → convert to paragraph ──
    if (/^H[1-3]$/.test(tag) && blockEl.textContent) {
      setTimeout(() => {
        let b = sel.anchorNode;
        while (b && b.parentNode !== wysiwyg) b = b.parentNode;
        if (b && /^H[1-3]$/.test(b.tagName) && !b.textContent) {
          document.execCommand('formatBlock', false, 'P');
        }
      }, 0);
    }
  });

  // Plain-text paste
  wysiwyg.addEventListener('paste', e => {
    const text = (e.clipboardData || window.clipboardData).getData('text/plain');
    if (text) { e.preventDefault(); document.execCommand('insertText', false, text); }
  });

  // Focus → update focus block
  document.addEventListener('selectionchange', () => {
    if (!focusMode || currentMode !== 'wysiwyg') return;
    wysiwyg.querySelectorAll('.is-focused').forEach(el => el.classList.remove('is-focused'));
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;
    let n = sel.getRangeAt(0).startContainer;
    while (n && n.parentNode !== wysiwyg) n = n.parentNode;
    if (n && n !== wysiwyg) n.classList.add('is-focused');
  });

  // ── Markdown editor events ────────────────────────────────────────────────────
  mdTextarea.addEventListener('input', () => { updateStats(); scheduleAutosave(); });
  mdTextarea.addEventListener('keydown', e => {
    if (e.key !== 'Tab') return;
    e.preventDefault();
    const s = e.target.selectionStart;
    e.target.value = e.target.value.slice(0, s) + '  ' + e.target.value.slice(e.target.selectionEnd);
    e.target.selectionStart = e.target.selectionEnd = s + 2;
    scheduleAutosave();
  });

  // ── Title events ──────────────────────────────────────────────────────────────
  titleInput.addEventListener('input', () => {
    document.title = titleInput.value || 'Untitled';
    scheduleAutosave();
  });
  titleInput.addEventListener('focus', () => {
    if (!focusMode) return;
    wysiwyg.querySelectorAll('.is-focused').forEach(el => el.classList.remove('is-focused'));
    titleInput.classList.add('is-focused');
  });
  titleInput.addEventListener('blur', () => {
    titleInput.classList.remove('is-focused');
  });

  // ── Chrome auto-hide ──────────────────────────────────────────────────────────
  function bumpActivity() {
    document.body.classList.remove('chrome-hidden');
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => document.body.classList.add('chrome-hidden'), 2400);
  }

  window.addEventListener('mousemove', bumpActivity);
  bumpActivity();

  // ── Autosave ──────────────────────────────────────────────────────────────────
  function scheduleAutosave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(doAutosave, 2000);
  }

  function doAutosave() {
    const title   = titleInput.value;
    const content = currentMode === 'wysiwyg' ? htmlToMd(wysiwyg.innerHTML) : mdTextarea.value;
    if (!POST_ID && !title.trim() && !content.trim()) return;
    const data = new FormData();
    data.append('content', content);
    data.append('title',   title);
    data.append('action',  'save');
    saveDot.classList.add('saving');
    fetch(FORM_ACTION, { method: 'POST', body: data })
      .then(r => {
        saveDot.classList.remove('saving');
        if (r.ok || r.redirected) {
          if (!POST_ID && r.redirected) {
            const match = r.url.match(/\/admin\/posts\/(\d+)\/edit/);
            if (match) {
              POST_ID         = parseInt(match[1], 10);
              FORM_ACTION     = `/admin/posts/${POST_ID}`;
              postForm.action = FORM_ACTION;
              history.pushState({}, '', r.url);
            }
          }
          saveLabel.textContent = 'Saved';
          clearTimeout(saveLabelTimer);
          saveLabelTimer = setTimeout(() => { saveLabel.textContent = 'Draft'; }, 3000);
        }
      })
      .catch(() => saveDot.classList.remove('saving'));
  }

  // ── Form submission ────────────────────────────────────────────────────────────
  window.submitPost = function (action) {
    const content = currentMode === 'wysiwyg' ? htmlToMd(wysiwyg.innerHTML) : mdTextarea.value;
    document.getElementById('content-input').value = content;
    document.getElementById('action-input').value  = action;
    postForm.submit();
  };

  // ── Focus mode ────────────────────────────────────────────────────────────────
  function toggleFocusMode() {
    focusMode = !focusMode;
    document.body.classList.toggle('focus-mode', focusMode);
    focusBtn && focusBtn.classList.toggle('is-active', focusMode);
  }

  focusBtn && focusBtn.addEventListener('click', toggleFocusMode);

  // ── Toolbar toggle ────────────────────────────────────────────────────────────
  function toggleToolbar() {
    showToolbar = !showToolbar;
    toolbarRow.style.display = showToolbar ? '' : 'none';
    toolbarBtn && toolbarBtn.classList.toggle('is-active', showToolbar);
    document.body.style.setProperty('--zen-page-top', showToolbar ? '148px' : '100px');
  }

  toolbarBtn && toolbarBtn.addEventListener('click', toggleToolbar);

  // ── Theme menu ────────────────────────────────────────────────────────────────
  const themeBtn = document.getElementById('theme-btn');

  function setTheme(name) {
    if (name === 'paper') document.body.removeAttribute('data-theme');
    else document.body.setAttribute('data-theme', name);
    localStorage.setItem('bloggy-theme', name);
    zenMenu && zenMenu.querySelectorAll('.zen-swatch').forEach(s => {
      s.classList.toggle('is-active', s.dataset.theme === name);
    });
    closeMenu();
  }
  window.setTheme = setTheme;

  function openMenu() {
    if (!zenMenu) return;
    zenMenu.style.display = 'block';
    bumpActivity();
  }

  function closeMenu() {
    if (!zenMenu) return;
    zenMenu.style.display = 'none';
  }

  themeBtn && themeBtn.addEventListener('click', e => {
    e.stopPropagation();
    zenMenu && zenMenu.style.display === 'block' ? closeMenu() : openMenu();
  });

  document.addEventListener('click', closeMenu);
  zenMenu && zenMenu.addEventListener('click', e => e.stopPropagation());

  setTheme(localStorage.getItem('bloggy-theme') || 'paper');

  // ── Keyboard shortcuts ────────────────────────────────────────────────────────
  document.addEventListener('keydown', e => {
    const mod = e.metaKey || e.ctrlKey;
    if (!mod) return;
    if (e.key === '.') { e.preventDefault(); toggleFocusMode(); }
    if (e.key === '/' || e.key === '\\') { e.preventDefault(); toggleToolbar(); }
    if (e.key.toLowerCase() === 'm' && e.shiftKey) {
      e.preventDefault();
      setMode(currentMode === 'wysiwyg' ? 'markdown' : 'wysiwyg');
    }
  });

  // ── Initial page-top padding ───────────────────────────────────────────────
  document.body.style.setProperty('--zen-page-top', '148px');
})();
