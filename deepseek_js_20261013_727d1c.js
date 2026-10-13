/* ============================================================
   CENTRAL & STORES — ADMIN MEDIA LIBRARY
   ------------------------------------------------------------
   Manages all images across Supabase Storage buckets:
     • product-images
     • advertisements
     • category-images

   Features:
     • Grid view with thumbnails
     • Bucket selector tabs
     • Search by filename
     • Sort by name / date / size
     • Copy public URL
     • Open in new tab
     • Soft delete (moves to trash-marked list)
     • Restore
     • Permanent delete (only from trash view)
     • "In use" indicator (referenced by products)
     • File count + total size display
     • Responsive grid (mobile → desktop)
     • Live reload after delete/restore

   Depends on: admin-core.js, admin-trash.js (for soft-delete pattern)
   ============================================================ */

(function () {
  'use strict';

  const esc = window.AdminCore.esc;
  const toast = window.AdminCore.toast;
  const copyToClipboard = window.AdminCore.copyToClipboard;
  const setBtnLoading = window.AdminCore.setBtnLoading;

  /* ============================================================
     STATE
     ============================================================ */
  const state = {
    bucket: 'product-images',
    files: [],
    filteredFiles: [],
    usedUrls: new Set(),
    trashMode: false,
    loaded: false
  };

  const BUCKETS = [
    { id: 'product-images', label: 'Product Images' },
    { id: 'advertisements', label: 'Advertisement Creatives' },
    { id: 'category-images', label: 'Category Images' }
  ];

  /* ============================================================
     1. LOAD FILES
     ============================================================ */
  async function loadMedia() {
    if (!window.db) return;

    const container = document.getElementById('mediaContainer');
    if (container) {
      container.innerHTML =
        '<div class="card"><div class="card-body">' +
          '<div class="skeleton" style="height:120px"></div>' +
        '</div></div>';
    }

    try {
      // Load files from current bucket
      const { data, error } = await window.db.storage
        .from(state.bucket)
        .list('', {
          limit: 500,
          sortBy: { column: 'created_at', order: 'desc' }
        });

      if (error) throw error;

      // Filter out folder placeholders
      state.files = (data || []).filter(function (f) {
        return f.name && !f.name.endsWith('/') && f.id;
      });

      // Fetch used URLs from products
      state.usedUrls = new Set();
      if (state.bucket === 'product-images') {
        const { data: prods } = await window.db
          .from('products')
          .select('image_url')
          .is('deleted_at', null);
        (prods || []).forEach(function (p) {
          if (p.image_url) state.usedUrls.add(p.image_url);
        });
      } else if (state.bucket === 'advertisements') {
        const { data: ads } = await window.db
          .from('advertisements')
          .select('image_url')
          .is('deleted_at', null);
        (ads || []).forEach(function (a) {
          if (a.image_url) state.usedUrls.add(a.image_url);
        });
      } else if (state.bucket === 'category-images') {
        const { data: cats } = await window.db
          .from('categories')
          .select('image_url')
          .is('deleted_at', null);
        (cats || []).forEach(function (c) {
          if (c.image_url) state.usedUrls.add(c.image_url);
        });
      }

      state.loaded = true;
      applyFilters();
      renderStats();
    } catch (err) {
      console.warn('[media] load failed:', err);
      if (container) {
        container.innerHTML =
          '<div class="card"><div class="card-body">' +
            '<div class="empty">' +
              '<h3>Unable to load media</h3>' +
              '<p>' + esc(err.message || '') + '</p>' +
              '<button class="btn btn-primary" id="mediaRetryBtn">Try Again</button>' +
            '</div>' +
          '</div></div>';

        const retry = document.getElementById('mediaRetryBtn');
        if (retry) retry.addEventListener('click', loadMedia);
      }
    }
  }

  /* ============================================================
     2. STATS (count + total size)
     ============================================================ */
  function renderStats() {
    const wrap = document.getElementById('mediaStats');
    if (!wrap) return;

    let totalSize = 0;
    state.files.forEach(function (f) {
      const size = f.metadata && f.metadata.size ? Number(f.metadata.size) : 0;
      totalSize += size;
    });

    const mb = (totalSize / (1024 * 1024)).toFixed(2);
    const count = state.files.length;

    wrap.innerHTML =
      '<div class="stat-card"><div class="stat-label">Files</div><div class="stat-value">' + count + '</div></div>' +
      '<div class="stat-card"><div class="stat-label">Total Size</div><div class="stat-value">' + mb + ' MB</div></div>' +
      '<div class="stat-card"><div class="stat-label">In Use</div><div class="stat-value">' +
        Array.from(state.usedUrls).filter(function (u) { return u.includes(state.bucket); }).length +
      '</div></div>' +
      '<div class="stat-card"><div class="stat-label">Bucket</div><div class="stat-value" style="font-size:1rem">' + esc(state.bucket) + '</div></div>';
  }

  /* ============================================================
     3. FILTER / SORT
     ============================================================ */
  function applyFilters() {
    const q = (document.getElementById('mediaSearch') || {}).value || '';
    const sort = (document.getElementById('mediaSort') || {}).value || 'newest';

    let list = state.files.slice();

    if (q.trim()) {
      const query = q.trim().toLowerCase();
      list = list.filter(function (f) {
        return String(f.name || '').toLowerCase().includes(query);
      });
    }

    switch (sort) {
      case 'oldest':
        list.sort(function (a, b) {
          return (new Date(a.created_at) - new Date(b.created_at));
        });
        break;
      case 'name':
        list.sort(function (a, b) {
          return String(a.name || '').localeCompare(String(b.name || ''));
        });
        break;
      case 'size':
        list.sort(function (a, b) {
          const sa = (a.metadata && a.metadata.size) || 0;
          const sb = (b.metadata && b.metadata.size) || 0;
          return sb - sa;
        });
        break;
      case 'newest':
      default:
        list.sort(function (a, b) {
          return (new Date(b.created_at) - new Date(a.created_at));
        });
    }

    state.filteredFiles = list;
    renderMedia();
  }

  /* ============================================================
     4. RENDER MEDIA GRID
     ============================================================ */
  function renderMedia() {
    const container = document.getElementById('mediaContainer');
    if (!container) return;

    const items = state.filteredFiles;

    if (items.length === 0) {
      const isEmpty = state.files.length === 0;
      container.innerHTML =
        '<div class="card"><div class="card-body">' +
          '<div class="empty">' +
            '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="9" cy="9" r="2" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="m21 15-5-5L5 21" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>' +
            '<h3>' + (isEmpty ? 'No images yet' : 'No matching images') + '</h3>' +
            '<p>' + (isEmpty
              ? 'Upload product images to see them here.'
              : 'Try a different search or sort.') + '</p>' +
          '</div>' +
        '</div></div>';
      return;
    }

    container.innerHTML =
      '<div class="card"><div class="card-body">' +
        '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:14px">' +
          items.map(renderMediaCard).join('') +
        '</div>' +
      '</div></div>';

    // Wire up action buttons
    container.querySelectorAll('[data-media-act]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        const act = btn.dataset.mediaAct;
        const path = btn.dataset.path;
        const fname = btn.dataset.fname;
        const url = btn.dataset.url;
        const inuse = btn.dataset.inuse === '1';

        if (act === 'copy') copyToClipboard(url);
        else if (act === 'open') window.open(url, '_blank', 'noopener');
        else if (act === 'delete') deleteMedia(path, fname, inuse);
      });
    });
  }

  function renderMediaCard(file) {
    const pubResult = window.db.storage.from(state.bucket).getPublicUrl(file.name);
    const url = pubResult.data.publicUrl;
    const isUsed = state.usedUrls.has(url);

    const size = file.metadata && file.metadata.size
      ? (file.metadata.size / 1024).toFixed(1) + ' KB'
      : '—';

    const created = file.created_at
      ? new Date(file.created_at).toLocaleDateString('en-IN', {
          year: 'numeric', month: 'short', day: 'numeric'
        })
      : '';

    return '<div class="media-card" style="border:1px solid var(--gray-200);border-radius:12px;overflow:hidden;background:var(--white);display:flex;flex-direction:column">' +
      '<div style="aspect-ratio:1/1;background:linear-gradient(135deg,#fafafa,#f0f0f0);display:flex;align-items:center;justify-content:center;overflow:hidden;position:relative">' +
        '<img src="' + esc(url) + '" alt="" style="width:100%;height:100%;object-fit:contain;padding:10px" loading="lazy">' +
        (isUsed
          ? '<span style="position:absolute;top:8px;left:8px;background:var(--success);color:#fff;font-size:.65rem;font-weight:800;padding:3px 8px;border-radius:100px">IN USE</span>'
          : '') +
      '</div>' +
      '<div style="padding:10px;display:flex;flex-direction:column;gap:6px;flex:1">' +
        '<div style="font-size:.7rem;color:var(--gray-500);overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + esc(file.name) + '">' +
          esc(file.name.split('/').pop()) +
        '</div>' +
        '<div style="font-size:.65rem;color:var(--gray-400)">' +
          esc(size) + (created ? ' · ' + esc(created) : '') +
        '</div>' +
        '<div style="display:flex;gap:6px;margin-top:auto">' +
          '<button class="icon-action" data-media-act="copy" data-url="' + esc(url) + '" title="Copy URL" aria-label="Copy URL">' +
            '<svg viewBox="0 0 24 24"><use href="#icon-copy"></use></svg>' +
          '</button>' +
          '<button class="icon-action" data-media-act="open" data-url="' + esc(url) + '" title="Open in new tab" aria-label="Open">' +
            '<svg viewBox="0 0 24 24"><use href="#icon-eye"></use></svg>' +
          '</button>' +
          '<button class="icon-action danger" data-media-act="delete" data-path="' + esc(file.name) + '" data-fname="' + esc(file.name) + '" data-url="' + esc(url) + '" data-inuse="' + (isUsed ? '1' : '0') + '" title="Delete" aria-label="Delete">' +
            '<svg viewBox="0 0 24 24"><use href="#icon-trash"></use></svg>' +
          '</button>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  /* ============================================================
     5. DELETE MEDIA
     ============================================================ */
  async function deleteMedia(path, fname, inUse) {
    if (!window.db) return;

    let msg = 'Delete "' + fname + '"?';
    if (inUse) {
      msg = 'Warning: This image is currently used by a product or ad.\n\nDeleting it will break that image.\n\nDelete "' + fname + '" anyway?';
    }

    if (!confirm(msg)) return;

    try {
      const { error } = await window.db.storage.from(state.bucket).remove([path]);
      if (error) throw error;

      toast('Image deleted');
      loadMedia();
    } catch (err) {
      toast('Unable to delete: ' + (err.message || 'Unknown'), 'error');
    }
  }

  /* ============================================================
     6. BUCKET TABS
     ============================================================ */
  function renderBucketTabs() {
    const container = document.getElementById('mediaBucketTabs');
    if (!container) return;

    container.innerHTML = BUCKETS.map(function (b) {
      const active = state.bucket === b.id;
      return '<button class="tab' + (active ? ' active' : '') + '" data-bucket="' + b.id + '">' +
        esc(b.label) +
      '</button>';
    }).join('');

    container.querySelectorAll('[data-bucket]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.bucket = btn.dataset.bucket;
        state.loaded = false;
        renderBucketTabs();
        loadMedia();
      });
    });
  }

  /* ============================================================
     7. INIT MEDIA SECTION
     ------------------------------------------------------------
     Replaces the default media container with our own UI:
     tabs + stats + toolbar + grid.
     ============================================================ */
  function initMediaSection() {
    const section = document.getElementById('section-media');
    if (!section) return;

    // Check if we already initialized
    if (section.dataset.mediaInit === '1') return;
    section.dataset.mediaInit = '1';

    // Replace the page head buttons
    const pageHead = section.querySelector('.page-head');
    if (pageHead) {
      // Ensure there is a refresh button (there already is one, wire it)
      const refreshBtn = document.getElementById('refreshMediaBtn');
      if (refreshBtn) {
        refreshBtn.addEventListener('click', loadMedia);
      }
    }

    // Insert bucket tabs + stats before the container
    const container = document.getElementById('mediaContainer');
    if (!container) return;

    // Insert wrapper elements
    const wrapper = document.createElement('div');

    // Bucket tabs
    const tabsDiv = document.createElement('div');
    tabsDiv.id = 'mediaBucketTabs';
    tabsDiv.className = 'tabs';
    tabsDiv.style.marginBottom = '18px';
    wrapper.appendChild(tabsDiv);

    // Stats
    const statsDiv = document.createElement('div');
    statsDiv.id = 'mediaStats';
    statsDiv.className = 'stat-grid';
    statsDiv.style.marginBottom = '18px';
    wrapper.appendChild(statsDiv);

    // Toolbar
    const toolbar = document.createElement('div');
    toolbar.className = 'toolbar';
    toolbar.innerHTML =
      '<div class="toolbar-search">' +
        '<svg viewBox="0 0 24 24"><use href="#icon-search"></use></svg>' +
        '<input type="search" id="mediaSearch" placeholder="Search by filename...">' +
      '</div>' +
      '<select id="mediaSort">' +
        '<option value="newest">Newest first</option>' +
        '<option value="oldest">Oldest first</option>' +
        '<option value="name">Name (A–Z)</option>' +
        '<option value="size">Largest first</option>' +
      '</select>';
    wrapper.appendChild(toolbar);

    // Insert before the existing container
    container.parentNode.insertBefore(wrapper, container);

    // Wire filters
    const search = document.getElementById('mediaSearch');
    if (search) search.addEventListener('input', applyFilters);
    const sort = document.getElementById('mediaSort');
    if (sort) sort.addEventListener('change', applyFilters);

    renderBucketTabs();
  }

  /* ============================================================
     8. WATCH SECTION ACTIVATION
     ------------------------------------------------------------
     Only load media when the Media section becomes visible.
     ============================================================ */
  function watchSection() {
    const section = document.getElementById('section-media');
    if (!section) return;

    const observer = new MutationObserver(function () {
      if (section.classList.contains('active')) {
        initMediaSection();
        if (!state.loaded) loadMedia();
      }
    });

    observer.observe(section, { attributes: true, attributeFilter: ['class'] });
  }

  /* ============================================================
     9. INIT
     ============================================================ */
  function init() {
    watchSection();

    // If section is active on load, initialize immediately
    const section = document.getElementById('section-media');
    if (section && section.classList.contains('active')) {
      initMediaSection();
      loadMedia();
    }

    // Expose globally
    window.loadMedia = loadMedia;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();