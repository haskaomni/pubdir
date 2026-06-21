const state = {
  path: new URLSearchParams(location.search).get('path') || '',
  items: [],
  active: '',
};

const els = {
  crumb: document.querySelector('#crumb'),
  backButton: document.querySelector('#backButton'),
  itemCount: document.querySelector('#itemCount'),
  fileList: document.querySelector('#fileList'),
  preview: document.querySelector('#preview'),
  search: document.querySelector('#searchInput'),
};

const icons = {
  folder: '▰', image: '◉', video: '▶', audio: '♪', pdf: '□', text: '#', download: '↓'
};

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  }[char]));
}

function rawUrl(path) {
  return `/raw/${path.split('/').map(encodeURIComponent).join('/')}`;
}

function downloadUrl(path) {
  return `/download/${path.split('/').map(encodeURIComponent).join('/')}`;
}

function prettyDate(value) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

async function loadDirectory(nextPath = '') {
  const response = await fetch(`/api/list?path=${encodeURIComponent(nextPath)}`);
  if (!response.ok) throw new Error(await response.text());
  const data = await response.json();
  state.path = data.path;
  state.items = data.items;
  state.active = '';
  history.replaceState(null, '', data.path ? `?path=${encodeURIComponent(data.path)}` : location.pathname);
  renderDirectory(data);
  renderEmpty();
}

function renderDirectory(data) {
  els.crumb.textContent = `/${data.path}`.replace(/\/$/, '') || '/';
  els.backButton.disabled = data.isRoot;
  els.backButton.onclick = () => loadDirectory(data.parent);
  els.itemCount.textContent = `${data.items.length} item${data.items.length === 1 ? '' : 's'}`;
  renderList();
}

function renderList() {
  const query = els.search.value.trim().toLowerCase();
  const items = state.items.filter((item) => item.name.toLowerCase().includes(query));
  els.fileList.innerHTML = items.map((item, index) => `
    <button class="file-row ${state.active === item.path ? 'active' : ''}" data-path="${escapeHtml(item.path)}" data-dir="${item.isDirectory}" style="animation-delay:${Math.min(index * 18, 240)}ms">
      <span class="icon">${icons[item.type] || icons.download}</span>
      <span>
        <span class="file-name">${escapeHtml(item.name)}</span>
        <span class="file-meta">${item.isDirectory ? 'folder' : `${escapeHtml(item.sizeLabel)} · ${escapeHtml(item.mime)}`} · ${prettyDate(item.modified)}</span>
      </span>
      <span class="mono">${item.isDirectory ? 'open' : 'view'}</span>
    </button>
  `).join('') || '<p class="file-meta">No matching files.</p>';

  els.fileList.querySelectorAll('.file-row').forEach((row) => {
    row.addEventListener('click', () => {
      const path = row.dataset.path;
      if (row.dataset.dir === 'true') loadDirectory(path);
      else previewFile(state.items.find((item) => item.path === path));
    });
  });
}

function setActivePath(path) {
  state.active = path;
  els.fileList.querySelectorAll('.file-row').forEach((row) => {
    row.classList.toggle('active', row.dataset.path === path);
  });
}

function previewShell(item, body) {
  setActivePath(item.path);
  els.preview.className = 'preview';
  els.preview.innerHTML = `
    ${body}
    <div class="preview-actions">
      <a class="button" href="${rawUrl(item.path)}" target="_blank" rel="noreferrer">Open raw</a>
      <a class="button" href="${downloadUrl(item.path)}">Download</a>
    </div>
  `;
}

async function previewFile(item) {
  if (!item) return;
  if (item.type === 'image') {
    previewShell(item, `<img class="preview-media" src="${rawUrl(item.path)}" alt="${escapeHtml(item.name)}" />`);
    return;
  }
  if (item.type === 'video') {
    previewShell(item, `<video class="preview-media" src="${rawUrl(item.path)}" controls></video>`);
    return;
  }
  if (item.type === 'audio') {
    previewShell(item, `<audio class="preview-media" src="${rawUrl(item.path)}" controls></audio>`);
    return;
  }
  if (item.type === 'pdf') {
    previewShell(item, `<iframe class="preview-frame" src="${rawUrl(item.path)}" title="${escapeHtml(item.name)}"></iframe>`);
    return;
  }
  if (item.type === 'text') {
    previewShell(item, '<pre class="code-box">Loading preview...</pre>');
    const box = els.preview.querySelector('.code-box');
    try {
      const response = await fetch(`/api/preview?path=${encodeURIComponent(item.path)}`);
      if (!response.ok) throw new Error('Preview unavailable');
      box.textContent = await response.text();
    } catch (error) {
      box.innerHTML = `<span class="error">${escapeHtml(error.message)}</span>`;
    }
    return;
  }
  previewShell(item, '<p>This file type cannot be previewed yet, but it can be opened or downloaded.</p>');
}

function renderEmpty() {
  els.preview.className = 'preview empty';
  els.preview.innerHTML = `
    <div class="empty-mark">↯</div>
    <p>Select a file to preview images, video, audio, PDFs, Markdown, code, JSON, CSV, and plain text.</p>
  `;
}

els.search.addEventListener('input', renderList);

loadDirectory(state.path).catch((error) => {
  els.fileList.innerHTML = `<p class="error">${escapeHtml(error.message)}</p>`;
});
