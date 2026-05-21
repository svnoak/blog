// toolbar.js — Persistent formatting toolbar.
// Call initToolbar(containerEl, { getMode, getEditorEl, getMdEl }) once.

function initToolbar(container, { getMode, getEditorEl, getMdEl }) {
  const ICONS = {
    H1: `<svg width="15" height="14" viewBox="0 0 16 14"><text x="0" y="11" font-family="Newsreader,serif" font-weight="600" font-size="12" fill="currentColor">H<tspan font-size="7" baseline-shift="sub">1</tspan></text></svg>`,
    H2: `<svg width="15" height="14" viewBox="0 0 16 14"><text x="0" y="11" font-family="Newsreader,serif" font-weight="600" font-size="12" fill="currentColor">H<tspan font-size="7" baseline-shift="sub">2</tspan></text></svg>`,
    H3: `<svg width="15" height="14" viewBox="0 0 16 14"><text x="0" y="11" font-family="Newsreader,serif" font-weight="600" font-size="12" fill="currentColor">H<tspan font-size="7" baseline-shift="sub">3</tspan></text></svg>`,
    Bold:      `<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><text x="3" y="12" font-family="Newsreader,serif" font-weight="700" font-size="13">B</text></svg>`,
    Italic:    `<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><text x="4" y="12" font-family="Newsreader,serif" font-style="italic" font-weight="500" font-size="13">I</text></svg>`,
    Strike:    `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M3 8h10"/><path d="M5 5c0-1.5 1.4-2 3-2s3 .8 3 2M11 11c0 1.5-1.4 2-3 2s-3-.8-3-2"/></svg>`,
    Code:      `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 4 3 8l3 4M10 4l3 4-3 4"/></svg>`,
    List:      `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="3" cy="4" r=".9" fill="currentColor"/><circle cx="3" cy="8" r=".9" fill="currentColor"/><circle cx="3" cy="12" r=".9" fill="currentColor"/><path d="M6 4h7M6 8h7M6 12h7"/></svg>`,
    OL:        `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><text x="0.5" y="6.2" font-family="JetBrains Mono,monospace" font-size="5" fill="currentColor" stroke="none">1.</text><text x="0.5" y="13" font-family="JetBrains Mono,monospace" font-size="5" fill="currentColor" stroke="none">2.</text><path d="M6 4.5h7M6 11h7"/></svg>`,
    Quote:     `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 11.5c0-2 .5-3.5 2.5-4.5M3.5 11.5h2.5v-3H3.5v3zM9.5 11.5c0-2 .5-3.5 2.5-4.5M9.5 11.5H12v-3H9.5v3z"/></svg>`,
    Link:      `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M7 9.5a2.5 2.5 0 0 0 3.5 0L13 7a2.5 2.5 0 0 0-3.5-3.5L8 5M9 6.5a2.5 2.5 0 0 0-3.5 0L3 9a2.5 2.5 0 0 0 3.5 3.5L8 11"/></svg>`,
    CodeBlock: `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="12" height="10" rx="1.5"/><path d="M6 7 4.5 8 6 9M10 7l1.5 1L10 9"/></svg>`,
    Table:     `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><rect x="2" y="3.5" width="12" height="9" rx="1"/><path d="M2 7h12M2 10h12M8 3.5v9"/></svg>`,
    Hr:        `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M2 8h12"/><path d="M3 5h2M11 5h2M3 11h2M11 11h2" opacity=".4"/></svg>`,
  };

  function btn(icon, label, action, id = '') {
    return `<button type="button" class="zen-tb-btn" title="${label}" aria-label="${label}"${id ? ` id="${id}"` : ''}
      onmousedown="event.preventDefault()" onclick="${action}">${icon}</button>`;
  }
  function sep() { return `<span class="zen-tb-sep"></span>`; }
  function group(...btns) { return `<div class="zen-tb-group">${btns.join('')}</div>`; }

  container.innerHTML = `
    <div class="zen-toolbar chrome">
      <div class="zen-tb-inner">
        ${group(
          btn(ICONS.H1, 'Heading 1', "_tbCmd('heading','H1')", 'tb-h1'),
          btn(ICONS.H2, 'Heading 2', "_tbCmd('heading','H2')", 'tb-h2'),
          btn(ICONS.H3, 'Heading 3', "_tbCmd('heading','H3')", 'tb-h3'),
        )}
        ${sep()}
        ${group(
          btn(ICONS.Bold,   'Bold',          "_tbCmd('bold')",   'tb-bold'),
          btn(ICONS.Italic, 'Italic',        "_tbCmd('italic')", 'tb-italic'),
          btn(ICONS.Strike, 'Strikethrough', "_tbCmd('strike')"),
          btn(ICONS.Code,   'Inline code',   "_tbCmd('code')"),
        )}
        ${sep()}
        ${group(
          btn(ICONS.List,  'Bulleted list', "_tbCmd('ul')"),
          btn(ICONS.OL,    'Numbered list', "_tbCmd('ol')"),
          btn(ICONS.Quote, 'Quote',         "_tbCmd('quote')", 'tb-quote'),
        )}
        ${sep()}
        ${group(
          btn(ICONS.Link,      'Link',         "_tbLink()"),
          btn(ICONS.CodeBlock, 'Code block',   "_tbCmd('codeblock')"),
          btn(ICONS.Table,     'Insert table', "_tbCmd('table')"),
          btn(ICONS.Hr,        'Divider',      "_tbCmd('hr')"),
        )}
      </div>
    </div>
  `;

  // Active state refresh
  function refreshActive() {
    if (getMode() !== 'wysiwyg') {
      container.querySelectorAll('.zen-tb-btn').forEach(b => b.classList.remove('is-active'));
      return;
    }
    try {
      const block = (document.queryCommandValue('formatBlock') || '').toUpperCase();
      document.getElementById('tb-h1')     && document.getElementById('tb-h1').classList.toggle('is-active', block === 'H1');
      document.getElementById('tb-h2')     && document.getElementById('tb-h2').classList.toggle('is-active', block === 'H2');
      document.getElementById('tb-h3')     && document.getElementById('tb-h3').classList.toggle('is-active', block === 'H3');
      document.getElementById('tb-quote')  && document.getElementById('tb-quote').classList.toggle('is-active', block === 'BLOCKQUOTE');
      document.getElementById('tb-bold')   && document.getElementById('tb-bold').classList.toggle('is-active', document.queryCommandState('bold'));
      document.getElementById('tb-italic') && document.getElementById('tb-italic').classList.toggle('is-active', document.queryCommandState('italic'));
    } catch (_) {}
  }

  document.addEventListener('selectionchange', refreshActive);

  return { refreshActive };
}

// Global dispatch functions called by toolbar button onclick attributes
function _tbCmd(cmd, value) {
  const mode = window._editorGetMode && window._editorGetMode();
  if (mode === 'wysiwyg') {
    const el = document.getElementById('wysiwyg');
    if (!el) return;
    el.focus();
    const sel = window.getSelection();
    if (!sel.rangeCount || !el.contains(sel.anchorNode)) {
      const range = document.createRange();
      range.selectNodeContents(el); range.collapse(false);
      sel.removeAllRanges(); sel.addRange(range);
    }
    switch (cmd) {
      case 'heading': {
        const cur = (document.queryCommandValue('formatBlock') || '').toUpperCase();
        document.execCommand('formatBlock', false, cur === value ? 'P' : value);
        break;
      }
      case 'bold':      document.execCommand('bold'); break;
      case 'italic':    document.execCommand('italic'); break;
      case 'strike':    document.execCommand('strikethrough'); break;
      case 'ul':        document.execCommand('insertUnorderedList'); break;
      case 'ol':        document.execCommand('insertOrderedList'); break;
      case 'quote': {
        const cur = (document.queryCommandValue('formatBlock') || '').toUpperCase();
        document.execCommand('formatBlock', false, cur === 'BLOCKQUOTE' ? 'P' : 'BLOCKQUOTE');
        break;
      }
      case 'code': {
        const s = window.getSelection();
        if (!s.rangeCount) break;
        // Walk up to find if selection is already inside an inline <code>
        let codeNode = s.anchorNode;
        while (codeNode && codeNode !== el) {
          if (codeNode.nodeType === Node.ELEMENT_NODE && codeNode.tagName === 'CODE'
              && codeNode.parentNode && codeNode.parentNode.tagName !== 'PRE') {
            // Unwrap: replace <code> with its children
            const frag = document.createDocumentFragment();
            while (codeNode.firstChild) frag.appendChild(codeNode.firstChild);
            codeNode.parentNode.replaceChild(frag, codeNode);
            window._editorOnChange && window._editorOnChange();
            return;
          }
          codeNode = codeNode.parentNode;
        }
        const r = s.getRangeAt(0);
        const c = document.createElement('code');
        if (r.collapsed) { c.textContent = 'code'; r.insertNode(c); }
        else { try { r.surroundContents(c); } catch (_) {} }
        break;
      }
      case 'codeblock':
        document.execCommand('insertHTML', false, '<pre><code>// code…</code></pre><p><br></p>'); break;
      case 'hr':
        document.execCommand('insertHorizontalRule'); break;
      case 'table': {
        const cols = 3, rows = 3;
        const head = `<tr>${Array.from({length: cols}, (_, i) => `<th>Column ${i+1}</th>`).join('')}</tr>`;
        const body = Array.from({length: rows}, () =>
          `<tr>${Array.from({length: cols}, () => '<td>&nbsp;</td>').join('')}</tr>`
        ).join('');
        document.execCommand('insertHTML', false,
          `<table><thead>${head}</thead><tbody>${body}</tbody></table><p><br></p>`);
        break;
      }
    }
    window._editorOnChange && window._editorOnChange();
  } else {
    // Markdown mode: apply text-level transforms
    const ta = document.getElementById('md-editor');
    if (!ta) return;
    ta.focus();
    const s = ta.selectionStart, e = ta.selectionEnd;
    const val = ta.value;
    const sel = val.slice(s, e);

    const surround = (pre, suf, placeholder = '') => {
      const text = sel || placeholder;
      ta.value = val.slice(0, s) + pre + text + suf + val.slice(e);
      ta.selectionStart = s + pre.length;
      ta.selectionEnd = s + pre.length + text.length;
    };

    const linePrefix = (marker) => {
      const lineStart = val.lastIndexOf('\n', s - 1) + 1;
      const lineEnd = (() => { const i = val.indexOf('\n', e); return i === -1 ? val.length : i; })();
      const block = val.slice(lineStart, lineEnd);
      const replaced = block.split('\n').map(l =>
        marker + l.replace(/^(#{1,6}\s|>\s?|[-*+]\s|\d+\.\s)/, '')
      ).join('\n');
      ta.value = val.slice(0, lineStart) + replaced + val.slice(lineEnd);
      ta.selectionStart = lineStart;
      ta.selectionEnd = lineStart + replaced.length;
    };

    const insertBlock = (text) => {
      const needNl = s > 0 && val[s - 1] !== '\n';
      const block = (needNl ? '\n\n' : '') + text + '\n\n';
      ta.value = val.slice(0, s) + block + val.slice(e);
      ta.selectionStart = ta.selectionEnd = s + block.length;
    };

    switch (cmd) {
      case 'heading':    linePrefix(value === 'H1' ? '# ' : value === 'H2' ? '## ' : '### '); break;
      case 'bold':       surround('**', '**', 'bold text'); break;
      case 'italic':     surround('*', '*', 'italic'); break;
      case 'strike':     surround('~~', '~~', 'strike'); break;
      case 'code':       surround('`', '`', 'code'); break;
      case 'ul':         linePrefix('- '); break;
      case 'ol':         linePrefix('1. '); break;
      case 'quote':      linePrefix('> '); break;
      case 'codeblock':  insertBlock('```\n// code…\n```'); break;
      case 'hr':         insertBlock('---'); break;
      case 'table': {
        const cols = 3, rows = 3;
        const head = '| ' + Array.from({length: cols}, (_, i) => `Column ${i+1}`).join(' | ') + ' |';
        const sep  = '| ' + Array.from({length: cols}, () => '---').join(' | ') + ' |';
        const body = Array.from({length: rows}, () =>
          '| ' + Array.from({length: cols}, () => '   ').join(' | ') + ' |'
        ).join('\n');
        insertBlock([head, sep, body].join('\n')); break;
      }
    }
    window._editorOnChange && window._editorOnChange();
  }
}

function _tbLink() {
  const mode = window._editorGetMode && window._editorGetMode();
  if (mode === 'wysiwyg') {
    const url = window.prompt('Link URL', 'https://');
    if (url == null) return;
    const el = document.getElementById('wysiwyg');
    el && el.focus();
    const sel = window.getSelection();
    if (sel && sel.isCollapsed) {
      document.execCommand('insertHTML', false, `<a href="${url}">link text</a>`);
    } else {
      document.execCommand('createLink', false, url);
    }
    window._editorOnChange && window._editorOnChange();
  } else {
    _tbCmd('link', '');
  }
}
