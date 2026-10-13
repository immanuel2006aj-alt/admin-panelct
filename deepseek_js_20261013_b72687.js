/* ============================================================
   CENTRAL & STORES — ADMIN DASHBOARD
   ------------------------------------------------------------
   Populates:
     • Order stats (total, new, in progress, delivered)
     • Product stats (total, published, hidden, out of stock)
     • Recent orders table (5 most recent)
     • Recent products table (5 most recent)
     • Pending reviews list

   Depends on: admin-core.js (window.db, window.AdminCore, window.toast)
   ============================================================ */

(function () {
  'use strict';

  const esc = window.AdminCore.esc;
  const safeImg = window.AdminCore.safeImg;
  const fmtINR = window.AdminCore.fmtINR;
  const fmtDateTime = window.AdminCore.fmtDateTime;
  const toast = window.AdminCore.toast;

  const STATUS_LABEL = {
    'NEW': 'New',
    'CONFIRMED': 'Confirmed',
    'PROCESSING': 'Processing',
    'OUT_FOR_DELIVERY': 'Out for delivery',
    'DELIVERED': 'Delivered',
    'CANCELLED': 'Cancelled'
  };

  function statusBadgeClass(s) {
    switch (s) {
      case 'NEW': return 'badge-red';
      case 'CONFIRMED': return 'badge-gold';
      case 'PROCESSING': return 'badge-blue';
      case 'OUT_FOR_DELIVERY': return 'badge-blue';
      case 'DELIVERED': return 'badge-green';
      case 'CANCELLED': return 'badge-gray';
      default: return 'badge-gray';
    }
  }

  function setStat(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  }

  /* ============================================================
     MAIN LOADER
     ============================================================ */
  async function loadDashboard() {
    if (!window.db) return;

    loadProductStats();
    loadOrderStats();
    loadRecentProducts();
    loadPendingReviews();
  }

  /* ============================================================
     PRODUCT STATS
     ============================================================ */
  async function loadProductStats() {
    try {
      const { data, error } = await window.db
        .from('products')
        .select('id, is_published, is_available')
        .is('deleted_at', null);

      if (error) throw error;
      const all = data || [];

      setStat('statTotal', all.length);
      setStat('statPublished', all.filter(function (p) { return p.is_published; }).length);
      setStat('statHidden', all.filter(function (p) { return !p.is_published; }).length);
      setStat('statOOS', all.filter(function (p) { return p.is_available === false; }).length);
    } catch (err) {
      console.warn('[dashboard] product stats failed:', err);
      setStat('statTotal', '—');
      setStat('statPublished', '—');
      setStat('statHidden', '—');
      setStat('statOOS', '—');
    }
  }

  /* ============================================================
     ORDER STATS
     ============================================================ */
  async function loadOrderStats() {
    try {
      const { data, error } = await window.db
        .from('orders')
        .select('id, status')
        .is('deleted_at', null);

      if (error) throw error;
      const all = data || [];

      setStat('statOrdersTotal', all.length);
      setStat('statOrdersNew', all.filter(function (o) { return o.status === 'NEW'; }).length);
      setStat('statOrdersInProgress', all.filter(function (o) {
        return o.status === 'CONFIRMED' || o.status === 'PROCESSING' || o.status === 'OUT_FOR_DELIVERY';
      }).length);
      setStat('statOrdersDelivered', all.filter(function (o) { return o.status === 'DELIVERED'; }).length);
    } catch (err) {
      console.warn('[dashboard] order stats failed:', err);
      setStat('statOrdersTotal', '—');
      setStat('statOrdersNew', '—');
      setStat('statOrdersInProgress', '—');
      setStat('statOrdersDelivered', '—');
    }
  }

  /* ============================================================
     RECENT PRODUCTS
     ============================================================ */
  async function loadRecentProducts() {
    const container = document.getElementById('recentProductsContainer');
    if (!container) return;

    container.innerHTML = '<div class="card-body"><div class="skeleton" style="height:60px;margin-bottom:12px"></div><div class="skeleton" style="height:60px"></div></div>';

    try {
      const { data, error } = await window.db
        .from('products')
        .select('id, name, category, price, image_url, is_published, created_at')
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .limit(5);

      if (error) throw error;
      const items = data || [];

      if (items.length === 0) {
        container.innerHTML =
          '<div class="card-body"><div class="empty">' +
            '<svg viewBox="0 0 24 24"><path d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>' +
            '<h3>No products yet</h3>' +
            '<p>Add your first product to build the catalog.</p>' +
            '<button class="btn btn-primary" data-page="editor-new">Add Product</button>' +
          '</div></div>';
        return;
      }

      const rows = items.map(function (p) {
        const img = safeImg(p.image_url);
        const thumb = img
          ? '<img src="' + esc(img) + '" alt="" loading="lazy">'
          : esc((p.name || '?').charAt(0));
        return '<tr>' +
          '<td><div class="prod-cell">' +
            '<div class="prod-thumb">' + thumb + '</div>' +
            '<div><div class="prod-name">' + esc(p.name) + '</div></div>' +
          '</div></td>' +
          '<td>' + esc(p.category || '—') + '</td>' +
          '<td>' + fmtINR(p.price) + '</td>' +
          '<td>' + (p.is_published
            ? '<span class="badge badge-green">Published</span>'
            : '<span class="badge badge-gray">Hidden</span>') + '</td>' +
          '<td>' +
            '<div class="row-actions">' +
              '<button class="icon-action" data-act="edit" data-id="' + esc(String(p.id)) + '" aria-label="Edit"><svg viewBox="0 0 24 24"><use href="#icon-edit"></use></svg></button>' +
              '<button class="icon-action danger" data-act="del" data-id="' + esc(String(p.id)) + '" aria-label="Delete"><svg viewBox="0 0 24 24"><use href="#icon-trash"></use></svg></button>' +
            '</div>' +
          '</td>' +
        '</tr>';
      }).join('');

      container.innerHTML =
        '<div class="table-wrap"><table>' +
          '<thead><tr><th>Product</th><th>Category</th><th>Price</th><th>Status</th><th>Actions</th></tr></thead>' +
          '<tbody>' + rows + '</tbody>' +
        '</table></div>';
    } catch (err) {
      console.warn('[dashboard] recent products failed:', err);
      container.innerHTML = '<div class="card-body"><div class="empty"><h3>Unable to load products</h3></div></div>';
    }
  }

  /* ============================================================
     RECENT ORDERS
     ============================================================ */
  async function loadRecentOrders() {
    const container = document.getElementById('recentOrdersContainer');
    if (!container) return;

    container.innerHTML = '<div class="card-body"><div class="skeleton" style="height:60px;margin-bottom:12px"></div><div class="skeleton" style="height:60px"></div></div>';

    try {
      const { data, error } = await window.db
        .from('orders')
        .select('id, order_number, customer_name, total, status, created_at')
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .limit(5);

      if (error) throw error;
      const items = data || [];

      if (items.length === 0) {
        container.innerHTML =
          '<div class="card-body"><div class="empty">' +
            '<svg viewBox="0 0 24 24"><path d="M9 11H5a2 2 0 00-2 2v7a2 2 0 002 2h14a2 2 0 002-2v-7a2 2 0 00-2-2h-4" fill="none" stroke="currentColor" stroke-width="1.5"/><rect x="9" y="3" width="6" height="12" rx="1" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>' +
            '<h3>No orders yet</h3>' +
            '<p>Orders placed on the website will appear here.</p>' +
          '</div></div>';
        return;
      }

      const rows = items.map(function (o) {
        const st = o.status || 'NEW';
        return '<tr>' +
          '<td><strong>' + esc(o.order_number || ('#' + o.id)) + '</strong></td>' +
          '<td>' + esc(o.customer_name || '—') + '</td>' +
          '<td>' + fmtINR(o.total) + '</td>' +
          '<td><span class="badge ' + statusBadgeClass(st) + '">' + esc(STATUS_LABEL[st] || st) + '</span></td>' +
          '<td><div class="text-muted" style="font-size:.75rem">' + esc(fmtDateTime(o.created_at)) + '</div></td>' +
          '<td>' +
            '<div class="row-actions">' +
              '<button class="icon-action" data-act="open-order" data-id="' + esc(String(o.id)) + '" aria-label="Open order"><svg viewBox="0 0 24 24"><use href="#icon-eye"></use></svg></button>' +
            '</div>' +
          '</td>' +
        '</tr>';
      }).join('');

      container.innerHTML =
        '<div class="table-wrap"><table>' +
          '<thead><tr><th>Order</th><th>Customer</th><th>Total</th><th>Status</th><th>Date</th><th>Actions</th></tr></thead>' +
          '<tbody>' + rows + '</tbody>' +
        '</table></div>';
    } catch (err) {
      console.warn('[dashboard] recent orders failed:', err);
      container.innerHTML = '<div class="card-body"><div class="empty"><h3>Orders unavailable</h3><p>The orders table is not yet set up.</p></div></div>';
    }
  }

  /* ============================================================
     PENDING REVIEWS
     ============================================================ */
  async function loadPendingReviews() {
    const container = document.getElementById('pendingReviewsContainer');
    if (!container) return;

    container.innerHTML = '<div class="card-body"><div class="skeleton" style="height:60px"></div></div>';

    try {
      const { data, error } = await window.db
        .from('reviews')
        .select('id, customer_name, rating, review_text, created_at')
        .eq('status', 'pending')
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .limit(5);

      if (error) throw error;
      const items = data || [];

      if (items.length === 0) {
        container.innerHTML =
          '<div class="card-body"><div class="empty">' +
            '<svg viewBox="0 0 24 24"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>' +
            '<h3>No pending reviews</h3>' +
            '<p>All caught up.</p>' +
          '</div></div>';
        return;
      }

      const rows = items.map(function (r) {
        return '<div style="padding:12px 0;border-bottom:1px solid var(--gray-100);display:flex;align-items:center;gap:12px;flex-wrap:wrap">' +
          '<div style="flex:1;min-width:0">' +
            '<strong>' + esc(r.customer_name || 'Customer') + '</strong> ' +
            '<span class="text-muted">· ' + esc(String(r.rating)) + '★</span>' +
            '<div class="text-muted" style="margin-top:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:400px">' +
              esc((r.review_text || '').slice(0, 90)) +
            '</div>' +
          '</div>' +
          '<div class="row-actions">' +
            '<button class="action-btn restore" data-act="approve-review" data-id="' + esc(String(r.id)) + '">' +
              '<svg viewBox="0 0 24 24"><use href="#icon-save"></use></svg> Approve' +
            '</button>' +
            '<button class="action-btn delete" data-act="reject-review" data-id="' + esc(String(r.id)) + '">' +
              '<svg viewBox="0 0 24 24"><use href="#icon-close"></use></svg> Reject' +
            '</button>' +
          '</div>' +
        '</div>';
      }).join('');

      container.innerHTML = '<div class="card-body">' + rows + '</div>';
    } catch (err) {
      console.warn('[dashboard] pending reviews failed:', err);
      container.innerHTML = '<div class="card-body"><div class="empty"><h3>Reviews unavailable</h3></div></div>';
    }
  }

  /* ============================================================
     WIRE ACTION BUTTONS ON DASHBOARD
     ------------------------------------------------------------
     Product "edit" → open editor
     Product "del" → handled by admin-trash.js (soft delete)
     Order "open-order" → handled by admin-orders.js
     Reviews "approve"/"reject" → handled by admin-reviews.js
     ============================================================ */

  document.addEventListener('click', function (e) {
    // Only handle clicks inside dashboard section
    const activeSection = document.querySelector('.page-section.active');
    if (!activeSection || activeSection.id !== 'section-dashboard') return;

    const btn = e.target.closest('[data-act]');
    if (!btn) return;

    const act = btn.dataset.act;
    const id = btn.dataset.id;

    if (act === 'edit' && typeof window.openEditor === 'function') {
      e.preventDefault();
      window.openEditor(id);
    }
  }, true);

  /* ============================================================
     PUBLIC API
     ============================================================ */
  window.loadDashboard = loadDashboard;
  window.loadRecentOrders = loadRecentOrders;
  window.loadRecentProducts = loadRecentProducts;
  window.loadPendingReviews = loadPendingReviews;
})();