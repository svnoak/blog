// scratchpad.js — Post-it style notes that live next to the document.
// Persisted server-side per (post, user) — they don't follow the post on export.
//
// Call initScratchpad(panelEl, { onClose, endpoint, getPostId, ... })

function initScratchpad(panel, opts) {
  const onClose         = (opts && opts.onClose)         || function () {};
  const onPinClick      = (opts && opts.onPinClick)      || function () {};
  const isOrphan        = (opts && opts.isOrphan)        || function () { return false; };
  const canPin          = (opts && opts.canPin)          || function () { return true; };
  const onNotesChanged  = (opts && opts.onNotesChanged)  || function () {};
  const endpoint        = (opts && opts.endpoint)        || null;   // null = ephemeral (new-post)
  const getPostId       = (opts && opts.getPostId)       || function () { return 0; };

  const COLORS = [
    { id: 'amber', bg: '#f5d97a', ink: '#3a2a08' },
    { id: 'mint',  bg: '#cee5c8', ink: '#1f3a1c' },
    { id: 'peach', bg: '#f3c9aa', ink: '#3a2014' },
    { id: 'sky',   bg: '#c8d9e8', ink: '#1d2a3a' },
    { id: 'lilac', bg: '#d9c8e3', ink: '#2d1f3a' },
    { id: 'ivory', bg: '#efe5cc', ink: '#3a2f15' },
  ];
  const colorOf = (id) => COLORS.find(c => c.id === id) || COLORS[0];

  let notes = [];
  let loaded = endpoint === null;     // ephemeral mode is "loaded" immediately
  let saveTimer = null;
  let pendingSave = false;
  let inFlight = false;

  function nid() { return 'n_' + Math.random().toString(36).slice(2, 9); }

  // Server <-> in-memory shape conversion.
  //   server:  { id, color, tilt, text, anchorId? }
  //   memory:  { id, color, tilt, text, anchor?: { postId, anchorId } }
  function fromServer(arr) {
    if (!Array.isArray(arr)) return [];
    const pid = getPostId();
    return arr.map(n => {
      const note = {
        id:    n.id,
        color: n.color || 'amber',
        tilt:  typeof n.tilt === 'number' ? n.tilt : 0,
        text:  n.text  || '',
      };
      if (n.anchorId) note.anchor = { postId: pid, anchorId: n.anchorId };
      return note;
    });
  }
  function toServer(arr) {
    return arr.map(n => {
      const out = { id: n.id, color: n.color, tilt: n.tilt, text: n.text };
      if (n.anchor && n.anchor.anchorId) out.anchorId = n.anchor.anchorId;
      return out;
    });
  }

  async function loadFromServer() {
    if (!endpoint) { loaded = true; return; }
    try {
      const res = await fetch(endpoint, { credentials: 'same-origin' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      notes = fromServer(data);
    } catch (err) {
      console.warn('scratchpad: load failed', err);
      notes = [];
    }
    loaded = true;
  }

  async function flushSave() {
    if (!endpoint) return;
    if (inFlight) { pendingSave = true; return; }
    inFlight = true;
    pendingSave = false;
    try {
      const res = await fetch(endpoint, {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(toServer(notes)),
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
    } catch (err) {
      console.warn('scratchpad: save failed', err);
    } finally {
      inFlight = false;
      if (pendingSave) flushSave();
    }
  }

  function save() {
    onNotesChanged();
    if (!endpoint) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flushSave, 700);
  }

  const canEdit = endpoint !== null;
  panel.innerHTML = `
    <header class="side-head">
      <span class="side-title">Scratchpad</span>
      <div class="side-head-actions">
        <button type="button" class="side-action" id="sp-add-note" title="${canEdit ? 'New note' : 'Save the post once before jotting notes'}" ${canEdit ? '' : 'disabled'}>+ Note</button>
        <button type="button" class="side-x" title="Close" aria-label="Close scratchpad">×</button>
      </div>
    </header>
    <div class="side-sub">Parking lot for stray thoughts. Stays here when you export.</div>
    <div class="postit-stack"></div>
  `;

  const stack    = panel.querySelector('.postit-stack');
  const addBtn   = panel.querySelector('#sp-add-note');
  const closeBtn = panel.querySelector('.side-x');

  if (canEdit) addBtn.addEventListener('click', addNote);
  closeBtn.addEventListener('click', onClose);

  function addNote() {
    const color = COLORS[notes.length % COLORS.length].id;
    const tilt  = +(Math.random() * 3 - 1.5).toFixed(2);
    notes.unshift({ id: nid(), color, tilt, text: '' });
    save();
    render();
    // Focus the new note for typing
    const first = stack.querySelector('.postit-input');
    if (first) first.focus();
  }
  function deleteNote(id) {
    notes = notes.filter(n => n.id !== id);
    save();
    render();
  }
  function updateText(id, text) {
    const n = notes.find(x => x.id === id);
    if (!n) return;
    n.text = text;
    save();
  }
  function setColor(id, colorId) {
    const n = notes.find(x => x.id === id);
    if (!n) return;
    n.color = colorId;
    save();
    render();
  }
  function setAnchor(id, anchor) {
    const n = notes.find(x => x.id === id);
    if (!n) return;
    if (anchor) n.anchor = anchor; else delete n.anchor;
    save();
    render();
  }
  function getNoteById(id) { return notes.find(n => n.id === id); }
  function focusNote(id) {
    render();
    const node = stack.querySelector(`.postit[data-note-id="${id}"]`);
    if (!node) return;
    node.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const ta = node.querySelector('.postit-input');
    if (ta) setTimeout(() => ta.focus(), 100);
  }
  function clearAll() {
    if (!confirm('Clear all scratchpad notes?')) return;
    notes = [];
    save();
    render();
  }

  function grow(ta) {
    ta.style.height = 'auto';
    ta.style.height = ta.scrollHeight + 'px';
  }

  // ── Drag-and-drop reordering ─────────────────────────────────────────────────
  let dragIdx = -1;
  let draggedNoteId = null;
  function clearDropTargets() {
    stack.querySelectorAll('.is-drop-target, .is-drop-target-after')
      .forEach(el => el.classList.remove('is-drop-target', 'is-drop-target-after'));
  }
  function bindDrag(node, idx, noteId) {
    node.draggable = true;
    node.addEventListener('dragstart', (e) => {
      dragIdx = idx;
      draggedNoteId = noteId;
      node.classList.add('is-dragging');
      // Custom MIME so editor-block drop targets can recognise our notes.
      // Note: we intentionally do NOT set text/plain — without it, accidental
      // drops on real inputs (title, tags) won't insert a stray value.
      try { e.dataTransfer.setData('application/x-bloggy-note', noteId); } catch (_) {}
      e.dataTransfer.effectAllowed = 'copyMove';
    });
    node.addEventListener('dragend', () => {
      node.classList.remove('is-dragging');
      clearDropTargets();
      dragIdx = -1;
      draggedNoteId = null;
    });
    node.addEventListener('dragover', (e) => {
      if (dragIdx < 0 || dragIdx === idx) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const rect = node.getBoundingClientRect();
      const after = (e.clientY - rect.top) > rect.height / 2;
      clearDropTargets();
      node.classList.add(after ? 'is-drop-target-after' : 'is-drop-target');
    });
    node.addEventListener('drop', (e) => {
      e.preventDefault();
      if (dragIdx < 0) return;
      const rect = node.getBoundingClientRect();
      const after = (e.clientY - rect.top) > rect.height / 2;
      let target = after ? idx + 1 : idx;
      const [moved] = notes.splice(dragIdx, 1);
      if (dragIdx < target) target -= 1;
      notes.splice(target, 0, moved);
      save();
      dragIdx = -1;
      render();
    });
  }

  function render() {
    stack.innerHTML = '';
    if (!loaded) {
      const wait = document.createElement('div');
      wait.className = 'side-empty';
      wait.innerHTML = '<p>Loading notes…</p>';
      stack.appendChild(wait);
      return;
    }
    if (notes.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'side-empty';
      const sub = endpoint
        ? '<span class="side-link" id="sp-add-link">Add one</span> when a thought wants somewhere to land.'
        : 'Save the post once before jotting notes here.';
      empty.innerHTML = `
        <p>No notes yet.</p>
        <p class="side-empty-sub">${sub}</p>
      `;
      stack.appendChild(empty);
      const lk = empty.querySelector('#sp-add-link');
      if (lk) lk.addEventListener('click', addNote);
      return;
    }

    notes.forEach((n, i) => {
      const c = colorOf(n.color);
      const pinned   = !!n.anchor;
      const orphaned = pinned && isOrphan(n);
      const pinAllowed = canPin();
      const node = document.createElement('div');
      node.className = 'postit' + (pinned ? ' is-pinned' : '') + (orphaned ? ' is-orphaned' : '');
      node.dataset.noteId = n.id;
      node.style.setProperty('--note-bg', c.bg);
      node.style.setProperty('--note-ink', c.ink);
      node.style.setProperty('--note-tilt', `${n.tilt}deg`);
      node.style.transform = `rotate(${n.tilt}deg)`;
      const swatches = COLORS.map(col => `
        <button type="button" class="postit-color-swatch ${col.id === n.color ? 'is-active' : ''}"
                data-color="${col.id}"
                style="background:${col.bg}"
                title="${col.id}" aria-label="Change to ${col.id}"></button>
      `).join('');

      const pinTitle = pinned
        ? (orphaned ? 'Anchor lost — click to unpin' : 'Unpin from paragraph')
        : (pinAllowed ? 'Pin to the current paragraph' : 'Save the post once before pinning');
      const orphanBadge = orphaned
        ? '<span class="postit-orphan-badge" title="The paragraph this note was pinned to no longer exists">anchor lost</span>'
        : '';

      node.innerHTML = `
        <button type="button" class="postit-color-btn"
                title="Change color" aria-label="Change color"
                aria-haspopup="true" aria-expanded="false"
                style="background:${c.bg}"></button>
        <div class="postit-color-pop" hidden role="menu">${swatches}</div>
        <span class="postit-grip" title="Drag to reorder or onto a paragraph to pin" aria-hidden="true"></span>
        <button type="button" class="postit-pin" title="${pinTitle}" aria-label="${pinTitle}" aria-pressed="${pinned}" ${(!pinned && !pinAllowed) ? 'disabled' : ''}>
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M10 2 L14 6 L11 7 L9 13 L7 11 L3 13 L5 9 L3 7 L9 5 Z"/>
          </svg>
        </button>
        <button type="button" class="postit-x" title="Delete note" aria-label="Delete note">×</button>
        <textarea class="postit-input" rows="3" spellcheck="true"
          placeholder="A thought, an idea, a thing to remember…"></textarea>
        ${orphanBadge}
      `;
      const ta = node.querySelector('.postit-input');
      ta.value = n.text;
      ta.addEventListener('input', () => { grow(ta); updateText(n.id, ta.value); });
      // Don't initiate drag from inside the textarea — preserve text selection.
      ta.addEventListener('mousedown', (e) => e.stopPropagation());
      ta.addEventListener('dragstart', (e) => e.preventDefault());
      node.querySelector('.postit-x').addEventListener('click', () => deleteNote(n.id));

      // Color picker
      const colorBtn = node.querySelector('.postit-color-btn');
      const colorPop = node.querySelector('.postit-color-pop');
      colorBtn.addEventListener('mousedown', (e) => e.stopPropagation());
      colorBtn.addEventListener('dragstart',  (e) => e.preventDefault());
      colorBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const wasOpen = !colorPop.hidden;
        // Close any other open popovers in the stack
        stack.querySelectorAll('.postit-color-pop').forEach(p => p.hidden = true);
        stack.querySelectorAll('.postit-color-btn').forEach(b => b.setAttribute('aria-expanded', 'false'));
        colorPop.hidden = wasOpen;
        colorBtn.setAttribute('aria-expanded', String(!wasOpen));
      });
      colorPop.addEventListener('mousedown', (e) => e.stopPropagation());
      colorPop.querySelectorAll('.postit-color-swatch').forEach(sw => {
        sw.addEventListener('click', (e) => {
          e.stopPropagation();
          setColor(n.id, sw.dataset.color);
        });
      });

      // Pin / unpin
      const pinBtn = node.querySelector('.postit-pin');
      if (pinBtn) {
        pinBtn.addEventListener('mousedown', (e) => e.stopPropagation());
        pinBtn.addEventListener('dragstart',  (e) => e.preventDefault());
        pinBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          onPinClick(n.id);
        });
      }

      bindDrag(node, i, n.id);
      stack.appendChild(node);
      grow(ta);
    });

    if (notes.length > 1) {
      const clear = document.createElement('button');
      clear.type = 'button';
      clear.className = 'postit-clear';
      clear.textContent = 'Clear all';
      clear.addEventListener('click', clearAll);
      stack.appendChild(clear);
    }
  }

  // Re-measure note heights when the panel becomes visible (textareas only
  // size correctly when they're rendered).
  function onShow() {
    stack.querySelectorAll('.postit-input').forEach(grow);
  }

  // Close any open color popovers on outside click / Escape.
  document.addEventListener('mousedown', () => {
    stack.querySelectorAll('.postit-color-pop:not([hidden])').forEach(p => p.hidden = true);
    stack.querySelectorAll('.postit-color-btn[aria-expanded="true"]')
      .forEach(b => b.setAttribute('aria-expanded', 'false'));
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    stack.querySelectorAll('.postit-color-pop:not([hidden])').forEach(p => p.hidden = true);
    stack.querySelectorAll('.postit-color-btn[aria-expanded="true"]')
      .forEach(b => b.setAttribute('aria-expanded', 'false'));
  });

  render();

  // Kick off the initial load. When it resolves, render + tell the embedder
  // (so margin notes / orphan checks reposition once notes are in memory).
  const ready = loadFromServer().then(() => {
    render();
    onNotesChanged();
  });

  return {
    onShow,
    refresh: render,
    getNotes: () => notes.slice(),
    getNoteById,
    setAnchor,
    focusNote,
    getDraggedNoteId: () => draggedNoteId,
    whenReady: () => ready,
  };
}
