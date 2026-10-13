/* ============================================================
   CENTRAL & STORES — ADMIN TRASH SYSTEM
   ------------------------------------------------------------
   Soft delete + restore + permanent delete for:
     • Products
     • Orders
     • Reviews
     • Advertisements
     • Categories

   Hooks into existing [data-act] buttons:
     del       → soft delete (moves to Trash)
     restore   → restores from Trash
     purge     → permanent delete (only from Trash view)

   Adds a 🗑 Trash tab to each section, showing deleted items
   with Restore and Delete Forever buttons.

   Depends on: admin-core.js (window.db, window.AdminCore, window.toast)
   ============================================================ */

(function () {
  'use strict';

  const esc = window.AdminCore.esc;
  const safeImg = window.AdminCore.safeImg;
  const toast = window.AdminCore.toast;
  const setBtnLoading = window.AdminCore.setBtnLoading;

  /* ============================================================
     TABLE → PAGE MAP
     ============================================================ */
  const TABLE_MAP = {
    products: 'products',
    orders: 'orders',
    reviews: 'reviews',
    ads: 'advertisements',
    advertisements: 'advertisements',
    categories: 'categories'
  };

  /* ============================================================
     1. STATE
     ============================================================ */
  const trashState = {
    currentView: 'alive', // 'alive' or 'trash'
    loadedTrash: false
  };

  /* ============================================================
     2. GET TABLE FOR CURRENT PAGE
     ============================================================ */
  function getTableForPage() {
    const activeSection = document.querySelector('.page-section.active');
    if (!activeSection) return null;
    const pageId = activeSection.id.replace('section-', '');
    return TABLE_MAP[pageId] || null;
  }

  /* ============================================================
     3. GET ITEM NAME FOR DISPLAY
     ============================================================ */
  function itemName(item) {
    return item.name ||
           item.title ||
           item.order_number ||
           item.customer_name ||
           ('#' + item.id);
  }

  /* ============================================================
     4. SOFT DELETE
     ============================================================ */
  async function softDelete(table, id) {
    if (!window.db) return { error: { message: 'Not connected' } };

    // Get current user for audit trail
    let userId = null;
    try {
      const { data } = await window.db.auth.getSession();
      userId = data && data.session && data.session.user ? data.session.user.id : null;
    } catch (e) {}

    const payload = {
      deleted_at: new Date().toISOString(),
      deleted_by: userId
    };

    return await window.db.from(table).update(payload).eq('id', id);
  }

  /* ============================================================
     5. RESTORE
     ============================================================ */
  async function restore(table, id) {
    if (!window.db) return { error: { message: 'Not connected' } };
    return await window.db
      .from(table)
      .update({ deleted_at: null, deleted_by: null })
      .eq('id', id);
  }

  /* ============================================================
     6. PERMANENT DELETE
     ============================================================ */
  async function purge(table, id) {
    if (!window.db) return { error: { message: 'Not connected' } };

    // For orders: also delete order_items
    if (table === 'orders') {
      try { await window.db.from('order_items').delete().eq('order_id', id); } catch (e) {}
    }

    return await window.db.from(table).delete().eq('id', id);
  }

  /* ============================================================
     7. FETCH TRASH ITEMS
     ============================================================ */
  async function fetchTrash(table) {
    if (!window.db) return [];
    try {
      const { data, error } = await window.db
        .from(table)
        .select('*')
        .not('deleted_at', 'is', null)
        .order('deleted_at', { ascending: false });

      if (error) throw error;
      return data || [];
    } catch (e) {
      console.warn('[trash] fetch failed:', e);
      return [];
    }
  }

  /* ============================================================
     8. RELOAD CURRENT SECTION AFTER ACTION
     ============================================================ */
  function reloadCurrentSection(pageId) {
    const reloadMap = {
      products: window.loadProducts,
      orders: window.loadOrders,
      reviews: window.loadReviewsAdmin,
      ads: window.loadAds,
      categories: window.loadCategories
    };
    const fn = reloadMap[pageId];
    if (typeof fn === 'function') {
      fn();
    }
  }

  /* ============================================================
     9. RENDER TRASH VIEW
     ============================================================ */
  function renderTrashView(table, items, container) {
    // Find or create trash container
    let trashContainer = container.querySelector('.trash-view');
    if (!trashContainer) {
      trashContainer = document.createElement('div');
      trashContainer.className = 'trash-view';
      const card = container.querySelector('.card');
      if (card) {
        card.style.display = 'none';
        card.parentNode.insertBefore(trashContainer, card.nextSibling);
      } else {
        container.appendChild(trashContainer);
      }
    } else {
      const card = container.querySelector('.card');
      if (card) card.style.display = 'none';
      trashContainer.style.display = '';
    }

    if (items.length === 0) {
      trashContainer.innerHTML =
        '<div class="card"><div class="card-body"><div class="trash-empty">' +
          '<svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>' +
          '<h3>Trash is empty</h3>' +
          '<p>Deleted ' + esc(table) + ' will appear here and can be restored.</p>' +
        '</div></div></div>';
      return;
    }

    const rows = items.map(function (item) {
      const name = itemName(item);
      const img = item.image_url || item.image || '';
      const thumb = img
        ? '<img src="' + esc(safeImg(img)) + '" alt="" style="width:44px;height:44px;object-fit:cover;border-radius:6px">'
        : '<div style="width:44px;height:44px;background:#f0f0f0;border-radius:6px;display:flex;align-items:center;justify-content:center;font-weight:700;color:#999;flex-shrink:0">' + esc(String(name).charAt(0)) + '</div>';

      const deletedAt = item.deleted_at
        ? new Date(item.deleted_at).toLocaleString('en-IN', {
            year: 'numeric', month: 'short', day: 'numeric',
            hour: '2-digit', minute: '2-digit'
          })
        : '';

      return '<tr>' +
        '<td><div style="display:flex;align-items:center;gap:10px">' +
          thumb +
          '<strong style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(name) + '</strong>' +
        '</div></td>' +
        '<td><span class="text-muted" style="font-size:.75rem">' + esc(deletedAt) + '</span></td>' +
        '<td>' +
          '<div class="trash-actions">' +
            '<button class="action-btn restore" data-act="restore" data-id="' + esc(String(item.id)) + '">' +
              '<svg viewBox="0 0 24 24"><use href="#icon-restore"></use></svg> Restore' +
            '</button>' +
            '<button class="action-btn delete" data-act="purge" data-id="' + esc(String(item.id)) + '">' +
              '<svg viewBox="0 0 24 24"><use href="#icon-trash"></use></svg> Delete Forever' +
            '</button>' +
          '</div>' +
        '</td>' +
      '</tr>';
    }).join('');

    trashContainer.innerHTML =
      '<div class="card">' +
        '<div class="card-head">' +
          '<span class="card-title">🗑 Trash — ' + items.length + ' item' + (items.length === 1 ? '' : 's') + '</span>' +
          '<button class="btn btn-ghost btn-sm" data-act="back-from-trash">← Back to list</button>' +
        '</div>' +
        '<div class="table-wrap">' +
          '<table>' +
            '<thead><tr><th>Item</th><th>Deleted At</th><th>Actions</th></tr></thead>' +
            '<tbody>' + rows + '</tbody>' +
          '</table>' +
        '</div>' +
      '</div>';
  }

  /* ============================================================
     10. EXIT TRASH VIEW
     ============================================================ */
  function exitTrashView() {
    const activeSection = document.querySelector('.page-section.active');
    if (!activeSection) return;
    const trash = activeSection.querySelector('.trash-view');
    if (trash) {
      trash.style.display = 'none';
    }
    const card = activeSection.querySelector('.card');
    if (card) card.style.display = '';

    // Remove "active" from trash tab
    const trashTab = activeSection.querySelector('.tab[data-filter="__trash__"]');
    if (trashTab) trashTab.classList.remove('active');
    trashState.currentView = 'alive';
  }

  /* ============================================================
     11. INJECT TRASH TAB
     ------------------------------------------------------------
     Adds "🗑 Trash" tab to:
       • order tabs
       • review tabs
       • ads (create tab row if missing)
       • products (create tab row if missing)
       • categories (add button in page head)
     ============================================================ */
  function injectTrashTabs() {
    // Orders
    const orderTabs = document.getElementById('orderTabs');
    if (orderTabs && !orderTabs.querySelector('[data-filter="__trash__"]')) {
      const t = document.createElement('button');
      t.className = 'tab';
      t.dataset.filter = '__trash__';
      t.textContent = '🗑 Trash';
      orderTabs.appendChild(t);
    }

    // Reviews
    const reviewTabs = document.getElementById('reviewTabs');
    if (reviewTabs && !reviewTabs.querySelector('[data-filter="__trash__"]')) {
      const t = document.createElement('button');
      t.className = 'tab';
      t.dataset.filter = '__trash__';
      t.textContent = '🗑 Trash';
      reviewTabs.appendChild(t);
    }

    // Products — add trash tab into toolbar
    const productsToolbar = document.querySelector('#section-products .toolbar');
    if (productsToolbar && !productsToolbar.querySelector('[data-trash-tab="products"]')) {
      const wrap = document.createElement('div');
      wrap.className = 'tabs';
      wrap.style.cssText = 'margin-left:auto;display:flex;gap:6px';

      const aliveTab = document.createElement('button');
      aliveTab.className = 'tab active';
      aliveTab.dataset.filter = 'alive';
      aliveTab.dataset.trashTab = 'products';
      aliveTab.textContent = '✓ Active';

      const trashTab = document.createElement('button');
      trashTab.className = 'tab';
      trashTab.dataset.filter = '__trash__';
      trashTab.dataset.trashTab = 'products';
      trashTab.textContent = '🗑 Trash';

      wrap.appendChild(aliveTab);
      wrap.appendChild(trashTab);
      productsToolbar.appendChild(wrap);
    }

    // Ads — add trash tab into toolbar
    const adsToolbar = document.querySelector('#section-ads .toolbar');
    if (adsToolbar && !adsToolbar.querySelector('[data-trash-tab="ads"]')) {
      const wrap = document.createElement('div');
      wrap.className = 'tabs';
      wrap.style.cssText = 'margin-left:auto;display:flex;gap:6px';

      const aliveTab = document.createElement('button');
      aliveTab.className = 'tab active';
      aliveTab.dataset.filter = 'alive';
      aliveTab.dataset.trashTab = 'ads';
      aliveTab.textContent = '✓ Active';

      const trashTab = document.createElement('button');
      trashTab.className = 'tab';
      trashTab.dataset.filter = '__trash__';
      trashTab.dataset.trashTab = 'ads';
      trashTab.textContent = '🗑 Trash';

      wrap.appendChild(aliveTab);
      wrap.appendChild(trashTab);
      adsToolbar.appendChild(wrap);
    }

    // Categories — add a Trash button in the page head
    const catHead = document.querySelector('#section-categories .page-head');
    if (catHead && !catHead.querySelector('[data-act="open-cat-trash"]')) {
      const btn = document.createElement('button');
      btn.className = 'btn btn-secondary btn-sm';
      btn.dataset.act = 'open-cat-trash';
      btn.style.cssText = 'margin-left:auto';
      btn.textContent = '🗑 Trash';
      catHead.appendChild(btn);
    }
  }

  /* ============================================================
     12. INTERCEPT DELETE BUTTONS (soft delete)
     ============================================================ */
  document.addEventListener('click', async function (e) {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;

    const act = btn.dataset.act;
    const id = btn.dataset.id;

    // ---------- SOFT DELETE ----------
    if (act === 'del' && id) {
      e.preventDefault();
      e.stopPropagation();

      const table = getTableForPage();
      if (!table) return;

      if (!confirm('Move this item to Trash? You can restore it later.')) return;

      btn.disabled = true;
      const result = await softDelete(table, id);
      btn.disabled = false;

      if (result && result.error) {
        toast('Unable to move to Trash: ' + result.error.message, 'error');
        return;
      }

      toast('Moved to Trash', 'success');

      const activeSection = document.querySelector('.page-section.active');
      if (activeSection) {
        const pageId = activeSection.id.replace('section-', '');
        reloadCurrentSection(pageId);
      }
      return;
    }

    // ---------- RESTORE ----------
    if (act === 'restore' && id) {
      e.preventDefault();
      e.stopPropagation();

      const table = getTableForPage();
      if (!table) return;

      btn.disabled = true;
      const result = await restore(table, id);
      btn.disabled = false;

      if (result && result.error) {
        toast('Unable to restore: ' + result.error.message, 'error');
        return;
      }

      toast('Item restored', 'success');

      // Reload trash list
      const items = await fetchTrash(table);
      const activeSection = document.querySelector('.page-section.active');
      if (activeSection) renderTrashView(table, items, activeSection);

      // Refresh the live count
      const pageId = activeSection ? activeSection.id.replace('section-', '') : null;
      if (pageId) reloadCurrentSection(pageId);
      return;
    }

    // ---------- PERMANENT DELETE ----------
    if (act === 'purge' && id) {
      e.preventDefault();
      e.stopPropagation();

      const table = getTableForPage();
      if (!table) return;

      if (!confirm('Permanently delete this item? This cannot be undone.')) return;

      btn.disabled = true;
      const result = await purge(table, id);
      btn.disabled = false;

      if (result && result.error) {
        toast('Unable to delete: ' + result.error.message, 'error');
        return;
      }

      toast('Permanently deleted', 'success');

      const items = await fetchTrash(table);
      const activeSection = document.querySelector('.page-section.active');
      if (activeSection) renderTrashView(table, items, activeSection);
      return;
    }

    // ---------- BACK FROM TRASH ----------
    if (act === 'back-from-trash') {
      e.preventDefault();
      exitTrashView();
      return;
    }

    // ---------- OPEN CATEGORY TRASH ----------
    if (act === 'open-cat-trash') {
      e.preventDefault();
      openTrashView();
      return;
    }
  }, true);

  /* ============================================================
     13. HANDLE TRASH TAB CLICK
     ============================================================ */
  document.addEventListener('click', async function (e) {
    const tab = e.target.closest('[data-filter="__trash__"]');
    if (!tab) return;
    e.preventDefault();

    const activeSection = document.querySelector('.page-section.active');
    if (!activeSection) return;

    const pageId = activeSection.id.replace('section-', '');
    const table = TABLE_MAP[pageId];
    if (!table) return;

    // Mark tab active
    const siblings = tab.parentElement.querySelectorAll('.tab');
    siblings.forEach(function (t) { t.classList.remove('active'); });
    tab.classList.add('active');

    trashState.currentView = 'trash';

    // Load + render trash
    const items = await fetchTrash(table);
    renderTrashView(table, items, activeSection);
  }, true);

  /* ============================================================
     14. HANDLE "ALIVE" TAB CLICK
     ============================================================ */
  document.addEventListener('click', function (e) {
    const tab = e.target.closest('[data-filter="alive"]');
    if (!tab) return;
    e.preventDefault();

    const siblings = tab.parentElement.querySelectorAll('.tab');
    siblings.forEach(function (t) { t.classList.remove('active'); });
    tab.classList.add('active');

    exitTrashView();

    const activeSection = document.querySelector('.page-section.active');
    if (activeSection) {
      const pageId = activeSection.id.replace('section-', '');
      reloadCurrentSection(pageId);
    }
  }, true);

  /* ============================================================
     15. OPEN TRASH VIEW PROGRAMMATICALLY (for categories button)
     ============================================================ */
  async function openTrashView() {
    const activeSection = document.querySelector('.page-section.active');
    if (!activeSection) return;

    const pageId = activeSection.id.replace('section-', '');
    const table = TABLE_MAP[pageId];
    if (!table) return;

    trashState.currentView = 'trash';

    const items = await fetchTrash(table);
    renderTrashView(table, items, activeSection);
  }

  /* ============================================================
     16. WATCH FOR SECTION CHANGES (auto-inject tabs)
     ============================================================ */
  const observer = new MutationObserver(function () {
    injectTrashTabs();
  });

  if (document.body) {
    observer.observe(document.body, { childList: true, subtree: true });
  }

  // Also inject on section navigation
  document.addEventListener('click', function (e) {
    const navEl = e.target.closest('.nav-item[data-page], .bottom-nav-item[data-page]');
    if (!navEl) return;
    // Exit trash view when navigating
    exitTrashView();
    // Re-inject after navigation
    setTimeout(injectTrashTabs, 50);
  }, true);

  /* ============================================================
     17. PUBLIC API
     ============================================================ */
  window.AdminTrash = {
    softDelete: softDelete,
    restore: restore,
    purge: purge,
    fetchTrash: fetchTrash,
    openTrashView: openTrashView,
    exitTrashView: exitTrashView
  };

  /* ============================================================
     18. INIT
     ============================================================ */
  function init() {
    // Inject tabs on load
    injectTrashTabs();

    // Watch for section shows
    const observerSection = new MutationObserver(function () {
      injectTrashTabs();
    });
    document.querySelectorAll('.page-section').forEach(function (s) {
      observerSection.observe(s, { attributes: true, attributeFilter: ['class'] });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
