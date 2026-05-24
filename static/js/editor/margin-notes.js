// margin-notes.js — Floats pinned scratchpad notes in the right margin of the
// editor, aligned vertically with the block they're anchored to.
//
// initMarginNotes(container, {
//   getEditorEl, getColumnEl, getPostId, getNotes, getMode,
//   onClickNote(noteId), onUnpin(noteId)
// }) -> { reposition() }

function initMarginNotes(container, opts) {
  const { getEditorEl, getColumnEl, getPostId, getNotes, getMode,
          onClickNote, onUnpin } = opts;

  let rafPending = false;
  function schedule() {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(() => { rafPending = false; render(); });
  }

  function anchoredBlocks() {
    const root = getEditorEl();
    if (!root) return [];
    return [...root.children].filter(el => el.dataset && el.dataset.anchorId);
  }

  function findNote(anchorId) {
    const postId = getPostId();
    return getNotes().find(n =>
      n.anchor && n.anchor.postId === postId && n.anchor.anchorId === anchorId
    );
  }

  function render() {
    container.innerHTML = '';
    if (getMode() !== 'wysiwyg') return;
    const col = getColumnEl();
    if (!col) return;
    const colRect = col.getBoundingClientRect();
    const vw = window.innerWidth;
    const gap = 24;
    const left = colRect.right + gap;
    const room = vw - left - 16;
    const useDots = room < 200;
    const noteW = Math.max(160, Math.min(240, room));

    anchoredBlocks().forEach(block => {
      const note = findNote(block.dataset.anchorId);
      if (!note) return;
      const rect = block.getBoundingClientRect();
      const top = rect.top + window.scrollY;

      if (useDots) {
        const dot = document.createElement('button');
        dot.type = 'button';
        dot.className = 'margin-note-dot';
        dot.style.top  = `${top + Math.min(rect.height / 2, 14)}px`;
        dot.style.left = `${rect.right + window.scrollX + 6}px`;
        dot.style.setProperty('--note-bg', colorBg(note.color));
        dot.title = previewText(note.text) || 'Pinned note';
        dot.addEventListener('click', (e) => { e.stopPropagation(); onClickNote(note.id); });
        container.appendChild(dot);
        return;
      }

      const el = document.createElement('div');
      el.className = 'margin-note';
      el.style.top = `${top}px`;
      el.style.left = `${left + window.scrollX}px`;
      el.style.width = `${noteW}px`;
      el.style.setProperty('--note-bg', colorBg(note.color));
      el.style.setProperty('--note-ink', colorInk(note.color));
      el.innerHTML = `
        <button type="button" class="margin-note-unpin" title="Unpin from this paragraph" aria-label="Unpin">×</button>
        <div class="margin-note-body"></div>
      `;
      el.querySelector('.margin-note-body').textContent = note.text || '(empty note)';
      el.querySelector('.margin-note-unpin').addEventListener('click', (e) => {
        e.stopPropagation();
        onUnpin(note.id);
      });
      el.addEventListener('click', () => onClickNote(note.id));
      container.appendChild(el);
    });
  }

  // Same palette as scratchpad.js — duplicated to keep this module standalone.
  const COLORS = {
    amber: { bg: '#f5d97a', ink: '#3a2a08' },
    mint:  { bg: '#cee5c8', ink: '#1f3a1c' },
    peach: { bg: '#f3c9aa', ink: '#3a2014' },
    sky:   { bg: '#c8d9e8', ink: '#1d2a3a' },
    lilac: { bg: '#d9c8e3', ink: '#2d1f3a' },
    ivory: { bg: '#efe5cc', ink: '#3a2f15' },
  };
  function colorBg(id) { return (COLORS[id] || COLORS.amber).bg; }
  function colorInk(id) { return (COLORS[id] || COLORS.amber).ink; }
  function previewText(s) {
    s = (s || '').trim().split('\n')[0];
    return s.length > 60 ? s.slice(0, 57) + '…' : s;
  }

  window.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('resize', schedule);

  return { reposition: schedule, render };
}
