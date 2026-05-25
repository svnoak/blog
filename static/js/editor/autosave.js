// autosave.js — Debounced background save (2s after the last edit). POSTs the
// editor content + title + tags to the form action; on the first save of a new
// post, picks up the server-assigned ID from the redirect URL.
//
// initAutosave(opts) -> { schedule, run }
//
// opts: {
//   getPostId, getFormAction,
//   getTitle, getContent, getTags,
//   postForm,                       // form element (its .action is updated on promotion)
//   saveDot, saveLabel,
//   onPostCreated(newId, newFormAction),
// }

function initAutosave(opts) {
  const {
    getPostId, getFormAction,
    getTitle, getContent, getTags,
    postForm, saveDot, saveLabel,
    onPostCreated,
  } = opts;

  let saveTimer  = null;
  let tickTimer  = null;
  let lastSaved  = null;

  function schedule() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(run, 2000);
  }

  function agoText() {
    if (!lastSaved) return 'Draft';
    const secs = Math.floor((Date.now() - lastSaved) / 1000);
    if (secs < 10) return 'Saved just now';
    if (secs < 60) return `Saved ${secs}s ago`;
    const mins = Math.floor(secs / 60);
    if (mins < 60) return `Saved ${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    return `Saved ${hrs}h ago`;
  }

  function startTick() {
    clearInterval(tickTimer);
    tickTimer = setInterval(() => {
      if (lastSaved) saveLabel.textContent = agoText();
    }, 15000);
  }

  function run() {
    const title   = getTitle();
    const content = getContent();
    if (!getPostId() && !title.trim() && !content.trim()) return;
    const data = new FormData();
    data.append('content', content);
    data.append('title',   title);
    data.append('tags',    getTags());
    data.append('action',  'save');
    saveDot.classList.add('saving');
    saveLabel.textContent = 'Saving…';
    fetch(getFormAction(), { method: 'POST', body: data })
      .then(r => {
        saveDot.classList.remove('saving');
        if (r.ok || r.redirected) {
          if (!getPostId() && r.redirected) {
            const match = r.url.match(/\/admin\/posts\/(\d+)\/edit/);
            if (match) {
              const newId = parseInt(match[1], 10);
              const newAction = `/admin/posts/${newId}`;
              postForm.action = newAction;
              history.pushState({}, '', r.url);
              onPostCreated && onPostCreated(newId, newAction);
            }
          }
          lastSaved = Date.now();
          saveLabel.textContent = 'Saved just now';
          startTick();
        }
      })
      .catch(() => {
        saveDot.classList.remove('saving');
        saveLabel.textContent = lastSaved ? agoText() : 'Draft';
      });
  }

  return { schedule, run };
}
