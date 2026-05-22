// app.js — Bloggy editor: mode switching, autosave, chrome, theme, form submit.
// Depends on: md-utils.js, bubble.js, toolbar.js

(function () {
  // ── Page data (injected by Go template) ─────────────────────────────────────
  let POST_ID     = window.EDITOR_POST_ID    || 0;
  let FORM_ACTION = window.EDITOR_FORM_ACTION || '/admin/posts';

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
  const statusbar  = document.getElementById('statusbar');
  const zenColumn  = document.querySelector('.zen-column');

  // Settings panel
  const settingsBtn  = document.getElementById('settings-btn');
  const settingsPanel = document.getElementById('settings-panel');
  const spFocus      = document.getElementById('sp-focus');
  const spTypewriter = document.getElementById('sp-typewriter');
  const spToolbar    = document.getElementById('sp-toolbar');
  const spStatusbar  = document.getElementById('sp-statusbar');
  const spAutohide   = document.getElementById('sp-autohide');
  const spColSlider  = document.getElementById('sp-col-slider');
  const spColVal     = document.getElementById('sp-col-val');
  const spFontSlider = document.getElementById('sp-font-slider');
  const spFontVal    = document.getElementById('sp-font-val');
  const spExport     = document.getElementById('sp-export');
  const spClear      = document.getElementById('sp-clear');

  // ── State ────────────────────────────────────────────────────────────────────
  let currentMode   = 'wysiwyg';
  let focusMode     = false;
  let typewriter    = false;
  let showToolbar   = true;
  let showStatusbar = true;
  let autoHide      = true;
  let saveLabelTimer = null;
  let saveTimer      = null;
  let hideTimer      = null;

  // ── Expose mode getter for toolbar ──────────────────────────────────────────
  window._editorGetMode  = () => currentMode;
  window._editorOnChange = () => { updateStats(); scheduleAutosave(); };

  // ── Init content ─────────────────────────────────────────────────────────────
  const initialMd = document.getElementById('initial-content').value;
  wysiwyg.innerHTML = mdToHtml(initialMd);
  ensureHrParagraphs();
  mdTextarea.value  = initialMd;
  updateEmptyState();
  updateStats();

  // ── Bubble & Toolbar ─────────────────────────────────────────────────────────
  initBubble(wysiwyg);
  initToolbar(toolbarRow, {
    getMode:     () => currentMode,
    getEditorEl: () => wysiwyg,
    getMdEl:     () => mdTextarea,
  });

  // ── Settings panel ────────────────────────────────────────────────────────────
  function openSettings() {
    settingsPanel.style.display = 'block';
    bumpActivity();
  }
  function closeSettings() {
    settingsPanel.style.display = 'none';
  }

  settingsBtn && settingsBtn.addEventListener('click', e => {
    e.stopPropagation();
    settingsPanel.style.display === 'block' ? closeSettings() : openSettings();
  });
  document.addEventListener('click', () => {
    if (settingsPanel && settingsPanel.style.display === 'block') closeSettings();
  });
  settingsPanel && settingsPanel.addEventListener('click', e => e.stopPropagation());

  // ── Theme ─────────────────────────────────────────────────────────────────────
  const validThemes = new Set(['paper', 'slate', 'ember', 'carbon']);
  const darkThemes  = new Set(['ember', 'carbon']);
  function setTheme(name) {
    if (!validThemes.has(name)) name = 'paper';
    if (name === 'paper') document.body.removeAttribute('data-theme');
    else document.body.setAttribute('data-theme', name);
    localStorage.setItem('bloggy-theme', name);
    if (!darkThemes.has(name)) localStorage.setItem('bloggy-light-theme', name);
    settingsPanel && settingsPanel.querySelectorAll('.sp-swatch').forEach(s => {
      s.classList.toggle('is-active', s.dataset.theme === name);
    });
  }
  window.setTheme = setTheme;

  settingsPanel && settingsPanel.querySelectorAll('.sp-swatch').forEach(s => {
    s.addEventListener('click', () => setTheme(s.dataset.theme));
  });

  // ── Focus mode ────────────────────────────────────────────────────────────────
  function setFocusMode(on) {
    focusMode = on;
    document.body.classList.toggle('focus-mode', on);
    spFocus && spFocus.setAttribute('aria-pressed', String(on));
    localStorage.setItem('bloggy-focus', on ? '1' : '0');
  }
  function toggleFocusMode() { setFocusMode(!focusMode); }

  spFocus && spFocus.addEventListener('click', toggleFocusMode);

  // ── Typewriter scroll ─────────────────────────────────────────────────────────
  function setTypewriter(on) {
    typewriter = on;
    spTypewriter && spTypewriter.setAttribute('aria-pressed', String(on));
    localStorage.setItem('bloggy-typewriter', on ? '1' : '0');
  }
  spTypewriter && spTypewriter.addEventListener('click', () => setTypewriter(!typewriter));

  function doTypewriterScroll() {
    if (!typewriter) return;
    if (currentMode === 'wysiwyg') {
      const sel = window.getSelection();
      if (!sel || !sel.rangeCount) return;
      const r = sel.getRangeAt(0).cloneRange();
      r.collapse(true);
      const rect = r.getBoundingClientRect();
      if (!rect || (!rect.height && !rect.width)) return;
      const diff = rect.top - window.innerHeight * 0.45;
      if (Math.abs(diff) < 8) return;
      window.scrollBy({ top: diff, behavior: 'smooth' });
    } else {
      const ta = mdTextarea;
      const lh = parseFloat(getComputedStyle(ta).lineHeight) || 24;
      const lines = ta.value.substring(0, ta.selectionStart).split('\n').length - 1;
      const taRect = ta.getBoundingClientRect();
      const curTop = taRect.top + lines * lh - (ta.scrollTop || 0);
      const diff = curTop - window.innerHeight * 0.45;
      if (Math.abs(diff) < 8) return;
      window.scrollBy({ top: diff, behavior: 'smooth' });
    }
  }

  // ── Toolbar toggle ────────────────────────────────────────────────────────────
  function setToolbar(on) {
    showToolbar = on;
    toolbarRow.style.display = on ? '' : 'none';
    spToolbar && spToolbar.setAttribute('aria-pressed', String(on));
    document.body.style.setProperty('--zen-page-top', on ? '148px' : '100px');
    localStorage.setItem('bloggy-toolbar', on ? '1' : '0');
  }
  function toggleToolbar() { setToolbar(!showToolbar); }
  spToolbar && spToolbar.addEventListener('click', toggleToolbar);

  // ── Status bar toggle ─────────────────────────────────────────────────────────
  function setStatusbar(on) {
    showStatusbar = on;
    statusbar && (statusbar.style.display = on ? '' : 'none');
    spStatusbar && spStatusbar.setAttribute('aria-pressed', String(on));
    localStorage.setItem('bloggy-statusbar', on ? '1' : '0');
  }
  spStatusbar && spStatusbar.addEventListener('click', () => setStatusbar(!showStatusbar));

  // ── Auto-hide chrome ──────────────────────────────────────────────────────────
  function setAutoHide(on) {
    autoHide = on;
    spAutohide && spAutohide.setAttribute('aria-pressed', String(on));
    localStorage.setItem('bloggy-autohide', on ? '1' : '0');
    if (!on) {
      clearTimeout(hideTimer);
      document.body.classList.remove('chrome-hidden');
    } else {
      bumpActivity();
    }
  }
  spAutohide && spAutohide.addEventListener('click', () => setAutoHide(!autoHide));

  function bumpActivity() {
    document.body.classList.remove('chrome-hidden');
    clearTimeout(hideTimer);
    if (autoHide) {
      hideTimer = setTimeout(() => document.body.classList.add('chrome-hidden'), 2400);
    }
  }
  window.addEventListener('mousemove', bumpActivity);
  bumpActivity();

  // ── Column width slider ───────────────────────────────────────────────────────
  function applyColWidth(val) {
    zenColumn && (zenColumn.style.maxWidth = val + 'px');
    spColVal && (spColVal.textContent = val + 'px');
    spColSlider && (spColSlider.value = String(val));
  }
  spColSlider && spColSlider.addEventListener('input', () => {
    const val = parseInt(spColSlider.value, 10);
    applyColWidth(val);
    localStorage.setItem('bloggy-col-width', val);
  });

  // ── Font size slider ──────────────────────────────────────────────────────────
  function applyFontSize(val) {
    wysiwyg.style.fontSize = val + 'px';
    mdTextarea.style.fontSize = val + 'px';
    spFontVal && (spFontVal.textContent = val + 'px');
    spFontSlider && (spFontSlider.value = String(val));
  }
  spFontSlider && spFontSlider.addEventListener('input', () => {
    const val = parseInt(spFontSlider.value, 10);
    applyFontSize(val);
    localStorage.setItem('bloggy-font-size', val);
  });

  // ── Export as Markdown ────────────────────────────────────────────────────────
  spExport && spExport.addEventListener('click', () => {
    const title   = titleInput.value || 'untitled';
    const content = currentMode === 'wysiwyg' ? htmlToMd(wysiwyg.innerHTML) : mdTextarea.value;
    const full    = title ? '# ' + title + '\n\n' + content : content;
    const blob    = new Blob([full], { type: 'text/markdown' });
    const url     = URL.createObjectURL(blob);
    const a       = document.createElement('a');
    a.href     = url;
    a.download = title.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() + '.md';
    a.click();
    URL.revokeObjectURL(url);
    closeSettings();
  });

  // ── Clear page ────────────────────────────────────────────────────────────────
  spClear && spClear.addEventListener('click', () => {
    if (!confirm('Clear all content? This cannot be undone.')) return;
    wysiwyg.innerHTML = '';
    mdTextarea.value  = '';
    titleInput.value  = '';
    document.title    = 'New post';
    updateEmptyState();
    updateStats();
    scheduleAutosave();
    closeSettings();
  });

  // ── Mode switching ────────────────────────────────────────────────────────────
  function setMode(mode) {
    if (mode === currentMode) return;
    if (currentMode === 'wysiwyg') {
      mdTextarea.value = htmlToMd(wysiwyg.innerHTML);
    } else {
      wysiwyg.innerHTML = mdToHtml(mdTextarea.value);
      ensureHrParagraphs();
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

  // ── HR helpers ───────────────────────────────────────────────────────────────
  function ensureHrParagraphs() {
    wysiwyg.querySelectorAll('hr').forEach(hr => {
      if (!hr.nextElementSibling) {
        const p = document.createElement('p'); p.innerHTML = '<br>';
        hr.insertAdjacentElement('afterend', p);
      }
    });
  }

  // ── WYSIWYG events ────────────────────────────────────────────────────────────
  wysiwyg.addEventListener('input', () => {
    updateEmptyState();
    updateStats();
    scheduleAutosave();
    doTypewriterScroll();
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

  // Enter/ArrowDown key: escape from headings, blockquotes, and code blocks
  wysiwyg.addEventListener('keydown', e => {
    if ((e.key !== 'Enter' && e.key !== 'ArrowDown') || e.shiftKey) return;
    const sel = window.getSelection();
    if (!sel.rangeCount) return;

    let blockEl = sel.anchorNode;
    while (blockEl && blockEl.parentNode !== wysiwyg) blockEl = blockEl.parentNode;
    if (!blockEl || blockEl === wysiwyg) return;
    const tag = blockEl.tagName ? blockEl.tagName.toUpperCase() : '';

    // BLOCKQUOTE: Enter adds line within; Enter on empty line or ArrowDown on last line exits
    if (tag === 'BLOCKQUOTE') {
      let lineEl = sel.anchorNode;
      if (lineEl.nodeType === Node.TEXT_NODE) lineEl = lineEl.parentNode;
      while (lineEl && lineEl !== blockEl && lineEl.parentNode !== blockEl) lineEl = lineEl.parentNode;
      const lineIsEmpty = !lineEl || lineEl === blockEl || !lineEl.textContent.trim();
      const isLastLine  = !lineEl || lineEl === blockEl || !lineEl.nextElementSibling;

      if (e.key === 'ArrowDown' && isLastLine) {
        let nextEl = blockEl.nextElementSibling;
        if (!nextEl) { nextEl = document.createElement('p'); nextEl.innerHTML = '<br>'; blockEl.insertAdjacentElement('afterend', nextEl); }
        e.preventDefault();
        const r = document.createRange(); r.setStart(nextEl, 0); r.collapse(true);
        sel.removeAllRanges(); sel.addRange(r);
        return;
      }

      if (e.key !== 'Enter') return;
      e.preventDefault();

      if (lineIsEmpty) {
        if (lineEl && lineEl !== blockEl) blockEl.removeChild(lineEl);
        const p = document.createElement('p'); p.innerHTML = '<br>';
        blockEl.insertAdjacentElement('afterend', p);
        const r = document.createRange(); r.setStart(p, 0); r.collapse(true);
        sel.removeAllRanges(); sel.addRange(r);
      } else {
        const range = sel.getRangeAt(0);
        range.deleteContents();
        const newLine = document.createElement(lineEl.tagName || 'P');
        if (lineEl.lastChild) {
          const afterRange = document.createRange();
          afterRange.setStart(range.startContainer, range.startOffset);
          afterRange.setEndAfter(lineEl.lastChild);
          const frag = afterRange.extractContents();
          newLine.appendChild(frag);
          if (!newLine.textContent && !newLine.querySelector('br,img,hr')) newLine.innerHTML = '<br>';
        } else {
          newLine.innerHTML = '<br>';
        }
        if (!lineEl.textContent && !lineEl.querySelector('br,img,hr')) lineEl.innerHTML = '<br>';
        lineEl.insertAdjacentElement('afterend', newLine);
        const r = document.createRange(); r.setStart(newLine, 0); r.collapse(true);
        sel.removeAllRanges(); sel.addRange(r);
      }
      return;
    }

    // PRE/code block: Enter at the very end exits to a new paragraph
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
      return;
    }

    // Headings: Enter creates empty heading → convert to paragraph
    if (e.key === 'Enter' && /^H[1-3]$/.test(tag) && blockEl.textContent) {
      setTimeout(() => {
        let b = sel.anchorNode;
        while (b && b.parentNode !== wysiwyg) b = b.parentNode;
        if (b && /^H[1-3]$/.test(b.tagName) && !b.textContent) {
          document.execCommand('formatBlock', false, 'P');
        }
      }, 0);
    }
  });

  // Backspace/Delete: remove <hr> when cursor is adjacent to one
  wysiwyg.addEventListener('keydown', e => {
    if (e.key !== 'Backspace' && e.key !== 'Delete') return;
    if (e.shiftKey || e.metaKey || e.ctrlKey || e.altKey) return;
    const sel = window.getSelection();
    if (!sel.rangeCount || !sel.getRangeAt(0).collapsed) return;
    let blockEl = sel.anchorNode;
    while (blockEl && blockEl.parentNode !== wysiwyg) blockEl = blockEl.parentNode;
    if (!blockEl || blockEl === wysiwyg) return;
    const range = sel.getRangeAt(0);
    if (e.key === 'Backspace') {
      const r = document.createRange();
      try { r.selectNodeContents(blockEl); r.setEnd(range.startContainer, range.startOffset); } catch (_) { return; }
      if (r.toString() !== '') return;
      const prev = blockEl.previousElementSibling;
      if (prev && prev.tagName === 'HR') { e.preventDefault(); prev.remove(); updateStats(); scheduleAutosave(); }
    } else {
      const r = document.createRange();
      try { r.selectNodeContents(blockEl); r.setStart(range.startContainer, range.startOffset); } catch (_) { return; }
      if (r.toString() !== '') return;
      const next = blockEl.nextElementSibling;
      if (next && next.tagName === 'HR') { e.preventDefault(); next.remove(); updateStats(); scheduleAutosave(); }
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
  mdTextarea.addEventListener('input', () => {
    updateStats();
    scheduleAutosave();
    doTypewriterScroll();
  });
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

  // ── Keyboard shortcuts ────────────────────────────────────────────────────────
  document.addEventListener('keydown', e => {
    const mod = e.metaKey || e.ctrlKey;
    if (!mod) return;

    if (e.key === '.') { e.preventDefault(); toggleFocusMode(); }
    if (e.key === '/' || e.key === '\\') { e.preventDefault(); toggleToolbar(); }
    if (e.key.toLowerCase() === 'l' && e.shiftKey) {
      e.preventDefault();
      const current = localStorage.getItem('bloggy-theme') || 'paper';
      if (darkThemes.has(current)) setTheme(localStorage.getItem('bloggy-light-theme') || 'paper');
      else setTheme('ember');
    }
    if (e.key.toLowerCase() === 'm' && e.shiftKey) {
      e.preventDefault();
      setMode(currentMode === 'wysiwyg' ? 'markdown' : 'wysiwyg');
    }

    const inEditor = document.activeElement === wysiwyg || document.activeElement === mdTextarea;
    if (!inEditor) return;

    if (!e.shiftKey && !e.altKey) {
      if (e.key.toLowerCase() === 'b') { e.preventDefault(); _tbCmd('bold'); }
      if (e.key.toLowerCase() === 'i') { e.preventDefault(); _tbCmd('italic'); }
      if (e.key.toLowerCase() === 'e') { e.preventDefault(); _tbCmd('code'); }
      if (e.key.toLowerCase() === 'k') { e.preventDefault(); _tbLink(); }
    }
    if (e.altKey && !e.shiftKey) {
      if (e.code === 'Digit1') { e.preventDefault(); _tbCmd('heading', 'H1'); }
      if (e.code === 'Digit2') { e.preventDefault(); _tbCmd('heading', 'H2'); }
      if (e.code === 'Digit3') { e.preventDefault(); _tbCmd('heading', 'H3'); }
    }
    if (e.shiftKey && !e.altKey) {
      if (e.key.toLowerCase() === 's') { e.preventDefault(); _tbCmd('strike'); }
      if (e.code === 'Digit7') { e.preventDefault(); _tbCmd('ol'); }
      if (e.code === 'Digit8') { e.preventDefault(); _tbCmd('ul'); }
      if (e.code === 'Digit9') { e.preventDefault(); _tbCmd('quote'); }
    }
  });

  // ── Init settings from localStorage ──────────────────────────────────────────
  (function initSettings() {
    setTheme(localStorage.getItem('bloggy-theme') || 'paper');

    if (localStorage.getItem('bloggy-focus') === '1') setFocusMode(true);
    if (localStorage.getItem('bloggy-typewriter') === '1') setTypewriter(true);

    // Toolbar: default off
    const storedToolbar = localStorage.getItem('bloggy-toolbar');
    setToolbar(storedToolbar === '1');

    // Status bar: default on
    const storedStatusbar = localStorage.getItem('bloggy-statusbar');
    if (storedStatusbar === '0') setStatusbar(false);

    // Auto-hide: default on
    const storedAutohide = localStorage.getItem('bloggy-autohide');
    if (storedAutohide === '0') setAutoHide(false);

    // Column width
    const storedColWidth = localStorage.getItem('bloggy-col-width');
    if (storedColWidth) applyColWidth(parseInt(storedColWidth, 10));

    // Font size
    const storedFontSize = localStorage.getItem('bloggy-font-size');
    if (storedFontSize) {
      applyFontSize(parseInt(storedFontSize, 10));
    }
  })();
})();
