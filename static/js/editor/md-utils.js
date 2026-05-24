// md-utils.js — Markdown ↔ HTML converters and stats for the Bloggy editor.

function escHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// {#aXXXXX} anchor token. Used by the scratchpad to pin notes to blocks
// (paragraphs / headings / blockquotes). Round-trips through Write ↔ Markdown
// as a `data-anchor-id` attribute on the wrapping element.
const ANCHOR_RE = /\s*\{#(a[a-z0-9]+)\}\s*$/;
function stripAnchor(line) {
  const m = line.match(ANCHOR_RE);
  if (!m) return { text: line, anchorId: null };
  return { text: line.slice(0, m.index), anchorId: m[1] };
}
function anchorAttr(id) { return id ? ` data-anchor-id="${id}"` : ''; }
function anchorTail(el) {
  const id = el.getAttribute && el.getAttribute('data-anchor-id');
  return id ? ` {#${id}}` : '';
}

function mdInline(text) {
  let s = escHtml(text);
  s = s.replace(/`([^`]+?)`/g, (_, c) => `<code>${c}</code>`);
  s = s.replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*])\*([^*\n]+?)\*(?!\*)/g, '$1<em>$2</em>');
  s = s.replace(/~~([^~\n]+?)~~/g, '<s>$1</s>');
  s = s.replace(/\[([^\]]+?)\]\(([^)\s]+?)\)/g, (_, t, u) => `<a href="${u}">${t}</a>`);
  return s;
}

function mdToHtml(md) {
  if (!md) return '';
  const lines = md.replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (/^\s*$/.test(line)) { i++; continue; }

    if (/^```/.test(line)) {
      const code = []; i++;
      while (i < lines.length && !/^```/.test(lines[i])) { code.push(lines[i]); i++; }
      i++;
      out.push(`<pre><code>${escHtml(code.join('\n'))}</code></pre>`);
      continue;
    }

    if (/^\s*(---|\*\*\*|___)\s*$/.test(line)) { out.push('<hr>'); i++; continue; }

    const h = line.match(/^(#{1,3})\s+(.*)$/);
    if (h) {
      const stripped = stripAnchor(h[2]);
      out.push(`<h${h[1].length}${anchorAttr(stripped.anchorId)}>${mdInline(stripped.text)}</h${h[1].length}>`);
      i++; continue;
    }

    if (/^\s*>\s?/.test(line)) {
      const buf = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^\s*>\s?/, '')); i++;
      }
      const joined = buf.join(' ');
      const stripped = stripAnchor(joined);
      out.push(`<blockquote${anchorAttr(stripped.anchorId)}>${mdInline(stripped.text)}</blockquote>`);
      continue;
    }

    if (/^\s*[-*+]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*+]\s+/, '')); i++;
      }
      out.push('<ul>' + items.map(t => `<li>${mdInline(t)}</li>`).join('') + '</ul>');
      continue;
    }

    if (/^\s*\d+\.\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, '')); i++;
      }
      out.push('<ol>' + items.map(t => `<li>${mdInline(t)}</li>`).join('') + '</ol>');
      continue;
    }

    // GFM table
    if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|?[\s:-]*\|[\s:|-]*$/.test(lines[i + 1])) {
      const splitRow = l => l.trim().replace(/^\||\|$/g, '').split('|').map(s => s.trim());
      const header = splitRow(line);
      i += 2;
      const rows = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) { rows.push(splitRow(lines[i])); i++; }
      const thead = '<thead><tr>' + header.map(c => `<th>${mdInline(c)}</th>`).join('') + '</tr></thead>';
      const tbody = '<tbody>' + rows.map(r =>
        '<tr>' + r.map(c => `<td>${mdInline(c) || '&nbsp;'}</td>`).join('') + '</tr>'
      ).join('') + '</tbody>';
      out.push(`<table>${thead}${tbody}</table>`);
      continue;
    }

    const buf = [];
    while (i < lines.length &&
           !/^\s*$/.test(lines[i]) &&
           !/^(#{1,3}\s|>\s?|[-*+]\s|\d+\.\s|\||```|---|\*\*\*|___)/.test(lines[i])) {
      buf.push(lines[i]); i++;
    }
    if (buf.length) {
      const joined  = buf.join(' ');
      const stripped = stripAnchor(joined);
      out.push(`<p${anchorAttr(stripped.anchorId)}>${mdInline(stripped.text)}</p>`);
    }
  }

  return out.join('\n');
}

function inlineToMd(node) {
  let out = '';
  node.childNodes.forEach(c => {
    if (c.nodeType === Node.TEXT_NODE) { out += c.nodeValue; return; }
    if (c.nodeType !== Node.ELEMENT_NODE) return;
    const tag = c.tagName.toLowerCase();
    const inner = inlineToMd(c);
    switch (tag) {
      case 'strong': case 'b': out += `**${inner}**`; break;
      case 'em':     case 'i': out += `*${inner}*`;  break;
      case 's': case 'strike': case 'del': out += `~~${inner}~~`; break;
      case 'code': out += `\`${c.textContent}\``; break;
      case 'a':    out += `[${inner}](${c.getAttribute('href') || ''})`; break;
      case 'br':   out += '\n'; break;
      default:     out += inner;
    }
  });
  return out;
}

function htmlToMd(html) {
  const div = document.createElement('div');
  div.innerHTML = html;
  const out = [];

  div.childNodes.forEach(node => {
    if (node.nodeType === Node.TEXT_NODE) {
      const t = node.nodeValue.trim(); if (t) out.push(t); return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const tag = node.tagName.toLowerCase();
    switch (tag) {
      case 'h1': out.push(`# ${inlineToMd(node)}${anchorTail(node)}`);   break;
      case 'h2': out.push(`## ${inlineToMd(node)}${anchorTail(node)}`);  break;
      case 'h3': out.push(`### ${inlineToMd(node)}${anchorTail(node)}`); break;
      case 'blockquote': {
        const inner = inlineToMd(node);
        const tail  = anchorTail(node);
        const parts = inner.split('\n').map(l => `> ${l}`);
        if (tail) parts[parts.length - 1] = parts[parts.length - 1] + tail;
        out.push(parts.join('\n')); break;
      }
      case 'ul':
        node.querySelectorAll(':scope > li').forEach(li => out.push(`- ${inlineToMd(li)}`)); break;
      case 'ol':
        node.querySelectorAll(':scope > li').forEach((li, idx) => out.push(`${idx + 1}. ${inlineToMd(li)}`)); break;
      case 'hr': out.push('---'); break;
      case 'pre': {
        const code = node.querySelector('code');
        out.push('```\n' + (code ? code.textContent : node.textContent) + '\n```'); break;
      }
      case 'table': {
        const rows = [...node.querySelectorAll('tr')];
        if (!rows.length) break;
        const cells = tr => [...tr.querySelectorAll('th,td')].map(c => inlineToMd(c).trim() || ' ');
        const header = cells(rows[0]);
        const lines = [];
        lines.push('| ' + header.join(' | ') + ' |');
        lines.push('| ' + header.map(() => '---').join(' | ') + ' |');
        rows.slice(1).forEach(r => lines.push('| ' + cells(r).join(' | ') + ' |'));
        out.push(lines.join('\n')); break;
      }
      case 'p':
      case 'div': {
        const md = inlineToMd(node).trim();
        if (!md) break;
        const tail  = tag === 'p' ? anchorTail(node) : '';
        const parts = md.split(/\n+/).map(s => s.trim()).filter(Boolean);
        if (tail && parts.length) parts[parts.length - 1] = parts[parts.length - 1] + tail;
        parts.forEach(s => out.push(s));
        break;
      }
      case 'br':
        break; // top-level <br> is a paragraph boundary; adjacent text nodes are separate entries
      case 'img': {
        const src = node.getAttribute('src') || '';
        const alt = node.getAttribute('alt') || '';
        out.push(`![${alt}](${src})`); break;
      }
      default: {
        const md = inlineToMd(node).trim(); if (md) out.push(md);
      }
    }
  });

  return out.join('\n\n');
}

function getStats(text) {
  const t = (text || '').trim();
  if (!t) return { words: 0, chars: 0, readMin: 0 };
  const words = t.split(/\s+/).filter(Boolean).length;
  return { words, chars: t.length, readMin: Math.max(1, Math.round(words / 220)) };
}
