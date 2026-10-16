/* ============================================================
   CENTRAL & STORES — ADMIN PRODUCTS
   ------------------------------------------------------------
   Full product management:
     • List with pagination (50 per page)
     • Search + filters (status, availability, category)
     • Edit → opens Product Editor
     • Toggle publish
     • Soft delete (moved to Trash, restore via admin-trash.js)

   IMAGE PIPELINE (camera only):
     • Take Photo  → open phone rear camera
                   → enhance → grid-fit (1:1) → mini watermark
                   → compress → multi-size → upload
     • Upload      → same pipeline for existing photos
     • Enhance     → re-run enhancement on the current preview

   CATEGORY PICKER (in Product Editor):
     • Dropdown populated from `categories` table
     • Edit button → inline rename → cascades to products
     • Delete button → soft delete
     • + Add new panel → creates category in DB

   Depends on:
     admin-core.js, admin-trash.js, admin-image-enhancer.js,
     admin-image-camera.js, admin-image-watermark.js
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
      const { data, error } = await window.db
        .from('products')
        .select('*')
        .is('deleted_at', null)
        .order('created_at', { ascending: false });

      if (error) throw error;

      state.allProducts = data || [];
      state.loaded = true;

      await loadCategoryList();

      populateCategoryFilter();
      applyFilters();
    } catch (err) {
      console.warn('[products] load failed:', err);
      if (tbody) tbody.innerHTML = '<tr><td colspan="8"><div class="empty"><h3>Unable to load products</h3><p>' + esc(err.message || '') + '</p></div></td></tr>';
      if (mobile) mobile.innerHTML = '';
    }
  }

  /* ============================================================
     2. LOAD CATEGORIES
     ============================================================ */
  async function loadCategoryList() {
    if (!window.db) return;
    try {
      const { data, error } = await window.db
        .from('categories')
        .select('id, name, name_ta, slug, icon, is_published')
        .eq('is_published', true)
        .is('deleted_at', null)
        .order('display_order', { ascending: true })
        .order('name', { ascending: true });

      if (error) throw error;
      state.categories = data || [];
    } catch (err) {
      console.warn('[products] category load failed:', err);
      state.categories = [...new Set(state.allProducts.map(function (p) { return p.category; }).filter(Boolean))]
        .map(function (c, i) { return { id: 'fallback-' + i, name: c }; });
    }
  }

  /* ============================================================
     3. CATEGORY FILTER DROPDOWN
     ============================================================ */
  function populateCategoryFilter() {
    const sel = document.getElementById('filterCategory');
    if (!sel) return;

    const current = sel.value;

    let html = '<option value="">All Categories</option>';
    html += state.categories.map(function (c) {
      return '<option value="' + esc(c.name) + '">' + esc(c.name) + '</option>';
    }).join('');

    sel.innerHTML = html;
    if (current) sel.value = current;
  }

  /* ============================================================
     4. FILTERS + SEARCH
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
     5. RENDER PRODUCTS
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
     6. PAGINATION
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

    const card = document.querySelector('#section-products .card');
    if (card) card.appendChild(wrap);
  }

  /* ============================================================
     7. PRODUCT EDITOR
     ============================================================ */
  async function openEditor(id) {
    state.editorMode = id ? 'edit' : 'new';
    state.editorId = id;
    state.editorImageUrl = '';

    ['pName', 'pWeight', 'pPrice', 'pOriginalPrice', 'pDescription'].forEach(function (fieldId) {
      const el = document.getElementById(fieldId);
      if (el) el.value = '';
    });

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

    const newPanel = document.getElementById('catNewInline');
    if (newPanel) newPanel.style.display = 'none';
    const newInput = document.getElementById('pCategoryNew');
    if (newInput) newInput.value = '';

    await loadCategoryList();
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
     8. CATEGORY DROPDOWN
     ============================================================ */
  function populateCategoryDropdown(currentValue) {
    const sel = document.getElementById('pCategory');
    if (!sel) return;

    let html = '<option value="">— Select a category —</option>';
    html += state.categories.map(function (c) {
      return '<option value="' + esc(c.name) + '">' + esc(c.name) + '</option>';
    }).join('');
    html += '<option value="__NEW__">+ Add new category…</option>';
    sel.innerHTML = html;

    if (currentValue) {
      const exists = state.categories.some(function (c) { return c.name === currentValue; });
      if (exists) {
        sel.value = currentValue;
      } else {
        const o = document.createElement('option');
        o.value = currentValue;
        o.textContent = currentValue + ' (not in list)';
        sel.insertBefore(o, sel.querySelector('option[value="__NEW__"]'));
        sel.value = currentValue;
      }
    } else {
      sel.value = '';
    }

    updateCatActionButtons();
  }

  function updateCatActionButtons() {
    const sel = document.getElementById('pCategory');
    const editBtn = document.getElementById('catEditBtn');
    const deleteBtn = document.getElementById('catDeleteBtn');
    if (!sel || !editBtn || !deleteBtn) return;

    const val = sel.value;
    const hasRealCategory = !!(val && val !== '' && val !== '__NEW__');

    editBtn.disabled = !hasRealCategory;
    deleteBtn.disabled = !hasRealCategory;
  }

  /* ============================================================
     9. CATEGORY EDIT (rename)
     ============================================================ */
  async function handleCategoryEdit() {
    const sel = document.getElementById('pCategory');
    if (!sel) return;
    const currentName = sel.value;
    if (!currentName || currentName === '__NEW__') return;

    const newName = prompt('Rename category "' + currentName + '" to:', currentName);
    if (!newName || newName.trim() === '' || newName.trim() === currentName) return;

    const cleanNewName = newName.trim();

    try {
      const { error } = await window.db
        .from('categories')
        .update({ name: cleanNewName })
        .eq('name', currentName)
        .is('deleted_at', null);

      if (error) throw error;

      toast('Category renamed — products updated');

      await loadCategoryList();
      populateCategoryDropdown(cleanNewName);
      loadProducts();
    } catch (err) {
      toast('Rename failed: ' + (err.message || 'Unknown'), 'error');
    }
  }

  /* ============================================================
     10. CATEGORY DELETE (soft)
     ============================================================ */
  async function handleCategoryDelete() {
    const sel = document.getElementById('pCategory');
    if (!sel) return;
    const currentName = sel.value;
    if (!currentName || currentName === '__NEW__') return;

    if (!confirm('Move category "' + currentName + '" to Trash?\n\nProducts in this category will keep the name until you rename them. You can restore the category from the Categories page.')) return;

    try {
      const { error } = await window.db
        .from('categories')
        .update({ deleted_at: new Date().toISOString() })
        .eq('name', currentName)
        .is('deleted_at', null);

      if (error) throw error;

      toast('Category moved to Trash');

      await loadCategoryList();
      populateCategoryDropdown('');
    } catch (err) {
      toast('Delete failed: ' + (err.message || 'Unknown'), 'error');
    }
  }

  /* ============================================================
     11. CATEGORY ADD NEW
     ============================================================ */
  async function handleCategoryCreate() {
    const input = document.getElementById('pCategoryNew');
    const saveBtn = document.getElementById('catNewSaveBtn');
    if (!input) return;

    const name = (input.value || '').trim();
    if (!name) { toast('Enter a category name', 'error'); return; }

    const exists = state.categories.some(function (c) {
      return c.name.toLowerCase() === name.toLowerCase();
    });
    if (exists) {
      toast('A category with that name already exists', 'error');
      return;
    }

    setBtnLoading(saveBtn, true, 'Creating...');

    try {
      const slug = name.toLowerCase().replace(/&/g, 'and').replace(/[^\w]+/g, '-').replace(/^-+|-+$/g, '');

      const { error } = await window.db
        .from('categories')
        .insert({
          name: name,
          slug: slug,
          icon: null,
          is_published: true,
          display_order: 0
        });

      if (error) throw error;

      toast('Category created');

      await loadCategoryList();
      populateCategoryDropdown(name);

      const panel = document.getElementById('catNewInline');
      if (panel) panel.style.display = 'none';
      input.value = '';
    } catch (err) {
      toast('Create failed: ' + (err.message || 'Unknown'), 'error');
    } finally {
      setBtnLoading(saveBtn, false);
    }
  }

  /* ============================================================
     12. IMAGE HANDLING
     ============================================================ */
  function showImagePreview(url) {
    const img = document.getElementById('uploadPreviewImg');
    const preview = document.getElementById('uploadPreview');
    const zone = document.getElementById('uploadZone');
    if (img) img.src = url;
    if (preview) preview.classList.remove('hidden');
    if (zone) zone.classList.add('hidden');
  }

  /* ============================================================
     CORE UPLOAD PIPELINE
     ------------------------------------------------------------
     Runs the full chain on any raw blob (from camera or file):
       enhance → grid-fit (1:1) → mini watermark
       → multi-size compress → upload to Supabase
     Returns the public URL.
     ============================================================ */
  async function processAndUpload(rawBlob) {
    let blob = rawBlob;

    // 1. Enhance + grid-fit + watermark (all inside CameraCapture.process)
    if (window.CameraCapture && typeof window.CameraCapture.process === 'function') {
      try {
        toast('Enhancing…');
        blob = await window.CameraCapture.process(blob);
      } catch (e) {
        console.warn('[upload] camera pipeline failed:', e.message);
        // continue with raw blob if the pipeline fails
        blob = rawBlob;
      }
    } else {
      // Fallback: just enhance if the camera module isn't loaded
      if (window.ImageEnhancer && typeof window.ImageEnhancer.enhance === 'function') {
        try {
          blob = await window.ImageEnhancer.enhance(blob, { mode: 'catalogue' });
        } catch (e) {}
      }
    }

    // 2. Multi-size compress + upload
    if (window.MultiSizeUploader && typeof window.MultiSizeUploader.uploadAll === 'function') {
      toast('Compressing and uploading…');
      const r = await window.MultiSizeUploader.uploadAll(blob, 'product-images', 'products');
      if (!r || !r.url) throw new Error('Multi-size upload returned no URL');
      return r.url;
    }

    // Fallback single-size upload
    toast('Compressing and uploading…');
    let compressed = blob;
    if (window.ImageCompressor && typeof window.ImageCompressor.compressToWebP === 'function') {
      try {
        compressed = await window.ImageCompressor.compressToWebP(blob, 'product');
      } catch (e) {}
    }

    const fname = 'products/photo-' + Date.now() + '-' +
      Math.random().toString(36).slice(2, 8) + '.webp';

    const { error } = await window.db.storage
      .from('product-images')
      .upload(fname, compressed, {
        cacheControl: '31536000',
        contentType: compressed.type || 'image/webp',
        upsert: false
      });

    if (error) throw error;

    const { data } = window.db.storage.from('product-images').getPublicUrl(fname);
    if (!data || !data.publicUrl) throw new Error('No public URL');
    return data.publicUrl;
  }

  /* ----------------------------------------------------------
     Take Photo handler
  ---------------------------------------------------------- */
  async function handleTakePhoto() {
    const cameraInput = document.getElementById('cameraInput');
    if (!cameraInput) {
      toast('Camera input not found', 'error');
      return;
    }
    // reset so the same file can be re-selected
    cameraInput.value = '';
    cameraInput.click();
  }

  async function handleCameraFile(file) {
    if (!file) return;

    const takeBtn = document.getElementById('takePhotoBtn');
    const original = takeBtn ? takeBtn.innerHTML : '';
    if (takeBtn) {
      takeBtn.disabled = true;
      takeBtn.innerHTML = 'Processing…';
    }

    try {
      const url = await processAndUpload(file);
      state.editorImageUrl = url;
      if (window.__productsState) window.__productsState.editorImageUrl = url;
      showImagePreview(url);
      toast('Photo ready');
    } catch (err) {
      console.warn('[camera] failed:', err);
      toast('Camera failed: ' + (err.message || 'Unknown'), 'error');
    } finally {
      if (takeBtn) {
        takeBtn.disabled = false;
        takeBtn.innerHTML = original;
      }
    }
  }

  /* ----------------------------------------------------------
     Upload-zone handler (file picker)
  ---------------------------------------------------------- */
  async function handleImageUpload(file) {
    if (!window.db) { toast('Not connected', 'error'); return; }

    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
    if (file.type && allowed.indexOf(file.type) === -1) {
      // allow anything with an empty type — some phones report empty
      if (file.type !== '') {
        toast('Only JPG, PNG or WEBP allowed', 'error');
        return;
      }
    }
    if (file.size > 15 * 1024 * 1024) { toast('Max 15 MB', 'error'); return; }

    try {
      const url = await processAndUpload(file);
      state.editorImageUrl = url;
      if (window.__productsState) window.__productsState.editorImageUrl = url;
      showImagePreview(url);
      toast('Image ready');
    } catch (err) {
      toast('Upload failed: ' + (err.message || 'Unknown'), 'error');
    }
  }

  /* ----------------------------------------------------------
     Enhance button handler — re-runs enhance on current image
  ---------------------------------------------------------- */
  async function handleEnhanceClick() {
    if (!state.editorImageUrl) {
      toast('No image to enhance — take a photo first', 'error');
      return;
    }

    const btn = document.getElementById('enhanceImageBtn');
    if (!btn) return;

    const original = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = 'Enhancing…';

    try {
      // Fetch current image as blob
      const resp = await fetch(state.editorImageUrl, { mode: 'cors' });
      if (!resp.ok) throw new Error('Fetch HTTP ' + resp.status);
      const blob = await resp.blob();

      const url = await processAndUpload(blob);
      state.editorImageUrl = url;
      if (window.__productsState) window.__productsState.editorImageUrl = url;
      showImagePreview(url);
      toast('Enhanced and uploaded');
    } catch (err) {
      toast('Enhance failed: ' + (err.message || 'Unknown'), 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = original;
    }
  }

  /* ============================================================
     13. SAVE PRODUCT
     ============================================================ */
  async function saveProduct() {
    if (!window.db) { toast('Not connected', 'error'); return; }

    const name = (document.getElementById('pName') || {}).value || '';
    const sel = document.getElementById('pCategory');
    const category = sel ? sel.value : '';
    const price = parseFloat((document.getElementById('pPrice') || {}).value);
    const originalPrice = parseFloat((document.getElementById('pOriginalPrice') || {}).value);

    if (!name.trim()) { toast('Product name required', 'error'); return; }
    if (!category || category === '__NEW__') {
      toast('Please select or create a category', 'error');
      return;
    }
    if (isNaN(price) || price < 0) { toast('Enter a valid price', 'error'); return; }

    const payload = {
      name: name.trim(),
      category: category.trim(),
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
     14. TOGGLE PUBLISH
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
     15. EVENT WIRING
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

    /* ---------- Take Photo ---------- */
    const takePhotoBtn = document.getElementById('takePhotoBtn');
    const cameraInput = document.getElementById('cameraInput');
    if (takePhotoBtn && cameraInput) {
      takePhotoBtn.addEventListener('click', handleTakePhoto);
      cameraInput.addEventListener('change', function (e) {
        const file = e.target.files && e.target.files[0];
        if (file) handleCameraFile(file);
      });
    }

    /* ---------- Upload zone ---------- */
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
        if (window.__productsState) window.__productsState.editorImageUrl = '';
        const prev = document.getElementById('uploadPreview');
        const zone = document.getElementById('uploadZone');
        if (prev) prev.classList.add('hidden');
        if (zone) zone.classList.remove('hidden');
        if (input) input.value = '';
      });
    }

    // Enhance button
    const enhanceBtn = document.getElementById('enhanceImageBtn');
    if (enhanceBtn) enhanceBtn.addEventListener('click', handleEnhanceClick);

    /* ---------- CATEGORY PICKER ---------- */
    const catSel = document.getElementById('pCategory');
    const newPanel = document.getElementById('catNewInline');
    const newInput = document.getElementById('pCategoryNew');

    if (catSel) {
      catSel.addEventListener('change', function () {
        if (catSel.value === '__NEW__') {
          if (newPanel) newPanel.style.display = '';
          if (newInput) { newInput.value = ''; newInput.focus(); }
          catSel.value = '';
          updateCatActionButtons();
        } else {
          if (newPanel) newPanel.style.display = 'none';
          updateCatActionButtons();
        }
      });
    }

    const catEditBtn = document.getElementById('catEditBtn');
    if (catEditBtn) catEditBtn.addEventListener('click', handleCategoryEdit);

    const catDeleteBtn = document.getElementById('catDeleteBtn');
    if (catDeleteBtn) catDeleteBtn.addEventListener('click', handleCategoryDelete);

    const catNewSaveBtn = document.getElementById('catNewSaveBtn');
    if (catNewSaveBtn) catNewSaveBtn.addEventListener('click', handleCategoryCreate);

    const catNewCancelBtn = document.getElementById('catNewCancelBtn');
    if (catNewCancelBtn) {
      catNewCancelBtn.addEventListener('click', function () {
        if (newPanel) newPanel.style.display = 'none';
        if (newInput) newInput.value = '';
        if (catSel) catSel.value = '';
        updateCatActionButtons();
      });
    }

    if (newInput) {
      newInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          handleCategoryCreate();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          if (catNewCancelBtn) catNewCancelBtn.click();
        }
      });
    }

    /* ---------- PRODUCT LIST ACTIONS ---------- */
    document.addEventListener('click', function (e) {
      const btn = e.target.closest('[data-act]');
      if (!btn) return;

      const activeSection = document.querySelector('.page-section.active');
      if (!activeSection || activeSection.id !== 'section-products') return;

      const act = btn.dataset.act;
      const id = btn.dataset.id;

      if (act === 'edit') { e.preventDefault(); openEditor(id); }
      else if (act === 'del') { /* handled by admin-trash.js */ }
      else if (act === 'toggle-pub') { e.preventDefault(); togglePublish(id); }
    }, true);

    // Bulk import
    const bulkBtn = document.getElementById('bulkImportBtn');
    if (bulkBtn && typeof window.openBulkImport === 'function') {
      bulkBtn.addEventListener('click', function () { window.openBulkImport(); });
    }
  }

  /* ============================================================
     16. INIT
     ============================================================ */
  function init() {
    wireEvents();
    window.loadProducts = loadProducts;
    window.openEditor = openEditor;
    window.reloadCategoriesInEditor = loadCategoryList;
    window.__productsState = state;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();