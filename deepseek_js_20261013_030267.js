/* ============================================================
   CENTRAL & STORES — ADMIN PRODUCTS
   ------------------------------------------------------------
   Full product management:
     • List with pagination (50 per page)
     • Search + filters (status, availability, category)
     • Edit → opens Product Editor
     • Toggle publish / featured
     • Soft delete (moved to Trash, restore via admin-trash.js)
     • Image upload + compression + auto-scraper hook
     • Category dropdown populates from categories table
     • Save (create/update)

   Depends on: admin-core.js, admin-categories.js, admin-image-compressor.js
   ============================================================ */

(function () {
  'use strict';

  const esc = window.AdminCore.esc;
  const safeImg = window.AdminCore.safeImg;
  const fmtINR = window.AdminCore.fmtINR;
  const toast = window.AdminCore.toast;
  const setBtnLoading = window.AdminCore.setBtnLoading;

  const PAGE_SIZE = 50;

  /* ---------- STATE ---------- */
  const state = {
    allProducts: [],
    filteredProducts: [],
    currentPage: 1,
    totalPages: 1,
    loaded: false,
    editorMode: 'new',
    editorId: null,
    editorImageUrl: '',
    categories: []
  };

  /* ============================================================
     1. LOAD PRODUCTS
     ============================================================ */
  async function loadProducts() {
    if (!window.db) return;

    const tbody = document.getElementById('productsBody');
    const mobile = document.getElementById('productsMobile');
    if (tbody) tbody.innerHTML = '<tr><td colspan="8" style="padding:24px"><div class="skeleton" style="height:24px"></div></td></tr>';
    if (mobile) mobile.innerHTML = '<div class="skeleton" style="height:80px"></div>';

    try {
      // Fetch non-deleted products only
      const { data, error } = await window.db
        .from('products')
        .select('*')
        .is('deleted_at', null)
        .order('created_at', { ascending: false });

      if (error) throw error;

      state.allProducts = data || [];
      state.loaded = true;

      populateCategoryFilter();
      applyFilters();
    } catch (err) {
      console.warn('[products] load failed:', err);
      if (tbody) tbody.innerHTML = '<tr><td colspan="8"><div class="empty"><h3>Unable to load products</h3><p>' + esc(err.message || '') + '</p></div></td></tr>';
      if (mobile) mobile.innerHTML = '';
    }
  }

  /* ============================================================
     2. CATEGORY FILTER DROPDOWN
     ============================================================ */
  function populateCategoryFilter() {
    const sel = document.getElementById('filterCategory');
    if (!sel) return;

    const current = sel.value;
    const cats = [...new Set(state.allProducts.map(function (p) { return p.category; }).filter(Boolean))].sort();

    let html = '<option value="">All Categories</option>';
    html += cats.map(function (c) {
      return '<option value="' + esc(c) + '">' + esc(c) + '</option>';
    }).join('');

    sel.innerHTML = html;
    if (current) sel.value = current;
  }

  /* ============================================================
     3. FILTERS + SEARCH
     ============================================================ */
  function applyFilters() {
    const q = (document.getElementById('productSearch') || {}).value || '';
    const st = (document.getElementById('filterStatus') || {}).value || '';
    const av = (document.getElementById('filterAvailability') || {}).value || '';
    const ca = (document.getElementById('filterCategory') || {}).value || '';

    let list = state.allProducts.slice();

    if (q.trim()) {
      const query = q.trim().toLowerCase();
      list = list.filter(function (p) {
        return (p.name || '').toLowerCase().includes(query) ||
               (p.category || '').toLowerCase().includes(query) ||
               (p.weight || '').toLowerCase().includes(query);
      });
    }

    if (st === 'published') list = list.filter(function (p) { return p.is_published; });
    if (st === 'hidden') list = list.filter(function (p) { return !p.is_published; });
    if (av === 'available') list = list.filter(function (p) { return p.is_available !== false; });
    if (av === 'oos') list = list.filter(function (p) { return p.is_available === false; });
    if (ca) list = list.filter(function (p) { return p.category === ca; });

    state.filteredProducts = list;
    state.totalPages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
    if (state.currentPage > state.totalPages) state.currentPage = 1;

    renderProducts();
  }

  /* ============================================================
     4. RENDER PRODUCTS (with pagination)
     ============================================================ */
  function renderProducts() {
    const tbody = document.getElementById('productsBody');
    const mobile = document.getElementById('productsMobile');

    const start = (state.currentPage - 1) * PAGE_SIZE;
    const end = start + PAGE_SIZE;
    const pageItems = state.filteredProducts.slice(start, end);

    if (pageItems.length === 0) {
      const isEmpty = state.allProducts.length === 0;
      const empty =
        '<div class="empty">' +
          '<svg viewBox="0 0 24 24"><path d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>' +
          '<h3>' + (isEmpty ? 'No products yet' : 'No matching products') + '</h3>' +
          '<p>' + (isEmpty ? 'Add your first product to build the catalog.' : 'Try a different filter or search.') + '</p>' +
          (isEmpty ? '<button class="btn btn-primary" data-page="editor-new">Add Product</button>' : '') +
        '</div>';
      if (tbody) tbody.innerHTML = '<tr><td colspan="8">' + empty + '</td></tr>';
      if (mobile) mobile.innerHTML = '';
      renderPagination();
      return;
    }

    if (tbody) {
      tbody.innerHTML = pageItems.map(function (p) {
        const img = safeImg(p.image_url);
        const thumb = img
          ? '<img src="' + esc(img) + '" alt="" loading="lazy">'
          : esc((p.name || '?').charAt(0));
        return '<tr>' +
          '<td><div class="prod-cell">' +
            '<div class="prod-thumb">' + thumb + '</div>' +
            '<div style="min-width:0"><div class="prod-name">' + esc(p.name) + '</div>' +
              (p.weight ? '<div class="text-muted" style="font-size:.7rem">' + esc(p.weight) + '</div>' : '') +
            '</div>' +
          '</div></td>' +
          '<td>' + esc(p.category || '—') + '</td>' +
          '<td>' + esc(p.weight || '—') + '</td>' +
          '<td>' + fmtINR(p.price) + '</td>' +
          '<td>' + (p.is_available !== false
            ? '<span class="badge badge-green">In Stock</span>'
            : '<span class="badge badge-red">Out of Stock</span>') + '</td>' +
          '<td>' + (p.is_published
            ? '<span class="badge badge-green">Published</span>'
            : '<span class="badge badge-gray">Hidden</span>') + '</td>' +
          '<td>' + (p.is_featured
            ? '<span class="badge badge-gold">★</span>'
            : '<span class="text-muted">—</span>') + '</td>' +
          '<td>' +
            '<div class="row-actions">' +
              '<button class="icon-action" data-act="edit" data-id="' + esc(String(p.id)) + '" title="Edit" aria-label="Edit"><svg viewBox="0 0 24 24"><use href="#icon-edit"></use></svg></button>' +
              '<button class="icon-action" data-act="toggle-pub" data-id="' + esc(String(p.id)) + '" title="' + (p.is_published ? 'Hide' : 'Publish') + '" aria-label="Toggle publish"><svg viewBox="0 0 24 24"><use href="#icon-eye"></use></svg></button>' +
              '<button class="icon-action danger" data-act="del" data-id="' + esc(String(p.id)) + '" title="Delete" aria-label="Delete"><svg viewBox="0 0 24 24"><use href="#icon-trash"></use></svg></button>' +
            '</div>' +
          '</td>' +
        '</tr>';
      }).join('');
    }

    if (mobile) {
      mobile.innerHTML = pageItems.map(function (p) {
        const img = safeImg(p.image_url);
        const thumb = img
          ? '<img src="' + esc(img) + '" alt="" loading="lazy">'
          : esc((p.name || '?').charAt(0));
        return '<div class="mobile-card">' +
          '<div class="mobile-card-top">' +
            '<div class="mobile-card-thumb">' + thumb + '</div>' +
            '<div class="mobile-card-info">' +
              '<div class="mobile-card-name">' + esc(p.name) + '</div>' +
              '<div class="mobile-card-meta">' +
                '<span>' + esc(p.category || '—') + '</span>' +
                (p.weight ? '<span>· ' + esc(p.weight) + '</span>' : '') +
              '</div>' +
              '<div class="mobile-card-price">' + fmtINR(p.price) + '</div>' +
            '</div>' +
          '</div>' +
          '<div class="mobile-card-badges">' +
            (p.is_available !== false
              ? '<span class="badge badge-green">In Stock</span>'
              : '<span class="badge badge-red">Out of Stock</span>') +
            (p.is_published
              ? '<span class="badge badge-green">Published</span>'
              : '<span class="badge badge-gray">Hidden</span>') +
            (p.is_featured ? '<span class="badge badge-gold">★ Featured</span>' : '') +
          '</div>' +
          '<div class="mobile-card-actions">' +
            '<button class="action-btn edit" data-act="edit" data-id="' + esc(String(p.id)) + '">' +
              '<svg viewBox="0 0 24 24"><use href="#icon-edit"></use></svg> Edit' +
            '</button>' +
            '<button class="action-btn delete" data-act="del" data-id="' + esc(String(p.id)) + '">' +
              '<svg viewBox="0 0 24 24"><use href="#icon-trash"></use></svg> Delete' +
            '</button>' +
          '</div>' +
        '</div>';
      }).join('');
    }

    renderPagination();
  }

  /* ============================================================
     5. PAGINATION
     ============================================================ */
  function renderPagination() {
    const old = document.getElementById('productsPagination');
    if (old) old.remove();

    if (state.totalPages <= 1) return;

    const wrap = document.createElement('div');
    wrap.id = 'productsPagination';
    wrap.style.cssText = 'display:flex;justify-content:space-between;align-items:center;gap:12px;padding:14px 18px;border-top:1px solid var(--gray-100);flex-wrap:wrap';

    const info = document.createElement('div');
    info.className = 'text-muted';
    const start = (state.currentPage - 1) * PAGE_SIZE + 1;
    const end = Math.min(state.currentPage * PAGE_SIZE, state.filteredProducts.length);
    info.textContent = 'Showing ' + start + '–' + end + ' of ' + state.filteredProducts.length;

    const nav = document.createElement('div');
    nav.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap';

    const mkBtn = function (label, page, active, disabled) {
      const b = document.createElement('button');
      b.textContent = label;
      b.style.cssText =
        'min-width:36px;height:36px;border-radius:8px;border:1px solid var(--gray-200);background:' +
        (active ? 'var(--black)' : 'var(--white)') + ';color:' +
        (active ? 'var(--gold)' : 'var(--gray-700)') +
        ';font-weight:700;cursor:pointer;padding:0 10px;font-family:inherit;';
      if (disabled) { b.disabled = true; b.style.opacity = '0.5'; b.style.cursor = 'not-allowed'; }
      if (!disabled && !active) {
        b.addEventListener('click', function () {
          state.currentPage = page;
          renderProducts();
          window.scrollTo({ top: 0, behavior: 'smooth' });
        });
      }
      return b;
    };

    nav.appendChild(mkBtn('‹', state.currentPage - 1, false, state.currentPage === 1));

    const startPage = Math.max(1, state.currentPage - 2);
    const endPage = Math.min(state.totalPages, startPage + 4);

    for (let i = startPage; i <= endPage; i++) {
      nav.appendChild(mkBtn(String(i), i, i === state.currentPage, false));
    }

    nav.appendChild(mkBtn('›', state.currentPage + 1, false, state.currentPage === state.totalPages));

    wrap.appendChild(info);
    wrap.appendChild(nav);

    // Find the products section card and append pagination
    const card = document.querySelector('#section-products .card');
    if (card) card.appendChild(wrap);
  }

  /* ============================================================
     6. PRODUCT EDITOR
     ============================================================ */
  async function openEditor(id) {
    state.editorMode = id ? 'edit' : 'new';
    state.editorId = id;
    state.editorImageUrl = '';

    // Reset fields
    const clear = function (fieldId) {
      const el = document.getElementById(fieldId);
      if (el) el.value = '';
    };
    ['pName', 'pWeight', 'pPrice', 'pOriginalPrice', 'pDescription'].forEach(clear);

    const set = function (fieldId, value) {
      const el = document.getElementById(fieldId);
      if (el) el.checked = value;
    };
    set('pAvailable', true);
    set('pPublished', true);
    set('pFeatured', false);

    const uploadPreview = document.getElementById('uploadPreview');
    const uploadZone = document.getElementById('uploadZone');
    if (uploadPreview) uploadPreview.classList.add('hidden');
    if (uploadZone) uploadZone.classList.remove('hidden');

    // Load categories
    await ensureCategoriesLoaded();
    populateCategoryDropdown('');

    if (state.editorMode === 'edit' && id) {
      const title = document.getElementById('editorTitle');
      const sub = document.getElementById('editorSubtitle');
      if (title) title.textContent = 'Edit Product';
      if (sub) sub.textContent = 'Update the product details below.';

      try {
        const { data, error } = await window.db
          .from('products')
          .select('*')
          .eq('id', id)
          .single();

        if (error) throw error;
        if (!data) { toast('Product not found', 'error'); return; }

        setVal('pName', data.name || '');
        populateCategoryDropdown(data.category || '');
        setVal('pWeight', data.weight || '');
        setVal('pPrice', data.price != null ? data.price : '');
        setVal('pOriginalPrice', data.original_price != null ? data.original_price : '');
        setVal('pDescription', data.description || '');
        set('pAvailable', data.is_available !== false);
        set('pPublished', data.is_published !== false);
        set('pFeatured', data.is_featured === true);

        const img = safeImg(data.image_url);
        if (img) {
          state.editorImageUrl = img;
          showImagePreview(img);
        }
      } catch (err) {
        toast('Unable to load product: ' + (err.message || 'Unknown'), 'error');
        return;
      }
    } else {
      const title = document.getElementById('editorTitle');
      const sub = document.getElementById('editorSubtitle');
      if (title) title.textContent = 'Add Product';
      if (sub) sub.textContent = 'Add a new product to the catalog.';
    }

    window.AdminCore.navigateTo('editor');
  }

  function setVal(id, v) {
    const el = document.getElementById(id);
    if (el) el.value = v;
  }

  /* ============================================================
     7. CATEGORY DROPDOWN IN EDITOR
     ============================================================ */
  async function ensureCategoriesLoaded() {
    if (state.categories.length > 0) return;
    if (!window.db) return;
    try {
      const { data } = await window.db
        .from('categories')
        .select('name, name_ta, icon, is_published')
        .is('deleted_at', null)
        .order('display_order', { ascending: true })
        .order('name', { ascending: true });
      state.categories = data || [];
    } catch (err) {
      // Fallback: derive from products
      state.categories = [...new Set(state.allProducts.map(function (p) { return p.category; }).filter(Boolean))]
        .map(function (c) { return { name: c }; });
    }
  }

  function populateCategoryDropdown(currentValue) {
    const sel = document.getElementById('pCategory');
    const newInput = document.getElementById('pCategoryNew');
    if (!sel) return;

    let html = '<option value="">— Select a category —</option>';
    html += state.categories.map(function (c) {
      const label = esc(c.name) + (c.icon ? ' ' + c.icon : '');
      return '<option value="' + esc(c.name) + '">' + label + '</option>';
    }).join('');
    html += '<option value="__NEW__">➕ Add new category…</option>';
    sel.innerHTML = html;

    if (currentValue && state.categories.some(function (c) { return c.name === currentValue; })) {
      sel.value = currentValue;
      if (newInput) { newInput.style.display = 'none'; newInput.value = ''; }
    } else if (currentValue) {
      const o = document.createElement('option');
      o.value = currentValue;
      o.textContent = currentValue;
      sel.insertBefore(o, sel.querySelector('option[value="__NEW__"]'));
      sel.value = currentValue;
      if (newInput) { newInput.style.display = 'none'; newInput.value = ''; }
    } else {
      sel.value = '';
      if (newInput) { newInput.style.display = 'none'; newInput.value = ''; }
    }
  }

  /* ============================================================
     8. IMAGE HANDLING
     ============================================================ */
  function showImagePreview(url) {
    const img = document.getElementById('uploadPreviewImg');
    const preview = document.getElementById('uploadPreview');
    const zone = document.getElementById('uploadZone');
    if (img) img.src = url;
    if (preview) preview.classList.remove('hidden');
    if (zone) zone.classList.add('hidden');
  }

  async function handleImageUpload(file) {
    if (!window.db) { toast('Not connected', 'error'); return; }

    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowed.includes(file.type)) { toast('Only JPG, PNG or WEBP allowed', 'error'); return; }
    if (file.size > 5 * 1024 * 1024) { toast('Max 5 MB', 'error'); return; }

    toast('Compressing image...');

    // Use compressor if available
    let processed = file;
    if (typeof window.compressToWebP === 'function') {
      processed = await window.compressToWebP(file, 800, 0.82);
    }

    const fname = 'products/' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.webp';

    toast('Uploading...');
    const { error } = await window.db.storage
      .from('product-images')
      .upload(fname, processed, {
        cacheControl: '3600',
        contentType: 'image/webp',
        upsert: false
      });

    if (error) {
      toast('Upload failed: ' + error.message, 'error');
      return;
    }

    const { data } = window.db.storage.from('product-images').getPublicUrl(fname);
    state.editorImageUrl = data.publicUrl;
    showImagePreview(state.editorImageUrl);
    toast('Image uploaded');
  }

  /* ============================================================
     9. SAVE PRODUCT
     ============================================================ */
  async function saveProduct() {
    if (!window.db) { toast('Not connected', 'error'); return; }

    const name = (document.getElementById('pName') || {}).value || '';
    const sel = document.getElementById('pCategory');
    const catValue = sel ? sel.value : '';
    const newCatValue = (document.getElementById('pCategoryNew') || {}).value || '';
    const category = catValue === '__NEW__' ? newCatValue.trim() : catValue.trim();
    const price = parseFloat((document.getElementById('pPrice') || {}).value);
    const originalPrice = parseFloat((document.getElementById('pOriginalPrice') || {}).value);

    if (!name.trim()) { toast('Product name required', 'error'); return; }
    if (!category) { toast('Please select or type a category', 'error'); return; }
    if (isNaN(price) || price < 0) { toast('Enter a valid price', 'error'); return; }

    const payload = {
      name: name.trim(),
      category: category,
      weight: ((document.getElementById('pWeight') || {}).value || '').trim(),
      price: price,
      description: ((document.getElementById('pDescription') || {}).value || '').trim(),
      image_url: state.editorImageUrl || null,
      is_available: (document.getElementById('pAvailable') || {}).checked !== false,
      is_published: (document.getElementById('pPublished') || {}).checked !== false,
      is_featured: (document.getElementById('pFeatured') || {}).checked === true,
      original_price: (!isNaN(originalPrice) && originalPrice > price) ? originalPrice : null
    };

    const btn = document.getElementById('saveProductBtn');
    setBtnLoading(btn, true, 'Saving...');

    try {
      if (state.editorMode === 'edit' && state.editorId) {
        const { error } = await window.db
          .from('products')
          .update(payload)
          .eq('id', state.editorId);
        if (error) throw error;
        toast('Product updated');
      } else {
        const { error } = await window.db
          .from('products')
          .insert(payload);
        if (error) throw error;
        toast('Product created');
      }

      window.AdminCore.navigateTo('products');
      loadProducts();
    } catch (err) {
      toast('Unable to save: ' + (err.message || 'Unknown'), 'error');
    } finally {
      setBtnLoading(btn, false);
    }
  }

  /* ============================================================
     10. TOGGLE PUBLISH / FEATURED
     ============================================================ */
  async function togglePublish(id) {
    if (!window.db) return;
    const p = state.allProducts.find(function (x) { return String(x.id) === String(id); });
    if (!p) return;
    const { error } = await window.db
      .from('products')
      .update({ is_published: !p.is_published })
      .eq('id', id);
    if (error) { toast('Unable to update', 'error'); return; }
    toast(p.is_published ? 'Product hidden' : 'Product published');
    loadProducts();
  }

  /* ============================================================
     11. EVENT WIRING
     ============================================================ */
  function wireEvents() {
    // Search + filters
    ['productSearch', 'filterStatus', 'filterAvailability', 'filterCategory'].forEach(function (id) {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener(id === 'productSearch' ? 'input' : 'change', function () {
        state.currentPage = 1;
        applyFilters();
      });
    });

    // Save product
    const saveBtn = document.getElementById('saveProductBtn');
    if (saveBtn) saveBtn.addEventListener('click', saveProduct);

    // Image upload zone
    const zone = document.getElementById('uploadZone');
    const input = document.getElementById('imageInput');
    if (zone && input) {
      zone.addEventListener('click', function () { input.click(); });
      zone.addEventListener('dragover', function (e) { e.preventDefault(); zone.classList.add('drag'); });
      zone.addEventListener('dragleave', function () { zone.classList.remove('drag'); });
      zone.addEventListener('drop', function (e) {
        e.preventDefault();
        zone.classList.remove('drag');
        const f = e.dataTransfer.files[0];
        if (f) handleImageUpload(f);
      });
      input.addEventListener('change', function (e) {
        const f = e.target.files[0];
        if (f) handleImageUpload(f);
      });
    }

    // Replace / remove image
    const replaceBtn = document.getElementById('replaceImage');
    if (replaceBtn && input) replaceBtn.addEventListener('click', function () { input.click(); });

    const removeBtn = document.getElementById('removeImage');
    if (removeBtn) {
      removeBtn.addEventListener('click', function () {
        state.editorImageUrl = '';
        const prev = document.getElementById('uploadPreview');
        const zone = document.getElementById('uploadZone');
        if (prev) prev.classList.add('hidden');
        if (zone) zone.classList.remove('hidden');
        if (input) input.value = '';
      });
    }

    // Category "Add new" toggle in editor
    const sel = document.getElementById('pCategory');
    const newInput = document.getElementById('pCategoryNew');
    if (sel && newInput) {
      sel.addEventListener('change', function () {
        if (sel.value === '__NEW__') {
          newInput.style.display = '';
          newInput.focus();
        } else {
          newInput.style.display = 'none';
          newInput.value = '';
        }
      });
    }

    // Product actions (edit / toggle / delete) — event delegation
    document.addEventListener('click', function (e) {
      // Only handle when products section is active OR products list exists
      const btn = e.target.closest('[data-act]');
      if (!btn) return;

      // Only intercept in products area (dashboard handles edit separately)
      const activeSection = document.querySelector('.page-section.active');
      if (!activeSection || activeSection.id !== 'section-products') return;

      const act = btn.dataset.act;
      const id = btn.dataset.id;

      if (act === 'edit') { e.preventDefault(); openEditor(id); }
      else if (act === 'del') { /* handled by admin-trash.js */ }
      else if (act === 'toggle-pub') { e.preventDefault(); togglePublish(id); }
    }, true);

    // Bulk import button
    const bulkBtn = document.getElementById('bulkImportBtn');
    if (bulkBtn && typeof window.openBulkImport === 'function') {
      bulkBtn.addEventListener('click', function () { window.openBulkImport(); });
    }
  }

  /* ============================================================
     12. INIT
     ============================================================ */
  function init() {
    wireEvents();
    window.loadProducts = loadProducts;
    window.openEditor = openEditor;
    window.__productsState = state;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();