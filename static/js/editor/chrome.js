// chrome.js — Editor UI chrome controls.
//
// Owns the settings popover (theme swatches, focus mode, typewriter scroll,
// toolbar/statusbar visibility, auto-hide, column width, font size, export,
// clear), the .is-focused highlighting that focus mode applies to the
// current block, the typewriter-scroll behavior, the auto-hide chrome
// timer, and the load/persist of every per-setting localStorage key.
//
// initChrome(opts) -> {
//   setFocusMode, toggleFocusMode, isFocusMode,
//   toggleToolbar,
//   setTheme, cycleTheme,
//   bumpActivity, doTypewriterScroll,
//   loadSettings,
// }
//
// opts: see destructured list below; in short, every settings-panel element
// + topbar focus/toolbar buttons + the editor surfaces + getMode/getTitle/
// getContent + onClear callback (host clears editor state).

function initChrome(opts) {
  const {
    settingsBtn, settingsPanel,
    focusBtn, toolbarBtn,
    toolbarRow, statusbar, zenColumn,
    wysiwyg, mdTextarea, titleInput,
    spFocus, spTypewriter, spToolbar, spStatusbar, spAutohide,
    spColSlider, spColVal, spFontSlider, spFontVal,
    spExport, spClear,
    getMode, getTitle, getContent,
    onClear,
  } = opts;

  let focusMode    = false;
  let typewriter   = false;
  let showToolbar  = true;
  let showStatus   = true;
  let autoHide     = true;
  let hideTimer    = null;

  // ── Settings popover ───────────────────────────────────────────────
  function openSettings()  { settingsPanel.style.display = 'block'; bumpActivity(); }
  function closeSettings() { settingsPanel.style.display = 'none'; }

  settingsBtn && settingsBtn.addEventListener('click', e => {
    e.stopPropagation();
    settingsPanel.style.display === 'block' ? closeSettings() : openSettings();
  });
  document.addEventListener('click', () => {
    if (settingsPanel && settingsPanel.style.display === 'block') closeSettings();
  });
  settingsPanel && settingsPanel.addEventListener('click', e => e.stopPropagation());

  // ── Theme ───────────────────────────────────────────────────────────
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
  function cycleTheme() {
    const current = localStorage.getItem('bloggy-theme') || 'paper';
    if (darkThemes.has(current)) setTheme(localStorage.getItem('bloggy-light-theme') || 'paper');
    else setTheme('ember');
  }
  settingsPanel && settingsPanel.querySelectorAll('.sp-swatch').forEach(s => {
    s.addEventListener('click', () => setTheme(s.dataset.theme));
  });

  // ── Focus mode ──────────────────────────────────────────────────────
  function setFocusMode(on) {
    focusMode = on;
    document.body.classList.toggle('focus-mode', on);
    spFocus && spFocus.setAttribute('aria-pressed', String(on));
    if (focusBtn) {
      focusBtn.classList.toggle('is-active', on);
      focusBtn.setAttribute('aria-pressed', String(on));
    }
    localStorage.setItem('bloggy-focus', on ? '1' : '0');
  }
  function toggleFocusMode() { setFocusMode(!focusMode); }
  function isFocusMode() { return focusMode; }
  spFocus  && spFocus.addEventListener('click',  toggleFocusMode);
  focusBtn && focusBtn.addEventListener('click', toggleFocusMode);

  // Highlight the block under the caret as .is-focused (focus mode only).
  document.addEventListener('selectionchange', () => {
    if (!focusMode || getMode() !== 'wysiwyg') return;
    wysiwyg.querySelectorAll('.is-focused').forEach(el => el.classList.remove('is-focused'));
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;
    let n = sel.getRangeAt(0).startContainer;
    while (n && n.parentNode !== wysiwyg) n = n.parentNode;
    if (n && n !== wysiwyg) n.classList.add('is-focused');
  });
  titleInput.addEventListener('focus', () => {
    if (!focusMode) return;
    wysiwyg.querySelectorAll('.is-focused').forEach(el => el.classList.remove('is-focused'));
    titleInput.classList.add('is-focused');
  });
  titleInput.addEventListener('blur', () => titleInput.classList.remove('is-focused'));

  // ── Typewriter scroll ───────────────────────────────────────────────
  function setTypewriter(on) {
    typewriter = on;
    spTypewriter && spTypewriter.setAttribute('aria-pressed', String(on));
    localStorage.setItem('bloggy-typewriter', on ? '1' : '0');
  }
  spTypewriter && spTypewriter.addEventListener('click', () => setTypewriter(!typewriter));

  function doTypewriterScroll() {
    if (!typewriter) return;
    if (getMode() === 'wysiwyg') {
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

  // ── Toolbar visibility ──────────────────────────────────────────────
  function setToolbar(on) {
    showToolbar = on;
    toolbarRow.style.display = on ? '' : 'none';
    spToolbar && spToolbar.setAttribute('aria-pressed', String(on));
    if (toolbarBtn) {
      toolbarBtn.classList.toggle('is-active', on);
      toolbarBtn.setAttribute('aria-pressed', String(on));
    }
    document.body.style.setProperty('--zen-page-top', on ? '152px' : '104px');
    localStorage.setItem('bloggy-toolbar', on ? '1' : '0');
  }
  function toggleToolbar() { setToolbar(!showToolbar); }
  spToolbar  && spToolbar.addEventListener('click',  toggleToolbar);
  toolbarBtn && toolbarBtn.addEventListener('click', toggleToolbar);

  // ── Status bar visibility ───────────────────────────────────────────
  function setStatusbar(on) {
    showStatus = on;
    statusbar && (statusbar.style.display = on ? '' : 'none');
    spStatusbar && spStatusbar.setAttribute('aria-pressed', String(on));
    localStorage.setItem('bloggy-statusbar', on ? '1' : '0');
  }
  spStatusbar && spStatusbar.addEventListener('click', () => setStatusbar(!showStatus));

  // ── Auto-hide chrome ────────────────────────────────────────────────
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
  function bumpActivity() {
    document.body.classList.remove('chrome-hidden');
    clearTimeout(hideTimer);
    if (autoHide) {
      hideTimer = setTimeout(() => document.body.classList.add('chrome-hidden'), 2400);
    }
  }
  spAutohide && spAutohide.addEventListener('click', () => setAutoHide(!autoHide));
  window.addEventListener('mousemove', bumpActivity);
  bumpActivity();

  // ── Column-width slider ─────────────────────────────────────────────
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

  // ── Font-size slider ────────────────────────────────────────────────
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

  // ── Export as Markdown ──────────────────────────────────────────────
  spExport && spExport.addEventListener('click', () => {
    const title   = getTitle() || 'untitled';
    const content = getContent();
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

  // ── Clear page ──────────────────────────────────────────────────────
  spClear && spClear.addEventListener('click', () => {
    if (!confirm('Clear all content? This cannot be undone.')) return;
    onClear && onClear();
    closeSettings();
  });

  // ── Load persisted settings ─────────────────────────────────────────
  function loadSettings() {
    setTheme(localStorage.getItem('bloggy-theme') || 'paper');
    if (localStorage.getItem('bloggy-focus')      === '1') setFocusMode(true);
    if (localStorage.getItem('bloggy-typewriter') === '1') setTypewriter(true);
    setToolbar(localStorage.getItem('bloggy-toolbar') === '1');
    if (localStorage.getItem('bloggy-statusbar') === '0') setStatusbar(false);
    if (localStorage.getItem('bloggy-autohide')  === '0') setAutoHide(false);
    const cw = localStorage.getItem('bloggy-col-width');
    if (cw) applyColWidth(parseInt(cw, 10));
    const fs = localStorage.getItem('bloggy-font-size');
    if (fs) applyFontSize(parseInt(fs, 10));
  }

  return {
    setFocusMode, toggleFocusMode, isFocusMode,
    toggleToolbar,
    setTheme, cycleTheme,
    bumpActivity, doTypewriterScroll,
    loadSettings,
  };
}
