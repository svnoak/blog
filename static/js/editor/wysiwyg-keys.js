// wysiwyg-keys.js — Editor keyboard behavior:
//   • Markdown shortcuts on space:   `# `, `## `, `### `, `> `, `- ` / `* `, `1. `
//   • Enter / ArrowDown escapes from headings, blockquotes, and <pre> blocks.
//   • Backspace / Delete removes an adjacent <hr> when the cursor is empty
//     at the edge of a block.
//   • Paste is forced to plain text.
//
// initWysiwygKeys(wysiwyg, opts)
//
// opts: { onChanged() }  // fired after structural edits (HR removal) so the
//                        // host can update stats + schedule autosave.

function initWysiwygKeys(wysiwyg, opts) {
  const { onChanged } = opts || {};
  const notify = () => { onChanged && onChanged(); };

  // ── Markdown shortcuts on space ─────────────────────────────────────
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

  // ── Enter / ArrowDown: escape from headings, blockquotes, and <pre> ─
  wysiwyg.addEventListener('keydown', e => {
    if ((e.key !== 'Enter' && e.key !== 'ArrowDown') || e.shiftKey) return;
    const sel = window.getSelection();
    if (!sel.rangeCount) return;

    let blockEl = sel.anchorNode;
    while (blockEl && blockEl.parentNode !== wysiwyg) blockEl = blockEl.parentNode;
    if (!blockEl || blockEl === wysiwyg) return;
    const tag = blockEl.tagName ? blockEl.tagName.toUpperCase() : '';

    // BLOCKQUOTE: Enter adds a line within; empty-line Enter or last-line
    // ArrowDown exits to a new paragraph.
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

    // <pre>: Enter at the very end exits to a new paragraph.
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

    // Headings: Enter that produces an empty heading → convert to paragraph.
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

  // ── Backspace / Delete: remove <hr> adjacent to an empty caret ─────
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
      if (prev && prev.tagName === 'HR') { e.preventDefault(); prev.remove(); notify(); }
    } else {
      const r = document.createRange();
      try { r.selectNodeContents(blockEl); r.setStart(range.startContainer, range.startOffset); } catch (_) { return; }
      if (r.toString() !== '') return;
      const next = blockEl.nextElementSibling;
      if (next && next.tagName === 'HR') { e.preventDefault(); next.remove(); notify(); }
    }
  });

  // ── Plain-text paste ────────────────────────────────────────────────
  wysiwyg.addEventListener('paste', e => {
    const text = (e.clipboardData || window.clipboardData).getData('text/plain');
    if (text) { e.preventDefault(); document.execCommand('insertText', false, text); }
  });
}
