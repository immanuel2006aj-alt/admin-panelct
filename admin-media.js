/* ============================================================
   CENTRAL & STORES — ADMIN MEDIA LIBRARY
   ------------------------------------------------------------
   Manages all images across Supabase Storage buckets:
     • product-images  (subfolder: products/)
     • advertisements  (subfolder: ads/)
     • category-images (subfolder: categories/)

   Features:
     • Grid view with thumbnails
     • Bucket selector tabs
     • Search by filename
     • Sort by name / date / size
     • Copy public URL
     • Open in new tab
     • Permanent delete (media files are binary — no Trash)
     • "In use" indicator (referenced by products/ads/categories)
     • File count + total size display
     • Responsive grid (mobile → desktop)
     • Live reload after delete

   Depends on: admin-core.js
   ============================================================ */

(function () {
  'use strict';

  const esc = window.AdminCore.esc;
  const toast = window.AdminCore.toast;
  const copyToClipboard = window.AdminCore.copyToClipboard;

  /* ============================================================
     STATE
     ============================================================ */
  const state = {
    bucket: 'product-images',
    files: [],
    filteredFiles: [],
    usedUrls: new Set(),
    loaded: false,
    loading: false
  };

  const BUCKETS = [
    { id: 'product-images', label: 'Product Images', folder: 'products' },
    { id: 'advertisements', label: 'Advertisement Creatives', folder: 'ads' },
    { id: 'category-images', label: 'Category Images', folder: 'categories' }
  ];

  function getBucketConfig(id) {
    return BUCKETS.find(function (b) { return b.id === id; }) || BUCKETS[0];
  }

  /* ============================================================
     1. LOAD FILES (recursive into known subfolder)
     ============================================================ */
  async function loadMedia() {
    if (!window.db) return;
    if (state.loading) return;
    state.loading = true;

    const container = document.getElementById('mediaContainer');
    if (container) {
      container.innerHTML =
        '<div class="card"><div class="card-body">' +
          '<div class="skeleton" style="height:120px;margin-bottom:12px"></div>' +
          '<div class="skeleton" style="height:120px"></div>' +
        '</div></div>';
    }

    const cfg = getBucketConfig(state.bucket);

    try {
      // Collect files from root + the known subfolder
      const allFiles = [];

      // Root-level files
      const rootRes = await window.db.storage.from(state.bucket).list('', {
        limit: 500,
        sortBy: { column: 'created_at', order: 'desc' }
      });
      if (rootRes.data) {
        rootRes.data
          .filter(function (f) { return f.name && !f.name.endsWith('/') && f.id; })
          .forEach(function (f) { allFiles.push(f); });
      }

      // Subfolder files (products/, ads/, categories/)
      if (cfg.folder) {
        const subRes = await window.db.storage.from(state.bucket).list(cfg.folder, {
          limit: 500,
          sortBy: { column: 'created_at', order: 'desc' }
        });
        if (subRes.data) {
          subRes.data
            .filter(function (f) { return f.name && !f.name.endsWith('/') && f.id; })
            .forEach(function (f) {
              // Prefix the subfolder name so getPublicUrl works correctly
              f._fullPath = cfg.folder + '/' + f.name;
              allFiles.push(f);
            });
        }
      }

      state.files = allFiles;

      // Build set of used URLs from the referencing table
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
    } finally {
      state.loading = false;
    }
  }

  /* ============================================================
     2. STATS
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

    // Count how many files are currently used
    let usedCount = 0;
    state.files.forEach(function (f) {
      const fullPath = f._fullPath || f.name;
      const { data } = window.db.storage.from(state.bucket).getPublicUrl(fullPath);
      if (data && data.publicUrl && state.usedUrls.has(data.publicUrl)) {
        usedCount++;
      }
    });

    wrap.innerHTML =
      '<div class="stat-card"><div class="stat-label">Files</div><div class="stat-value">' + count + '</div></div>' +
      '<div class="stat-card"><div class="stat-label">Total Size</div><div class="stat-value">' + mb + ' MB</div></div>' +
      '<div class="stat-card"><div class="stat-label">In Use</div><div class="stat-value">' + usedCount + '</div></div>' +
      '<div class="stat-card"><div class="stat-label">Bucket</div><div class="stat-value" style="font-size:1rem">' + esc(getBucketConfig(state.bucket).label) + '</div></div>';
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
            '<svg viewBox="0 0 24 24" style="width:48px;height:48px;stroke:#cbd2dc;fill:none;stroke-width:1.5;margin:0 auto 16px">' +
              '<rect x="3" y="3" width="18" height="18" rx="2"/>' +
              '<circle cx="9" cy="9" r="2"/>' +
              '<path d="m21 15-5-5L5 21"/>' +
            '</svg>' +
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
  }

  function renderMediaCard(file) {
    const fullPath = file._fullPath || file.name;
    const pubResult = window.db.storage.from(state.bucket).getPublicUrl(fullPath);
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

    const displayName = file.name.split('/').pop();

    return '<div class="media-card" style="border:1px solid var(--gray-200);border-radius:12px;overflow:hidden;background:var(--white);display:flex;flex-direction:column">' +
      '<div style="aspect-ratio:1/1;background:linear-gradient(135deg,#fafafa,#f0f0f0);display:flex;align-items:center;justify-content:center;overflow:hidden;position:relative">' +
        '<img src="' + esc(url) + '" alt="" style="width:100%;height:100%;object-fit:contain;padding:10px" loading="lazy">' +
        (isUsed
          ? '<span style="position:absolute;top:8px;left:8px;background:var(--success);color:#fff;font-size:.65rem;font-weight:800;padding:3px 8px;border-radius:100px">IN USE</span>'
          : '') +
      '</div>' +
      '<div style="padding:10px;display:flex;flex-direction:column;gap:6px;flex:1">' +
        '<div style="font-size:.7rem;color:var(--gray-500);overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + esc(displayName) + '">' +
          esc(displayName) +
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
          '<button class="icon-action danger" data-media-act="delete" data-path="' + esc(fullPath) + '" data-fname="' + esc(displayName) + '" data-url="' + esc(url) + '" data-inuse="' + (isUsed ? '1' : '0') + '" title="Delete permanently" aria-label="Delete">' +
            '<svg viewBox="0 0 24 24"><use href="#icon-trash"></use></svg>' +
          '</button>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  /* ============================================================
     5. DELETE MEDIA (permanent — no Trash for files)
     ============================================================ */
  async function deleteMedia(path, fname, inUse) {
    if (!window.db) return;

    let msg = 'Delete "' + fname + '" permanently?\n\nThis removes the file from Supabase Storage and cannot be undone.';
    if (inUse) {
      msg = 'Warning: This image is currently used by a product, ad, or category.\n\nDeleting it will break that image wherever it appears.\n\nDelete "' + fname + '" permanently anyway?';
    }

    if (!confirm(msg)) return;

    try {
      const { error } = await window.db.storage.from(state.bucket).remove([path]);
      if (error) throw error;

      toast('Image deleted');
      state.loaded = false;
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
  }

  /* ============================================================
     7. INIT MEDIA SECTION (builds UI on first open)
     ============================================================ */
  function initMediaSection() {
    const section = document.getElementById('section-media');
    if (!section) return;

    if (section.dataset.mediaInit === '1') return;
    section.dataset.mediaInit = '1';

    // Refresh button — wire once
    const refreshBtn = document.getElementById('refreshMediaBtn');
    if (refreshBtn && refreshBtn.dataset.wired !== '1') {
      refreshBtn.dataset.wired = '1';
      refreshBtn.addEventListener('click', function () {
        state.loaded = false;
        loadMedia();
      });
    }

    const container = document.getElementById('mediaContainer');
    if (!container) return;

    // Build wrapper with tabs + stats + toolbar
    const wrapper = document.createElement('div');

    const tabsDiv = document.createElement('div');
    tabsDiv.id = 'mediaBucketTabs';
    tabsDiv.className = 'tabs';
    tabsDiv.style.marginBottom = '18px';
    wrapper.appendChild(tabsDiv);

    const statsDiv = document.createElement('div');
    statsDiv.id = 'mediaStats';
    statsDiv.className = 'stat-grid';
    statsDiv.style.marginBottom = '18px';
    wrapper.appendChild(statsDiv);

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

    container.parentNode.insertBefore(wrapper, container);

    // Wire search/sort
    const search = document.getElementById('mediaSearch');
    if (search) search.addEventListener('input', applyFilters);
    const sort = document.getElementById('mediaSort');
    if (sort) sort.addEventListener('change', applyFilters);

    // Delegate bucket tab clicks + media action buttons
    tabsDiv.addEventListener('click', function (e) {
      const btn = e.target.closest('[data-bucket]');
      if (!btn) return;
      const bucket = btn.dataset.bucket;
      if (bucket === state.bucket) return;
      state.bucket = bucket;
      state.loaded = false;
      renderBucketTabs();
      loadMedia();
    });

    container.addEventListener('click', function (e) {
      const btn = e.target.closest('[data-media-act]');
      if (!btn) return;
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

    renderBucketTabs();
  }

  /* ============================================================
     8. WATCH SECTION ACTIVATION
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

    const section = document.getElementById('section-media');
    if (section && section.classList.contains('active')) {
      initMediaSection();
      loadMedia();
    }

    window.loadMedia = loadMedia;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
