/* ============================================================
   CENTRAL & STORES — ADMIN CATEGORIES
   ------------------------------------------------------------
   Full CRUD for the categories table:
     • List (grid view)
     • Add category (modal)
     • Edit category (modal — all fields)
     • Rename cascade — DB trigger updates all products
     • Soft delete (moves to Trash, restore via admin-trash.js)
     • Product count per category
     • Live reflection on public site via Supabase Realtime

   Depends on: admin-core.js (window.db, window.AdminCore)
   ============================================================ */

(function () {
  'use strict';

  const esc = window.AdminCore.esc;
  const safeImg = window.AdminCore.safeImg;
  const toast = window.AdminCore.toast;
  const setBtnLoading = window.AdminCore.setBtnLoading;

  /* ============================================================
     STATE
     ============================================================ */
  const state = {
    categories: [],
    productCounts: {},
    loaded: false,
    loadedOnce: false
  };

  /* ============================================================
     1. LOAD CATEGORIES
     ============================================================ */
  async function loadCategories() {
    if (!window.db) return;

    const grid = document.getElementById('categoriesGrid');
    if (grid && !state.loadedOnce) {
      grid.innerHTML =
        '<div class="skeleton" style="height:140px"></div>' +
        '<div class="skeleton" style="height:140px"></div>' +
        '<div class="skeleton" style="height:140px"></div>';
    }

    try {
      // Fetch non-deleted categories
      const { data: cats, error: catErr } = await window.db
        .from('categories')
        .select('*')
        .is('deleted_at', null)
        .order('display_order', { ascending: true })
        .order('name', { ascending: true });

      if (catErr) throw catErr;
      state.categories = cats || [];

      // Fetch product counts per category
      const { data: prods } = await window.db
        .from('products')
        .select('category')
        .is('deleted_at', null);

      const counts = {};
      (prods || []).forEach(function (p) {
        if (p.category) counts[p.category] = (counts[p.category] || 0) + 1;
      });
      state.productCounts = counts;

      state.loaded = true;
      state.loadedOnce = true;
      renderCategories();
    } catch (err) {
      console.warn('[categories] load failed:', err);
      if (grid) {
        grid.innerHTML =
          '<div class="empty" style="grid-column:1/-1">' +
            '<h3>Unable to load categories</h3>' +
            '<p>' + esc(err.message || 'Unknown error') + '</p>' +
            '<button class="btn btn-primary" id="catRetryBtn">Try Again</button>' +
          '</div>';
        const retry = document.getElementById('catRetryBtn');
        if (retry) retry.addEventListener('click', loadCategories);
      }
    }
  }

  /* ============================================================
     2. RENDER CATEGORY GRID
     ============================================================ */
  function renderCategories() {
    const grid = document.getElementById('categoriesGrid');
    if (!grid) return;

    if (state.categories.length === 0) {
      grid.innerHTML =
        '<div class="empty" style="grid-column:1/-1">' +
          '<svg viewBox="0 0 24 24" style="width:48px;height:48px;stroke:#cbd2dc;fill:none;stroke-width:1.5;margin:0 auto 16px">' +
            '<path d="M4 6h16M4 12h16M4 18h10"/>' +
            '<circle cx="18" cy="18" r="2"/>' +
          '</svg>' +
          '<h3>No categories yet</h3>' +
          '<p>Add your first category to organize products.</p>' +
          '<button class="btn btn-primary" id="catEmptyAddBtn">' +
            '<svg viewBox="0 0 24 24" style="width:16px;height:16px;margin-right:6px">' +
              '<line x1="12" y1="5" x2="12" y2="19" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' +
              '<line x1="5" y1="12" x2="19" y2="12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' +
            '</svg>' +
            'Add Category' +
          '</button>' +
        '</div>';

      const emptyBtn = document.getElementById('catEmptyAddBtn');
      if (emptyBtn) {
        emptyBtn.addEventListener('click', function () { openCategoryForm(null); });
      }
      return;
    }

    grid.innerHTML = state.categories.map(function (cat) {
      const count = state.productCounts[cat.name] || 0;
      const img = safeImg(cat.image_url);

      // Thumbnail: prefer image, fallback to icon (if user set), else neutral letter
      let thumb;
      if (img) {
        thumb = '<img src="' + esc(img) + '" alt="" loading="lazy">';
      } else if (cat.icon && cat.icon !== '🛒') {
        // User set a custom icon — show it (this is intentional, not our default)
        thumb = '<span class="cat-fallback" style="font-size:2rem">' + esc(cat.icon) + '</span>';
      } else {
        // Neutral first letter of name
        thumb = '<span class="cat-fallback" style="font-size:1.75rem;font-weight:800;color:#9aa6b5">' +
                esc((cat.name || '?').charAt(0).toUpperCase()) +
                '</span>';
      }

      const tamilLine = cat.name_ta
        ? '<div class="cat-card-name-ta">' + esc(cat.name_ta) + '</div>'
        : '';

      return '<div class="cat-card" data-cat-id="' + esc(String(cat.id)) + '">' +
        '<div class="cat-card-thumb">' + thumb + '</div>' +
        '<div class="cat-card-name">' + esc(cat.name) + '</div>' +
        tamilLine +
        '<div class="cat-card-meta">' +
          count + ' product' + (count === 1 ? '' : 's') +
          ' · ' + (cat.is_published ? '✓ Live' : '✗ Hidden') +
          (cat.display_order ? ' · #' + cat.display_order : '') +
        '</div>' +
        '<div class="cat-card-actions">' +
          '<button class="action-btn edit" data-cat-act="edit" data-id="' + esc(String(cat.id)) + '">' +
            '<svg viewBox="0 0 24 24"><use href="#icon-edit"></use></svg> Edit' +
          '</button>' +
          '<button class="icon-action danger" data-cat-act="delete" data-id="' + esc(String(cat.id)) + '" title="Delete" aria-label="Delete category">' +
            '<svg viewBox="0 0 24 24"><use href="#icon-trash"></use></svg>' +
          '</button>' +
        '</div>' +
      '</div>';
    }).join('');
  }

  /* ============================================================
     3. CATEGORY FORM MODAL
     ============================================================ */
  async function openCategoryForm(id) {
    let existing = null;
    if (id) {
      const { data, error } = await window.db
        .from('categories')
        .select('*')
        .eq('id', id)
        .single();
      if (error) { toast('Unable to load category', 'error'); return; }
      existing = data;
    }

    const modal = document.createElement('div');
    modal.className = 'modal-overlay open';
    modal.id = 'catFormModal';
    modal.innerHTML =
      '<div class="modal" role="dialog" aria-modal="true" aria-labelledby="catFormTitle">' +
        '<h3 id="catFormTitle">' + (existing ? 'Edit Category' : 'Add Category') + '</h3>' +
        '<p>' + (existing
          ? 'Rename or update this category. Renaming cascades to all products automatically.'
          : 'Add a new category. It appears on the public site within seconds.') + '</p>' +

        '<div class="field">' +
          '<label for="catName">Category Name (English) *</label>' +
          '<input type="text" id="catName" maxlength="60" value="' + esc(existing ? existing.name : '') + '" placeholder="e.g. Fresh Vegetables">' +
        '</div>' +

        '<div class="field">' +
          '<label for="catNameTa">Tamil Name (optional)</label>' +
          '<input type="text" id="catNameTa" maxlength="60" value="' + esc(existing ? (existing.name_ta || '') : '') + '" placeholder="e.g. காய்கறிகள்">' +
        '</div>' +

        '<div class="field-row">' +
          '<div class="field">' +
            '<label for="catIcon">Icon (optional, emoji)</label>' +
            '<input type="text" id="catIcon" maxlength="4" value="' + esc(existing ? (existing.icon || '') : '') + '" placeholder="Optional">' +
            '<div class="field-hint">Leave blank to use the first letter.</div>' +
          '</div>' +
          '<div class="field">' +
            '<label for="catOrder">Display order</label>' +
            '<input type="number" id="catOrder" min="0" step="1" value="' + (existing ? (existing.display_order || 0) : 0) + '">' +
            '<div class="field-hint">Lower numbers appear first.</div>' +
          '</div>' +
        '</div>' +

        '<div class="field">' +
          '<label for="catImageUrl">Image URL (optional)</label>' +
          '<input type="text" id="catImageUrl" maxlength="500" value="' + esc(existing ? (existing.image_url || '') : '') + '" placeholder="https://...">' +
          '<div class="field-hint">Leave blank to use the icon or first letter.</div>' +
        '</div>' +

        '<div class="field">' +
          '<label for="catDescription">Description (optional)</label>' +
          '<textarea id="catDescription" rows="2" maxlength="300" placeholder="Short description">' + esc(existing ? (existing.description || '') : '') + '</textarea>' +
        '</div>' +

        '<div class="switch-row">' +
          '<div class="switch-row-info">' +
            '<div class="switch-row-label">Published</div>' +
            '<div class="switch-row-hint">Visible on the public site</div>' +
          '</div>' +
          '<label class="switch"><input type="checkbox" id="catPublished" ' + (!existing || existing.is_published ? 'checked' : '') + '><span class="switch-slider"></span></label>' +
        '</div>' +

        '<div class="modal-actions" style="margin-top:20px">' +
          '<button class="btn btn-secondary" id="catCancelBtn" type="button">Cancel</button>' +
          '<button class="btn btn-primary" id="catSaveBtn" type="button">' + (existing ? 'Save Changes' : 'Create Category') + '</button>' +
        '</div>' +
      '</div>';

    document.body.appendChild(modal);
    document.body.style.overflow = 'hidden';

    const close = function () {
      modal.remove();
      document.body.style.overflow = '';
      document.removeEventListener('keydown', escHandler);
    };

    function escHandler(e) {
      if (e.key === 'Escape') close();
    }

    document.getElementById('catCancelBtn').addEventListener('click', close);
    modal.addEventListener('click', function (e) { if (e.target === modal) close(); });
    document.addEventListener('keydown', escHandler);

    document.getElementById('catSaveBtn').addEventListener('click', async function () {
      const btn = this;
      const name = (document.getElementById('catName').value || '').trim();
      const nameTa = (document.getElementById('catNameTa').value || '').trim();
      const icon = (document.getElementById('catIcon').value || '').trim();
      const imageUrl = (document.getElementById('catImageUrl').value || '').trim();
      const description = (document.getElementById('catDescription').value || '').trim();
      const order = parseInt(document.getElementById('catOrder').value, 10) || 0;
      const published = document.getElementById('catPublished').checked;

      if (!name) { toast('Category name is required', 'error'); return; }

      // Build slug from name
      const slug = name.toLowerCase().replace(/&/g, 'and').replace(/[^\w]+/g, '-').replace(/^-+|-+$/g, '');

      const payload = {
        name: name,
        name_ta: nameTa || null,
        slug: existing ? existing.slug : slug,
        icon: icon || null,
        image_url: imageUrl || null,
        description: description || null,
        display_order: order,
        is_published: published
      };

      setBtnLoading(btn, true, 'Saving...');

      try {
        let result;
        if (existing) {
          result = await window.db.from('categories').update(payload).eq('id', existing.id);
        } else {
          result = await window.db.from('categories').insert(payload);
        }

        if (result.error) throw result.error;

        toast(existing ? 'Category updated' : 'Category created');
        close();
        loadCategories();
      } catch (err) {
        toast('Failed: ' + (err.message || 'Unknown error'), 'error');
      } finally {
        setBtnLoading(btn, false);
      }
    });
  }

  /* ============================================================
     4. SOFT DELETE CATEGORY
     ============================================================ */
  async function deleteCategory(id) {
    const cat = state.categories.find(function (c) { return String(c.id) === String(id); });
    if (!cat) return;

    const count = state.productCounts[cat.name] || 0;
    const warning = count > 0
      ? 'Warning: ' + count + ' product' + (count === 1 ? '' : 's') + ' still use this category.\n\nProducts will keep their category name until you rename them.\n\n'
      : '';

    if (!confirm(warning + 'Move "' + cat.name + '" to Trash?\n\nYou can restore it later from the Trash view.')) return;

    const { error } = await window.db
      .from('categories')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id);

    if (error) { toast('Unable to delete: ' + error.message, 'error'); return; }

    toast('Category moved to Trash');
    loadCategories();
  }

  /* ============================================================
     5. EVENT WIRING
     ============================================================ */
  function wireEvents() {
    // Add Category button (page head)
    const newBtn = document.getElementById('catNewBtn');
    if (newBtn && newBtn.dataset.wired !== '1') {
      newBtn.dataset.wired = '1';
      newBtn.addEventListener('click', function () { openCategoryForm(null); });
    }

    // Category card actions — event delegation
    document.addEventListener('click', function (e) {
      const btn = e.target.closest('[data-cat-act]');
      if (!btn) return;

      // Only intercept in categories section
      const activeSection = document.querySelector('.page-section.active');
      if (!activeSection || activeSection.id !== 'section-categories') return;

      const act = btn.dataset.catAct;
      const id = btn.dataset.id;
      if (!id) return;

      if (act === 'edit') {
        e.preventDefault();
        openCategoryForm(id);
      } else if (act === 'delete') {
        e.preventDefault();
        deleteCategory(id);
      }
    }, true);
  }

  /* ============================================================
     6. WATCH SECTION NAVIGATION
     ============================================================ */
  function watchSection() {
    const section = document.getElementById('section-categories');
    if (!section) return;

    const observer = new MutationObserver(function () {
      if (section.classList.contains('active')) {
        loadCategories();
      }
    });
    observer.observe(section, { attributes: true, attributeFilter: ['class'] });
  }

  /* ============================================================
     7. INIT
     ============================================================ */
  function init() {
    wireEvents();
    watchSection();

    window.loadCategories = loadCategories;
    window.openCategoryForm = openCategoryForm;

    const section = document.getElementById('section-categories');
    if (section && section.classList.contains('active')) {
      loadCategories();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();