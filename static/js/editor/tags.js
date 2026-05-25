// tags.js — Tag chips above the title input: add via Enter/comma, remove via
// Backspace or the × button, and keep the hidden #tags-input in sync.
//
// initTags(rowEl, inputEl, hiddenEl, opts) -> { addTag, loadFromCSV }
//
// opts: { onChanged() }

function initTags(rowEl, inputEl, hiddenEl, opts) {
  const { onChanged } = opts || {};
  const tags = []; // [{ name, slug }]

  function slugify(s) {
    return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }

  function syncHidden() {
    hiddenEl.value = tags.map(t => t.name).join(', ');
  }

  function render() {
    rowEl.querySelectorAll('.tag-chip-editor').forEach(c => c.remove());
    tags.forEach((tag, i) => {
      const chip = document.createElement('span');
      chip.className = 'tag-chip-editor';
      chip.innerHTML =
        '<span class="tag-chip-editor-hash">#</span>' +
        '<span class="tag-chip-editor-name"></span>' +
        '<button type="button" class="tag-chip-editor-remove" aria-label="Remove tag">×</button>';
      chip.querySelector('.tag-chip-editor-name').textContent = tag.name;
      chip.querySelector('.tag-chip-editor-remove').addEventListener('click', () => {
        tags.splice(i, 1);
        render();
        syncHidden();
        onChanged && onChanged();
      });
      rowEl.insertBefore(chip, inputEl);
    });
    syncHidden();
  }

  function addTag(raw) {
    const name = raw.trim().replace(/,+$/, '').trim();
    const slug = slugify(name);
    if (!slug || tags.some(t => t.slug === slug)) return;
    tags.push({ name, slug });
    render();
    onChanged && onChanged();
  }

  function loadFromCSV(csv) {
    if (!csv) return;
    csv.split(',').forEach(n => { if (n.trim()) addTag(n); });
  }

  if (inputEl) {
    inputEl.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ',') {
        e.preventDefault();
        if (inputEl.value.trim()) addTag(inputEl.value);
        inputEl.value = '';
      }
      if (e.key === 'Backspace' && inputEl.value === '' && tags.length > 0) {
        tags.pop();
        render();
        syncHidden();
        onChanged && onChanged();
      }
    });
    inputEl.addEventListener('blur', () => {
      if (inputEl.value.trim()) { addTag(inputEl.value); inputEl.value = ''; }
    });
  }

  return { addTag, loadFromCSV };
}
