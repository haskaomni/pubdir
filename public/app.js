const state = {
  path: new URLSearchParams(location.search).get('path') || '',
  items: [],
  active: '',
  parent: '',
  isRoot: true,
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
  state.parent = data.parent;
  state.isRoot = data.isRoot;
  els.crumb.textContent = `/${data.path}`.replace(/\/$/, '') || '/';
  els.backButton.disabled = data.isRoot;
  els.backButton.onclick = () => loadDirectory(data.parent);
  els.itemCount.textContent = `${data.items.length} item${data.items.length === 1 ? '' : 's'}`;
  renderList();
}

function renderList() {
  const items = visibleItems();
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

function visibleItems() {
  const query = els.search.value.trim().toLowerCase();
  return state.items.filter((item) => item.name.toLowerCase().includes(query));
}

function activeIndex(items = visibleItems()) {
  return items.findIndex((item) => item.path === state.active);
}

function scrollActiveIntoView() {
  els.fileList.querySelector('.file-row.active')?.scrollIntoView({ block: 'nearest' });
}

function selectItem(item, { open = false } = {}) {
  if (!item) return;
  if (item.isDirectory && open) {
    loadDirectory(item.path);
    return;
  }
  if (item.isDirectory) {
    setActivePath(item.path);
    scrollActiveIntoView();
    return;
  }
  previewFile(item);
  scrollActiveIntoView();
}

function moveSelection(delta) {
  const items = visibleItems();
  if (!items.length) return;
  const current = activeIndex(items);
  const next = current < 0 ? (delta > 0 ? 0 : items.length - 1) : Math.min(Math.max(current + delta, 0), items.length - 1);
  selectItem(items[next]);
}

function openSelection() {
  const items = visibleItems();
  selectItem(items[activeIndex(items)] || items[0], { open: true });
}

function previewShell(item, body) {
  setActivePath(item.path);
  els.preview.className = 'preview';
  els.preview.innerHTML = `
    ${body}
    <div class="preview-actions">
      <a class="button" href="${rawUrl(item.path)}" target="_blank" rel="noreferrer" aria-label="Open raw file">
        <svg class="action-icon" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 6h-6a2 2 0 0 0 -2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2 -2v-6" />
          <path d="M11 13l9 -9" />
          <path d="M15 4h5v5" />
        </svg>
      </a>
      <a class="button" href="${downloadUrl(item.path)}" aria-label="Download file">
        <svg class="action-icon" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2 -2v-2" />
          <path d="M7 11l5 5l5 -5" />
          <path d="M12 4l0 12" />
        </svg>
      </a>
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
document.addEventListener('keydown', (event) => {
  if (event.target.closest('.preview-actions')) return;

  if (event.target === els.search) {
    if (event.key === 'Escape') els.search.blur();
    return;
  }

  if (event.key === 'ArrowDown') {
    event.preventDefault();
    moveSelection(1);
  } else if (event.key === 'ArrowUp') {
    event.preventDefault();
    moveSelection(-1);
  } else if (event.key === 'ArrowRight' || event.key === 'Enter') {
    event.preventDefault();
    openSelection();
  } else if (event.key === 'ArrowLeft' && !state.isRoot) {
    event.preventDefault();
    loadDirectory(state.parent);
  } else if (event.key === '/') {
    event.preventDefault();
    els.search.focus();
  }
});

loadDirectory(state.path).catch((error) => {
  els.fileList.innerHTML = `<p class="error">${escapeHtml(error.message)}</p>`;
});
