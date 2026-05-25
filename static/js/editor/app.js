// app.js — Bloggy editor orchestrator. Wires the per-domain modules together,
// owns the page-level state (currentMode, POST_ID, FORM_ACTION), and handles
// the bits that don't belong to any single submodule: stats, the empty-state
// class, HR repair, mode switching, the input listeners that fan out
// updates, form submission, and the global Cmd-* keyboard shortcuts.
//
// Depends on (in this load order):
//   md-utils.js, bubble.js, toolbar.js, outline.js, scratchpad.js,
//   margin-notes.js, chrome.js, tags.js, autosave.js, wysiwyg-keys.js,
//   pinning.js

(function () {
  // ── Page data (injected by Go template) ─────────────────────────────
  let POST_ID     = window.EDITOR_POST_ID    || 0;
  let FORM_ACTION = window.EDITOR_FORM_ACTION || '/admin/posts';

  // ── Elements ─────────────────────────────────────────────────────────
  const wysiwyg    = document.getElementById('wysiwyg');
  const mdTextarea = document.getElementById('md-editor');
  const titleInput = document.getElementById('title');
  const postForm   = document.getElementById('post-form');
  const saveDot    = document.getElementById('save-dot');
  const saveLabel  = document.getElementById('save-label');
  const statWords  = document.getElementById('stat-words');
  const statChars  = document.getElementById('stat-chars');
  const statRead   = document.getElementById('stat-read');
  const toolbarRow = document.getElementById('toolbar-row');
  const statusbar  = document.getElementById('statusbar');
  const zenColumn  = document.querySelector('.zen-column');

  const outlineBtn       = document.getElementById('outline-btn');
  const scratchpadBtn    = document.getElementById('scratchpad-btn');
  const outlinePanel     = document.getElementById('outline-panel');
  const scratchpadPanel  = document.getElementById('scratchpad-panel');
  const marginContainer  = document.getElementById('margin-notes');

  const tagChipsRow      = document.getElementById('tag-chips-row');
  const tagChipsInput    = document.getElementById('tag-chips-input');
  const tagsHidden       = document.getElementById('tags-input');

  // ── State ────────────────────────────────────────────────────────────
  let currentMode = 'wysiwyg';

  // Module handles — assigned in dependency order below. Declared up front
  // because cross-module callbacks (e.g. pinning's getScratchpadApi) capture
  // these names and resolve them lazily at call time.
  let chromeApi, autosaveApi, tagsApi, outlineApi,
      pinningApi, scratchpadApi, marginApi;

  // ── Toolbar callbacks ───────────────────────────────────────────────
  window._editorGetMode  = () => currentMode;
  window._editorOnChange = () => { updateStats(); autosaveApi.schedule(); };

  // ── Helpers ─────────────────────────────────────────────────────────
  function getMdContent() {
    return currentMode === 'wysiwyg' ? htmlToMd(wysiwyg.innerHTML) : mdTextarea.value;
  }
  function onChanged()      { autosaveApi.schedule(); }
  function repositionMargin() { marginApi && marginApi.reposition(); }

  function updateStats() {
    const raw  = currentMode === 'wysiwyg' ? wysiwyg.innerText : mdTextarea.value;
    const text = raw.replace(/[#*`>_~\[\]\(\)]/g, ' ');
    const { words, chars, readMin } = getStats(text);
    statWords.innerHTML = `<b>${words.toLocaleString()}</b> words`;
    statChars.innerHTML = `<b>${chars.toLocaleString()}</b> chars`;
    statRead.innerHTML  = `<b>${readMin}</b> min read`;
  }

  function updateEmptyState() {
    wysiwyg.classList.toggle('is-empty', !wysiwyg.innerText.trim());
  }

  // After mdToHtml runs, lone trailing <hr>s have no following block. Without
  // a paragraph after them the caret can't be placed below the rule.
  function ensureHrParagraphs() {
    wysiwyg.querySelectorAll('hr').forEach(hr => {
      if (!hr.nextElementSibling) {
        const p = document.createElement('p'); p.innerHTML = '<br>';
        hr.insertAdjacentElement('afterend', p);
      }
    });
  }

  function autoResizeMd() {
    if (mdTextarea.style.display === 'none') return;
    mdTextarea.style.height = 'auto';
    mdTextarea.style.height = mdTextarea.scrollHeight + 'px';
  }

  function refreshOutlineIfOpen() {
    if (!outlinePanel.hidden) outlineApi.refresh();
  }

  // ── Init content ─────────────────────────────────────────────────────
  const initialMd = document.getElementById('initial-content').value;
  wysiwyg.innerHTML = mdToHtml(initialMd);
  ensureHrParagraphs();
  mdTextarea.value = initialMd;
  updateEmptyState();
  updateStats();

  // ── Shared widgets ──────────────────────────────────────────────────
  initBubble(wysiwyg);
  initToolbar(toolbarRow, {
    getMode:     () => currentMode,
    getEditorEl: () => wysiwyg,
    getMdEl:     () => mdTextarea,
  });

  // ── Chrome (settings, theme, toggles, sliders, export/clear) ────────
  chromeApi = initChrome({
    settingsBtn:   document.getElementById('settings-btn'),
    settingsPanel: document.getElementById('settings-panel'),
    focusBtn:      document.getElementById('focus-btn'),
    toolbarBtn:    document.getElementById('toolbar-btn'),
    toolbarRow, statusbar, zenColumn,
    wysiwyg, mdTextarea, titleInput,
    spFocus:      document.getElementById('sp-focus'),
    spTypewriter: document.getElementById('sp-typewriter'),
    spToolbar:    document.getElementById('sp-toolbar'),
    spStatusbar:  document.getElementById('sp-statusbar'),
    spAutohide:   document.getElementById('sp-autohide'),
    spColSlider:  document.getElementById('sp-col-slider'),
    spColVal:     document.getElementById('sp-col-val'),
    spFontSlider: document.getElementById('sp-font-slider'),
    spFontVal:    document.getElementById('sp-font-val'),
    spExport:     document.getElementById('sp-export'),
    spClear:      document.getElementById('sp-clear'),
    getMode:    () => currentMode,
    getTitle:   () => titleInput.value,
    getContent: getMdContent,
    onClear() {
      wysiwyg.innerHTML = '';
      mdTextarea.value  = '';
      titleInput.value  = '';
      document.title    = 'New post';
      updateEmptyState();
      updateStats();
      onChanged();
    },
  });
  window.setTheme = chromeApi.setTheme;

  // ── Autosave ─────────────────────────────────────────────────────────
  autosaveApi = initAutosave({
    getPostId:     () => POST_ID,
    getFormAction: () => FORM_ACTION,
    getTitle:      () => titleInput.value,
    getContent:    getMdContent,
    getTags:       () => tagsHidden.value,
    postForm, saveDot, saveLabel,
    onPostCreated(newId, newAction) { POST_ID = newId; FORM_ACTION = newAction; },
  });

  // ── Tag chips ────────────────────────────────────────────────────────
  tagsApi = initTags(tagChipsRow, tagChipsInput, tagsHidden, { onChanged });

  // ── WYSIWYG keyboard behavior ───────────────────────────────────────
  initWysiwygKeys(wysiwyg, {
    onChanged() { updateStats(); autosaveApi.schedule(); },
  });

  // ── Outline panel ───────────────────────────────────────────────────
  outlineApi = initOutline(outlinePanel, {
    getMode:     () => currentMode,
    getEditorEl: () => wysiwyg,
    getMdEl:     () => mdTextarea,
    onClose:     () => setOutline(false),
  });

  // ── Pinning + scratchpad + margin notes ─────────────────────────────
  // Pinning is built first so scratchpad can take its callbacks; pinning's
  // own callbacks resolve scratchpadApi lazily through a getter.
  pinningApi = initPinning(wysiwyg, {
    getMode:          () => currentMode,
    getPostId:        () => POST_ID,
    getScratchpadApi: () => scratchpadApi,
    repositionMargin: () => marginApi && marginApi.reposition(),
    onChanged,
  });

  scratchpadApi = initScratchpad(scratchpadPanel, {
    onClose:        () => setScratchpad(false),
    onPinClick:     pinningApi.handlePinClick,
    isOrphan:       pinningApi.isOrphanNote,
    canPin:         pinningApi.canPinNow,
    onNotesChanged: () => marginApi && marginApi.reposition(),
    endpoint:       POST_ID > 0 ? `/admin/posts/${POST_ID}/scratchpad` : null,
    getPostId:      () => POST_ID,
  });

  marginApi = initMarginNotes(marginContainer, {
    getEditorEl: () => wysiwyg,
    getColumnEl: () => zenColumn,
    getPostId:   () => POST_ID,
    getNotes:    () => scratchpadApi.getNotes(),
    getMode:     () => currentMode,
    onClickNote: (id) => { setScratchpad(true); scratchpadApi.focusNote(id); },
    onUnpin:     (id) => pinningApi.doUnpin(id),
  });

  // ── Side panel toggles ──────────────────────────────────────────────
  function setOutline(on) {
    outlinePanel.hidden = !on;
    if (outlineBtn) {
      outlineBtn.classList.toggle('is-active', on);
      outlineBtn.setAttribute('aria-pressed', String(on));
    }
    localStorage.setItem('bloggy-outline', on ? '1' : '0');
    if (on) outlineApi.refresh();
  }
  function setScratchpad(on) {
    scratchpadPanel.hidden = !on;
    if (scratchpadBtn) {
      scratchpadBtn.classList.toggle('is-active', on);
      scratchpadBtn.setAttribute('aria-pressed', String(on));
    }
    localStorage.setItem('bloggy-scratchpad', on ? '1' : '0');
    if (on && scratchpadApi.onShow) scratchpadApi.onShow();
  }
  outlineBtn    && outlineBtn.addEventListener('click',    () => setOutline(outlinePanel.hidden));
  scratchpadBtn && scratchpadBtn.addEventListener('click', () => setScratchpad(scratchpadPanel.hidden));

  // ── Mode switching ──────────────────────────────────────────────────
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
    wysiwyg.style.display    = mode === 'wysiwyg'  ? '' : 'none';
    mdTextarea.style.display = mode === 'markdown' ? '' : 'none';
    document.getElementById('btn-write').setAttribute('aria-pressed', String(mode === 'wysiwyg'));
    document.getElementById('btn-md').setAttribute('aria-pressed',    String(mode === 'markdown'));
    if (mode === 'markdown') autoResizeMd();
    updateStats();
    refreshOutlineIfOpen();
    repositionMargin();
    scratchpadApi.refresh();
    chromeApi.bumpActivity();
  }
  window.setMode = setMode;

  // ── Editor input listeners ──────────────────────────────────────────
  wysiwyg.addEventListener('input', () => {
    updateEmptyState();
    updateStats();
    autosaveApi.schedule();
    chromeApi.doTypewriterScroll();
    refreshOutlineIfOpen();
    repositionMargin();
    scratchpadApi.refresh();
  });

  mdTextarea.addEventListener('input', () => {
    autoResizeMd();
    updateStats();
    autosaveApi.schedule();
    chromeApi.doTypewriterScroll();
    refreshOutlineIfOpen();
  });
  mdTextarea.addEventListener('keydown', e => {
    if (e.key !== 'Tab') return;
    e.preventDefault();
    const s = e.target.selectionStart;
    e.target.value = e.target.value.slice(0, s) + '  ' + e.target.value.slice(e.target.selectionEnd);
    e.target.selectionStart = e.target.selectionEnd = s + 2;
    autosaveApi.schedule();
  });

  titleInput.addEventListener('input', () => {
    document.title = titleInput.value || 'Untitled';
    autosaveApi.schedule();
  });

  // ── Form submission ─────────────────────────────────────────────────
  window.submitPost = function (action) {
    document.getElementById('content-input').value = getMdContent();
    document.getElementById('action-input').value  = action;
    // tags-input is already kept in sync by tags.js
    postForm.submit();
  };

  // ── Keyboard shortcuts ──────────────────────────────────────────────
  document.addEventListener('keydown', e => {
    const mod = e.metaKey || e.ctrlKey;
    if (!mod) return;

    if (e.key === '.')                      { e.preventDefault(); chromeApi.toggleFocusMode(); }
    if (e.key === '/' || e.key === '\\')    { e.preventDefault(); chromeApi.toggleToolbar(); }
    if (e.key === '[')                      { e.preventDefault(); setOutline(outlinePanel.hidden); }
    if (e.key === ']')                      { e.preventDefault(); setScratchpad(scratchpadPanel.hidden); }
    if (e.key.toLowerCase() === 'l' && e.shiftKey) { e.preventDefault(); chromeApi.cycleTheme(); }
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

  // ── Initial settings load ───────────────────────────────────────────
  chromeApi.loadSettings();
  if (window.EDITOR_TAGS) tagsApi.loadFromCSV(window.EDITOR_TAGS);
  if (localStorage.getItem('bloggy-outline')    === '1') setOutline(true);
  if (localStorage.getItem('bloggy-scratchpad') === '1') setScratchpad(true);

  // Margin notes overlay needs an initial pass once the wysiwyg content
  // and the notes list are both in place.
  repositionMargin();
  scratchpadApi.refresh();
})();
