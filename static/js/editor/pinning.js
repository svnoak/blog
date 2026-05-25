// pinning.js — Pin scratchpad notes to editor blocks.
//
// Owns the data-anchor-id attribute on top-level editor blocks, tracks which
// block the caret is in (so the pin button knows where to attach), and wires
// the drag-from-scratchpad-onto-block drop flow.
//
// initPinning(wysiwyg, opts) -> {
//   canPinNow, isOrphanNote, handlePinClick, doUnpin
// }
//
// opts: {
//   getMode, getPostId,
//   getScratchpadApi,           // resolved lazily; scratchpadApi is built
//                               //   *after* this module so callbacks can refer
//                               //   back to handlePinClick / isOrphanNote.
//   repositionMargin, onChanged,
// }

function initPinning(wysiwyg, opts) {
  const { getMode, getPostId, getScratchpadApi, repositionMargin, onChanged } = opts;
  const fire = () => { onChanged && onChanged(); };

  // ── Caret tracking ──────────────────────────────────────────────────
  // The .is-focused class already tracks the focused block for focus mode;
  // we shadow it here so the pin button still knows the target after focus
  // moves to the scratchpad panel.
  let lastFocusedBlock = null;
  document.addEventListener('selectionchange', () => {
    if (getMode() !== 'wysiwyg') return;
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;
    let n = sel.getRangeAt(0).startContainer;
    if (!wysiwyg.contains(n)) return;
    while (n && n.parentNode !== wysiwyg) n = n.parentNode;
    if (n && n !== wysiwyg) lastFocusedBlock = n;
  });

  // ── Anchor helpers ──────────────────────────────────────────────────
  function genAnchorId() {
    let id;
    const existing = new Set([...wysiwyg.querySelectorAll('[data-anchor-id]')]
      .map(el => el.dataset.anchorId));
    do { id = 'a' + Math.random().toString(36).slice(2, 7); } while (existing.has(id));
    return id;
  }

  function blockExistsForAnchor(anchorId) {
    return !!wysiwyg.querySelector(`[data-anchor-id="${anchorId}"]`);
  }

  function isOrphanNote(note) {
    if (!note.anchor) return false;
    if (note.anchor.postId !== getPostId()) return false;
    return !blockExistsForAnchor(note.anchor.anchorId);
  }

  function canPinNow() { return getPostId() > 0; }

  function isPinnableBlock(el) {
    const tag = el.tagName;
    return tag === 'P' || tag === 'H1' || tag === 'H2' || tag === 'H3' || tag === 'BLOCKQUOTE';
  }

  function findBlockFromEvent(e) {
    let n = e.target;
    while (n && n.parentNode !== wysiwyg) n = n.parentNode;
    if (!n || n === wysiwyg) return null;
    return n;
  }

  // ── Pin / unpin ─────────────────────────────────────────────────────
  function pinNoteToBlock(noteId, block) {
    if (!canPinNow()) {
      alert('Save the post once before pinning notes.');
      return;
    }
    if (!block) return;
    const scratchpadApi = getScratchpadApi();
    const postId = getPostId();
    let anchorId = block.dataset.anchorId;
    if (!anchorId) {
      anchorId = genAnchorId();
      block.dataset.anchorId = anchorId;
    } else {
      // Any other note currently pointing here gets evicted.
      scratchpadApi.getNotes().forEach(n => {
        if (n.id !== noteId && n.anchor &&
            n.anchor.postId === postId && n.anchor.anchorId === anchorId) {
          scratchpadApi.setAnchor(n.id, null);
        }
      });
    }
    // If the note was pinned elsewhere before, clear that block's anchor.
    const prev = scratchpadApi.getNoteById(noteId);
    if (prev && prev.anchor && prev.anchor.anchorId !== anchorId) {
      const old = wysiwyg.querySelector(`[data-anchor-id="${prev.anchor.anchorId}"]`);
      if (old) delete old.dataset.anchorId;
    }
    scratchpadApi.setAnchor(noteId, { postId, anchorId });
    fire();
    repositionMargin();
  }

  function doUnpin(noteId) {
    const scratchpadApi = getScratchpadApi();
    const n = scratchpadApi.getNoteById(noteId);
    if (!n || !n.anchor) return;
    const block = wysiwyg.querySelector(`[data-anchor-id="${n.anchor.anchorId}"]`);
    if (block) delete block.dataset.anchorId;
    scratchpadApi.setAnchor(noteId, null);
    fire();
    repositionMargin();
  }

  function handlePinClick(noteId) {
    const scratchpadApi = getScratchpadApi();
    const n = scratchpadApi.getNoteById(noteId);
    if (!n) return;
    if (n.anchor) { doUnpin(noteId); return; }
    if (!canPinNow()) {
      alert('Save the post once before pinning notes.');
      return;
    }
    if (getMode() !== 'wysiwyg') {
      alert('Switch to Write mode to pin a note to a paragraph.');
      return;
    }
    if (!lastFocusedBlock || !wysiwyg.contains(lastFocusedBlock)) {
      alert('Click into a paragraph in the editor first, then click the pin.');
      return;
    }
    if (!isPinnableBlock(lastFocusedBlock)) {
      alert('Pinning is supported on paragraphs, headings, and quotes.');
      return;
    }
    pinNoteToBlock(noteId, lastFocusedBlock);
  }

  // ── Drag-to-pin ─────────────────────────────────────────────────────
  function clearPinTargets() {
    wysiwyg.querySelectorAll('.is-pin-target').forEach(el => el.classList.remove('is-pin-target'));
  }

  wysiwyg.addEventListener('dragover', e => {
    if (!getScratchpadApi().getDraggedNoteId()) return;
    if (getMode() !== 'wysiwyg') return;
    const block = findBlockFromEvent(e);
    if (!block || !isPinnableBlock(block)) { clearPinTargets(); return; }
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    clearPinTargets();
    block.classList.add('is-pin-target');
  });

  wysiwyg.addEventListener('drop', e => {
    const noteId = getScratchpadApi().getDraggedNoteId();
    if (!noteId) return;
    if (getMode() !== 'wysiwyg') return;
    const block = findBlockFromEvent(e);
    if (!block || !isPinnableBlock(block)) { clearPinTargets(); return; }
    e.preventDefault();
    clearPinTargets();
    pinNoteToBlock(noteId, block);
  });

  // While a note is being dragged, swallow the browser's default drop on
  // anything that isn't an editor block. Without this, dropping on the title
  // or tag input would let the browser insert the note's serialized payload,
  // and dropping on empty editor space would leave the .is-pin-target outline
  // behind.
  window.addEventListener('dragover', e => {
    if (!getScratchpadApi().getDraggedNoteId()) return;
    e.preventDefault();
  });
  window.addEventListener('drop', e => {
    if (!getScratchpadApi().getDraggedNoteId()) return;
    e.preventDefault();
  });
  window.addEventListener('dragend', clearPinTargets);

  return { canPinNow, isOrphanNote, handlePinClick, doUnpin };
}
