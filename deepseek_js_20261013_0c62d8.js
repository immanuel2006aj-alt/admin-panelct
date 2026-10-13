/* ============================================================
   CENTRAL & STORES — ADMIN CATEGORIES
   ------------------------------------------------------------
   Full CRUD for the categories table:
     • List (grid view)
     • Add category
     • Edit (rename, Tamil name, icon, image, display order, publish toggle)
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
    loaded: false
  };

  /* ============================================================
     1. LOAD CATEGORIES
     ============================================================ */
  async function loadCategories() {
    if (!window.db) return;

    const grid = document.getElementById('categoriesGrid');
    if (grid) {
      grid.innerHTML = '<div class="skeleton" style="height:140px"></div><div class="skeleton" style="height:140px"></div><div class="skeleton" style="height:140px"></div>';
    }

    try {
      // Fetch categories
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
      renderCategories();
    } catch (err) {
      console.warn('[categories] load failed:', err);
      if (grid) {
        grid.innerHTML = '<div class="empty"><h3>Unable to load categories</h3><p>' + esc(err.message || '') + '</p></div>';
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
          '<svg viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h10" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="18" cy="18" r="2" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>' +
          '<h3>No categories yet</h3>' +
          '<p>Add your first category to organize products.</p>' +
          '<button class="btn btn-primary" id="catEmptyAddBtn">Add Category</button>' +
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
      const thumb = img
        ? '<img src="' + esc(img) + '" alt="" loading="lazy">'
        : '<span class="cat-fallback">' + esc(cat.icon || '🛒') + '</span>';

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
          ? 'Rename or update this category. Renaming cascades to all products.'
          : 'Add a new category. It appears on the public site instantly.') + '</p>' +

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
            '<label for="catIcon">Icon (emoji)</label>' +
            '<input type="text" id="catIcon" maxlength="4" value="' + esc(existing ? (existing.icon || '🛒') : '🛒') + '" placeholder="🛒">' +
          '</div>' +
          '<div class="field">' +
            '<label for="catOrder">Display order</label>' +
            '<input type="number" id="catOrder" min="0" step="1" value="' + (existing ? (existing.display_order || 0) : 0) + '">' +
          '</div>' +
        '</div>' +

        '<div class="field">' +
          '<label for="catImageUrl">Image URL (optional)</label>' +
          '<input type="text" id="catImageUrl" maxlength="500" value="' + esc(existing ? (existing.image_url || '') : '') + '" placeholder="https://...">' +
          '<div class="field-hint">Leave blank to use the emoji fallback.</div>' +
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
    };

    document.getElementById('catCancelBtn').addEventListener('click', close);
    modal.addEventListener('click', function (e) { if (e.target === modal) close(); });
    document.addEventListener('keydown', function escHandler(e) {
      if (e.key === 'Escape') { close(); document.removeEventListener('keydown', escHandler); }
    });

    document.getElementById('catSaveBtn').addEventListener('click', async function () {
      const btn = this;
      const name = (document.getElementById('catName').value || '').trim();
      const nameTa = (document.getElementById('catNameTa').value || '').trim();
      const icon = (document.getElementById('catIcon').value || '').trim() || '🛒';
      const imageUrl = (document.getElementById('catImageUrl').value || '').trim();
      const description = (document.getElementById('catDescription').value || '').trim();
      const order = parseInt(document.getElementById('catOrder').value, 10) || 0;
      const published = document.getElementById('catPublished').checked;

      if (!name) { toast('Category name is required', 'error'); return; }

      const payload = {
        name: name,
        name_ta: nameTa || null,
        icon: icon,
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
      ? 'Warning: ' + count + ' product' + (count === 1 ? '' : 's') + ' still use this category.\n\nProducts will keep their category name until you rename it.\n\n'
      : '';

    if (!confirm(warning + 'Move "' + cat.name + '" to Trash? You can restore it later.')) return;

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
    if (newBtn) {
      newBtn.addEventListener('click', function () { openCategoryForm(null); });
    }

    // Category card actions (edit / delete)
    document.addEventListener('click', function (e) {
      const btn = e.target.closest('[data-cat-act]');
      if (!btn) return;

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
     6. INIT
     ============================================================ */
  function init() {
    wireEvents();

    // Expose globally
    window.loadCategories = loadCategories;
    window.openCategoryForm = openCategoryForm;

    // If categories section is active on load, fetch
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