// scratchpad.js — Post-it style notes that live next to the document.
// Persisted separately in localStorage so they don't follow the post on export.
//
// Call initScratchpad(panelEl, { onClose })

function initScratchpad(panel, opts) {
  const onClose = (opts && opts.onClose) || function () {};

  const COLORS = [
    { id: 'amber', bg: '#f5d97a', ink: '#3a2a08' },
    { id: 'mint',  bg: '#cee5c8', ink: '#1f3a1c' },
    { id: 'peach', bg: '#f3c9aa', ink: '#3a2014' },
    { id: 'sky',   bg: '#c8d9e8', ink: '#1d2a3a' },
    { id: 'lilac', bg: '#d9c8e3', ink: '#2d1f3a' },
    { id: 'ivory', bg: '#efe5cc', ink: '#3a2f15' },
  ];
  const colorOf = (id) => COLORS.find(c => c.id === id) || COLORS[0];

  const KEY = 'bloggy.scratchpad.v1';
  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : null;
    } catch (_) { return null; }
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(notes)); } catch (_) {}
  }
  function nid() { return 'n_' + Math.random().toString(36).slice(2, 9); }

  function seed() {
    return [
      { id: nid(), color: 'amber', tilt: -1.2, text: 'An anchor thought.\n\nThe work isn’t to write something good. The work is to sit down.' },
      { id: nid(), color: 'mint',  tilt:  0.8, text: '— mention the 4–5pm hour\n— the chipped cup detail\n— the doorway metaphor' },
      { id: nid(), color: 'peach', tilt: -0.5, text: 'Cut?\n\nThe paragraph about the fridge. Too literal.' },
    ];
  }

  let notes = load();
  if (notes === null) notes = seed();

  panel.innerHTML = `
    <header class="side-head">
      <span class="side-title">Scratchpad</span>
      <div class="side-head-actions">
        <button type="button" class="side-action" id="sp-add-note" title="New note">+ Note</button>
        <button type="button" class="side-x" title="Close" aria-label="Close scratchpad">×</button>
      </div>
    </header>
    <div class="side-sub">Parking lot for stray thoughts. Stays here when you export.</div>
    <div class="postit-stack"></div>
  `;

  const stack    = panel.querySelector('.postit-stack');
  const addBtn   = panel.querySelector('#sp-add-note');
  const closeBtn = panel.querySelector('.side-x');

  addBtn.addEventListener('click', addNote);
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
  function clearDropTargets() {
    stack.querySelectorAll('.is-drop-target, .is-drop-target-after')
      .forEach(el => el.classList.remove('is-drop-target', 'is-drop-target-after'));
  }
  function bindDrag(node, idx) {
    node.draggable = true;
    node.addEventListener('dragstart', (e) => {
      dragIdx = idx;
      node.classList.add('is-dragging');
      try { e.dataTransfer.setData('text/plain', String(idx)); } catch (_) {}
      e.dataTransfer.effectAllowed = 'move';
    });
    node.addEventListener('dragend', () => {
      node.classList.remove('is-dragging');
      clearDropTargets();
      dragIdx = -1;
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
    if (notes.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'side-empty';
      empty.innerHTML = `
        <p>No notes yet.</p>
        <p class="side-empty-sub">
          <span class="side-link" id="sp-add-link">Add one</span> when a thought wants somewhere to land.
        </p>
      `;
      stack.appendChild(empty);
      const lk = empty.querySelector('#sp-add-link');
      lk.addEventListener('click', addNote);
      return;
    }

    notes.forEach((n, i) => {
      const c = colorOf(n.color);
      const node = document.createElement('div');
      node.className = 'postit';
      node.style.setProperty('--note-bg', c.bg);
      node.style.setProperty('--note-ink', c.ink);
      node.style.setProperty('--note-tilt', `${n.tilt}deg`);
      node.style.transform = `rotate(${n.tilt}deg)`;
      node.innerHTML = `
        <span class="postit-grip" title="Drag to reorder" aria-hidden="true"></span>
        <button type="button" class="postit-x" title="Delete note" aria-label="Delete note">×</button>
        <textarea class="postit-input" rows="3" spellcheck="true"
          placeholder="A thought, an idea, a thing to remember…"></textarea>
      `;
      const ta = node.querySelector('.postit-input');
      ta.value = n.text;
      ta.addEventListener('input', () => { grow(ta); updateText(n.id, ta.value); });
      // Don't initiate drag from inside the textarea — preserve text selection.
      ta.addEventListener('mousedown', (e) => e.stopPropagation());
      ta.addEventListener('dragstart', (e) => e.preventDefault());
      node.querySelector('.postit-x').addEventListener('click', () => deleteNote(n.id));
      bindDrag(node, i);
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

  render();
  return { onShow };
}
