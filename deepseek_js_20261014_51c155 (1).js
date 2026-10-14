/* ============================================================
   CENTRAL & STORES — ADMIN ORDERS
   ------------------------------------------------------------
   Full order management:
     • List with tabs (All / New / Confirmed / Processing /
       Out for delivery / Delivered / Cancelled / Trash)
     • Search by order number, customer name, phone
     • Order detail modal
     • Status update
     • WhatsApp / Call customer
     • Realtime new order notification
     • Soft delete (via admin-trash.js)

   Depends on: admin-core.js
   ============================================================ */

(function () {
  'use strict';

  const esc = window.AdminCore.esc;
  const fmtINR = window.AdminCore.fmtINR;
  const fmtDateTime = window.AdminCore.fmtDateTime;
  const toast = window.AdminCore.toast;
  const setBtnLoading = window.AdminCore.setBtnLoading;

  /* ============================================================
     STATE
     ============================================================ */
  const state = {
    allOrders: [],
    filteredOrders: [],
    activeFilter: 'all',
    currentOrderId: null,
    loaded: false
  };

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

  function paymentBadgeClass(s) {
    switch (s) {
      case 'PAID': return 'badge-green';
      case 'REFUNDED': return 'badge-gray';
      case 'UNPAID':
      default: return 'badge-warn';
    }
  }

  /* ============================================================
     1. LOAD ORDERS
     ============================================================ */
  async function loadOrders() {
    if (!window.db) return;

    const tbody = document.getElementById('ordersBody');
    const mobile = document.getElementById('ordersMobile');
    if (tbody) tbody.innerHTML = '<tr><td colspan="8" style="padding:24px"><div class="skeleton" style="height:24px"></div></td></tr>';
    if (mobile) mobile.innerHTML = '<div class="skeleton" style="height:80px"></div>';

    try {
      const { data, error } = await window.db
        .from('orders')
        .select('id, order_number, customer_name, customer_phone, total, status, payment_status, created_at')
        .is('deleted_at', null)
        .order('created_at', { ascending: false });

      if (error) throw error;

      state.allOrders = data || [];
      state.loaded = true;

      applyFilter();
    } catch (err) {
      console.warn('[orders] load failed:', err);
      if (tbody) tbody.innerHTML = '<tr><td colspan="8"><div class="empty"><h3>Unable to load orders</h3><p>' + esc(err.message || '') + '</p></div></td></tr>';
      if (mobile) mobile.innerHTML = '';
    }
  }

  /* ============================================================
     2. FILTER + SEARCH
     ============================================================ */
  function applyFilter() {
    const q = (document.getElementById('orderSearch') || {}).value || '';
    let list = state.allOrders.slice();

    // Only apply status filter if it's a real status
    if (state.activeFilter && state.activeFilter !== 'all' && state.activeFilter !== '__trash__') {
      list = list.filter(function (o) { return o.status === state.activeFilter; });
    }

    if (q.trim()) {
      const query = q.trim().toLowerCase();
      list = list.filter(function (o) {
        return String(o.order_number || '').toLowerCase().includes(query) ||
               String(o.customer_name || '').toLowerCase().includes(query) ||
               String(o.customer_phone || '').includes(query);
      });
    }

    state.filteredOrders = list;
    renderOrders();
  }

  /* ============================================================
     3. RENDER
     ============================================================ */
  function renderOrders() {
    const tbody = document.getElementById('ordersBody');
    const mobile = document.getElementById('ordersMobile');
    const items = state.filteredOrders;

    if (items.length === 0) {
      const isEmpty = state.allOrders.length === 0;
      const empty =
        '<div class="empty">' +
          '<svg viewBox="0 0 24 24"><path d="M9 11H5a2 2 0 00-2 2v7a2 2 0 002 2h14a2 2 0 002-2v-7a2 2 0 00-2-2h-4" fill="none" stroke="currentColor" stroke-width="1.5"/><rect x="9" y="3" width="6" height="12" rx="1" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>' +
          '<h3>' + (isEmpty ? 'No orders yet' : 'No matching orders') + '</h3>' +
          '<p>' + (isEmpty ? 'Orders placed on the website will appear here.' : 'Try a different filter or search.') + '</p>' +
        '</div>';
      if (tbody) tbody.innerHTML = '<tr><td colspan="8">' + empty + '</td></tr>';
      if (mobile) mobile.innerHTML = '';
      return;
    }

    if (tbody) {
      tbody.innerHTML = items.map(function (o) {
        const num = esc(o.order_number || ('#' + o.id));
        const st = o.status || 'NEW';
        const ps = o.payment_status || 'UNPAID';
        return '<tr>' +
          '<td><strong>' + num + '</strong></td>' +
          '<td>' + esc(o.customer_name || '—') + '</td>' +
          '<td>' + esc(o.customer_phone || '—') + '</td>' +
          '<td>' + fmtINR(o.total) + '</td>' +
          '<td><div class="text-muted" style="font-size:.75rem">' + esc(fmtDateTime(o.created_at)) + '</div></td>' +
          '<td><span class="badge ' + statusBadgeClass(st) + '">' + esc(STATUS_LABEL[st] || st) + '</span></td>' +
          '<td><span class="badge ' + paymentBadgeClass(ps) + '">' + esc(ps) + '</span></td>' +
          '<td><div class="row-actions">' +
            '<button class="icon-action" data-act="open-order" data-id="' + esc(String(o.id)) + '" title="View order" aria-label="View order">' +
              '<svg viewBox="0 0 24 24"><use href="#icon-eye"></use></svg>' +
            '</button>' +
            '<button class="icon-action danger" data-act="del" data-id="' + esc(String(o.id)) + '" title="Delete" aria-label="Delete order">' +
              '<svg viewBox="0 0 24 24"><use href="#icon-trash"></use></svg>' +
            '</button>' +
          '</div></td>' +
        '</tr>';
      }).join('');
    }

    if (mobile) {
      mobile.innerHTML = items.map(function (o) {
        const num = esc(o.order_number || ('#' + o.id));
        const st = o.status || 'NEW';
        const ps = o.payment_status || 'UNPAID';
        return '<div class="mobile-card">' +
          '<div class="mobile-card-top">' +
            '<div class="mobile-card-info">' +
              '<div class="mobile-card-name">' + num + '</div>' +
              '<div class="mobile-card-meta">' + esc(o.customer_name || '—') + '</div>' +
              '<div class="mobile-card-meta">' + esc(o.customer_phone || '') + '</div>' +
              '<div class="mobile-card-price">' + fmtINR(o.total) + '</div>' +
            '</div>' +
          '</div>' +
          '<div class="mobile-card-badges">' +
            '<span class="badge ' + statusBadgeClass(st) + '">' + esc(STATUS_LABEL[st] || st) + '</span>' +
            '<span class="badge ' + paymentBadgeClass(ps) + '">' + esc(ps) + '</span>' +
          '</div>' +
          '<div class="text-muted" style="margin-bottom:10px;font-size:.75rem;">' + esc(fmtDateTime(o.created_at)) + '</div>' +
          '<div class="mobile-card-actions">' +
            '<button class="action-btn edit" data-act="open-order" data-id="' + esc(String(o.id)) + '">' +
              '<svg viewBox="0 0 24 24"><use href="#icon-eye"></use></svg> Open' +
            '</button>' +
            '<button class="action-btn delete" data-act="del" data-id="' + esc(String(o.id)) + '">' +
              '<svg viewBox="0 0 24 24"><use href="#icon-trash"></use></svg> Delete' +
            '</button>' +
          '</div>' +
        '</div>';
      }).join('');
    }
  }

  /* ============================================================
     4. ORDER DETAIL MODAL
     ============================================================ */
  let orderModalKeyHandlerAttached = false;

  async function openOrderDetail(id) {
    if (!window.db) return;
    state.currentOrderId = id;

    // Build modal once
    let modal = document.getElementById('orderDetailModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'orderDetailModal';
      modal.className = 'modal-overlay';
      modal.setAttribute('role', 'dialog');
      modal.setAttribute('aria-modal', 'true');
      modal.innerHTML =
        '<div class="modal modal-xl">' +
          '<div id="orderDetailBody">' +
            '<div class="skeleton" style="height:80px;margin-bottom:12px"></div>' +
            '<div class="skeleton" style="height:200px"></div>' +
          '</div>' +
          '<div class="modal-actions" style="margin-top:20px">' +
            '<button class="btn btn-secondary" id="orderDetailClose" type="button">Close</button>' +
          '</div>' +
        '</div>';
      document.body.appendChild(modal);

      modal.addEventListener('click', function (e) {
        if (e.target === modal) closeOrderDetail();
      });

      const closeBtn = document.getElementById('orderDetailClose');
      if (closeBtn) closeBtn.addEventListener('click', closeOrderDetail);
    }

    // Attach Escape handler once
    if (!orderModalKeyHandlerAttached) {
      orderModalKeyHandlerAttached = true;
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') {
          const m = document.getElementById('orderDetailModal');
          if (m && m.classList.contains('open')) closeOrderDetail();
        }
      });
    }

    const body = document.getElementById('orderDetailBody');
    body.innerHTML = '<div class="skeleton" style="height:80px;margin-bottom:12px"></div><div class="skeleton" style="height:200px"></div>';

    modal.classList.add('open');
    document.body.style.overflow = 'hidden';

    try {
      // Load order
      const { data: order, error } = await window.db
        .from('orders')
        .select('*')
        .eq('id', id)
        .single();

      if (error || !order) {
        body.innerHTML = '<div class="empty"><h3>Unable to load order</h3><p>' + esc((error && error.message) || 'Order not found.') + '</p></div>';
        return;
      }

      // Load order items
      const { data: items } = await window.db
        .from('order_items')
        .select('*')
        .eq('order_id', id)
        .order('id', { ascending: true });

      const itemList = items || [];
      const st = order.status || 'NEW';
      const ps = order.payment_status || 'UNPAID';

      const itemsRows = itemList.length === 0
        ? '<tr><td colspan="4" class="text-muted" style="text-align:center;padding:20px">No items recorded for this order.</td></tr>'
        : itemList.map(function (it) {
            return '<tr>' +
              '<td>' + esc(it.product_name || '—') +
                (it.product_weight ? '<div class="text-muted" style="font-size:.75rem">' + esc(it.product_weight) + '</div>' : '') +
              '</td>' +
              '<td class="num" style="text-align:right">' + fmtINR(it.unit_price) + '</td>' +
              '<td class="num" style="text-align:right">' + esc(String(it.quantity)) + '</td>' +
              '<td class="num" style="text-align:right">' + fmtINR(it.line_total) + '</td>' +
            '</tr>';
          }).join('');

      const subtotal = order.subtotal != null
        ? Number(order.subtotal)
        : itemList.reduce(function (s, it) { return s + (Number(it.line_total) || 0); }, 0);
      const delivery = Number(order.delivery_charge) || 0;
      const discount = Number(order.discount) || 0;
      const total = order.total != null
        ? Number(order.total)
        : subtotal + delivery - discount;

      const statusOptions = Object.keys(STATUS_LABEL).map(function (k) {
        return '<option value="' + k + '"' + (k === st ? ' selected' : '') + '>' + STATUS_LABEL[k] + '</option>';
      }).join('');

      const phoneDigits = String(order.customer_phone || '').replace(/\D/g, '');
      const waMessage = encodeURIComponent('Hello ' + (order.customer_name || '') + ', regarding your order ' + (order.order_number || '') + ' — ');
      const waLink = phoneDigits
        ? 'https://wa.me/91' + phoneDigits.replace(/^91/, '') + '?text=' + waMessage
        : '';
      const telLink = phoneDigits
        ? 'tel:+91' + phoneDigits.replace(/^91/, '')
        : '';

      body.innerHTML =
        '<div class="order-detail-header">' +
          '<div>' +
            '<div class="order-detail-title">Order ' + esc(order.order_number || ('#' + order.id)) + '</div>' +
            '<div class="order-detail-meta">' +
              '<span>' + esc(fmtDateTime(order.created_at)) + '</span>' +
              '<span class="badge ' + statusBadgeClass(st) + '">' + esc(STATUS_LABEL[st] || st) + '</span>' +
              '<span class="badge ' + paymentBadgeClass(ps) + '">' + esc(ps) + '</span>' +
            '</div>' +
          '</div>' +
        '</div>' +

        '<div style="margin-bottom:20px">' +
          '<h4 style="font-size:.75rem;font-weight:800;text-transform:uppercase;letter-spacing:.05em;color:var(--gray-500);margin-bottom:10px">Customer</h4>' +
          '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;font-size:.875rem">' +
            '<div><div style="font-size:.6875rem;color:var(--gray-500);text-transform:uppercase;margin-bottom:2px">Name</div><div style="font-weight:600">' + esc(order.customer_name || '—') + '</div></div>' +
            '<div><div style="font-size:.6875rem;color:var(--gray-500);text-transform:uppercase;margin-bottom:2px">Phone</div><div style="font-weight:600">' + esc(order.customer_phone || '—') + '</div></div>' +
            '<div style="grid-column:1/-1"><div style="font-size:.6875rem;color:var(--gray-500);text-transform:uppercase;margin-bottom:2px">Address</div><div style="font-weight:600;word-break:break-word">' + esc(order.customer_address || '—') + '</div></div>' +
            (order.customer_note
              ? '<div style="grid-column:1/-1"><div style="font-size:.6875rem;color:var(--gray-500);text-transform:uppercase;margin-bottom:2px">Note</div><div style="font-weight:600;word-break:break-word">' + esc(order.customer_note) + '</div></div>'
              : '') +
          '</div>' +
        '</div>' +

        '<div style="margin-bottom:20px">' +
          '<h4 style="font-size:.75rem;font-weight:800;text-transform:uppercase;letter-spacing:.05em;color:var(--gray-500);margin-bottom:10px">Items</h4>' +
          '<div style="overflow-x:auto">' +
            '<table class="order-items-table" style="width:100%;border-collapse:collapse;font-size:.875rem">' +
              '<thead><tr>' +
                '<th style="text-align:left;padding:8px 10px;background:var(--gray-50);border-bottom:1px solid var(--gray-200);font-size:.6875rem;text-transform:uppercase;color:var(--gray-500)">Product</th>' +
                '<th style="text-align:right;padding:8px 10px;background:var(--gray-50);border-bottom:1px solid var(--gray-200);font-size:.6875rem;text-transform:uppercase;color:var(--gray-500)">Price</th>' +
                '<th style="text-align:right;padding:8px 10px;background:var(--gray-50);border-bottom:1px solid var(--gray-200);font-size:.6875rem;text-transform:uppercase;color:var(--gray-500)">Qty</th>' +
                '<th style="text-align:right;padding:8px 10px;background:var(--gray-50);border-bottom:1px solid var(--gray-200);font-size:.6875rem;text-transform:uppercase;color:var(--gray-500)">Total</th>' +
              '</tr></thead>' +
              '<tbody>' + itemsRows + '</tbody>' +
            '</table>' +
          '</div>' +
          '<div style="margin-top:14px;padding-top:14px;border-top:1px solid var(--gray-100);display:flex;flex-direction:column;gap:6px;font-size:.875rem">' +
            '<div style="display:flex;justify-content:space-between"><span>Subtotal</span><span>' + fmtINR(subtotal) + '</span></div>' +
            (delivery ? '<div style="display:flex;justify-content:space-between"><span>Delivery</span><span>' + fmtINR(delivery) + '</span></div>' : '') +
            (discount ? '<div style="display:flex;justify-content:space-between"><span>Discount</span><span>− ' + fmtINR(discount) + '</span></div>' : '') +
            '<div style="display:flex;justify-content:space-between;font-weight:800;padding-top:8px;margin-top:4px;border-top:1px solid var(--gray-200);font-size:1rem"><span>Total</span><span>' + fmtINR(total) + '</span></div>' +
          '</div>' +
        '</div>' +

        '<div style="margin-bottom:20px">' +
          '<h4 style="font-size:.75rem;font-weight:800;text-transform:uppercase;letter-spacing:.05em;color:var(--gray-500);margin-bottom:10px">Update status</h4>' +
          '<div style="display:flex;flex-direction:column;gap:10px">' +
            '<select id="orderStatusSelect" style="height:44px;border-radius:8px;border:1px solid var(--gray-200);padding:0 14px;font-size:.9375rem">' + statusOptions + '</select>' +
            '<div style="display:flex;gap:10px;flex-wrap:wrap">' +
              (waLink ? '<a class="btn btn-secondary" href="' + esc(waLink) + '" target="_blank" rel="noopener" style="flex:1;min-width:140px"><svg viewBox="0 0 24 24"><path d="M21 11.5a8.4 8.4 0 01-12.4 7.4L3 21l2.1-5.3A8.5 8.5 0 1121 11.5z" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>WhatsApp</a>' : '') +
              (telLink ? '<a class="btn btn-secondary" href="' + esc(telLink) + '" style="flex:1;min-width:140px"><svg viewBox="0 0 24 24"><path d="M22 16.9v3a2 2 0 01-2.2 2 19.8 19.8 0 01-8.6-3.1 19.5 19.5 0 01-6-6A19.8 19.8 0 012.1 4.2 2 2 0 014.1 2h3a2 2 0 012 1.7c.1 1 .4 2 .8 2.9a2 2 0 01-.5 2.1L8.1 10a16 16 0 006 6l1.3-1.3a2 2 0 012.1-.5c.9.4 1.9.7 2.9.8a2 2 0 011.6 1.9z" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>Call</a>' : '') +
              '<button class="btn btn-primary" id="orderStatusSave" type="button" style="flex:1;min-width:140px">Save Status</button>' +
            '</div>' +
          '</div>' +
        '</div>' +

        '<div>' +
          '<button class="btn btn-danger btn-sm" id="orderDeleteBtn" type="button"><svg viewBox="0 0 24 24"><use href="#icon-trash"></use></svg> Move to Trash</button>' +
        '</div>';

      // Wire status save
      const saveBtn = document.getElementById('orderStatusSave');
      if (saveBtn) {
        saveBtn.addEventListener('click', async function () {
          const sel = document.getElementById('orderStatusSelect');
          const newStatus = sel.value;
          setBtnLoading(saveBtn, true, 'Saving...');
          const { error: updErr } = await window.db
            .from('orders')
            .update({ status: newStatus })
            .eq('id', id);
          setBtnLoading(saveBtn, false);
          if (updErr) { toast('Unable to update status', 'error'); return; }
          toast('Order status updated');
          loadOrders();
          if (typeof window.loadOrderBadge === 'function') window.loadOrderBadge();
        });
      }

      // Wire delete (soft delete — respects Trash)
      const delBtn = document.getElementById('orderDeleteBtn');
      if (delBtn) {
        delBtn.addEventListener('click', async function () {
          if (!confirm('Move this order to Trash?\n\nYou can restore it later from the Trash view.')) return;

          setBtnLoading(delBtn, true, 'Moving...');
          let userId = null;
          try {
            const { data: sessionData } = await window.db.auth.getSession();
            userId = sessionData && sessionData.session && sessionData.session.user ? sessionData.session.user.id : null;
          } catch (e) {}

          const { error: delErr } = await window.db
            .from('orders')
            .update({ deleted_at: new Date().toISOString(), deleted_by: userId })
            .eq('id', id);

          setBtnLoading(delBtn, false);
          if (delErr) { toast('Unable to move to Trash: ' + delErr.message, 'error'); return; }

          toast('Order moved to Trash');
          closeOrderDetail();
          loadOrders();
          if (typeof window.loadOrderBadge === 'function') window.loadOrderBadge();
        });
      }
    } catch (err) {
      console.warn('[orders] detail load failed:', err);
      body.innerHTML = '<div class="empty"><h3>Unable to load order details</h3></div>';
    }
  }

  function closeOrderDetail() {
    const modal = document.getElementById('orderDetailModal');
    if (modal) modal.classList.remove('open');
    document.body.style.overflow = '';
    state.currentOrderId = null;
  }

  /* ============================================================
     5. EVENT WIRING
     ============================================================ */
  function wireEvents() {
    // Filter tabs — event delegation so newly-injected tabs work
    const orderTabs = document.getElementById('orderTabs');
    if (orderTabs && orderTabs.dataset.wired !== '1') {
      orderTabs.dataset.wired = '1';
      orderTabs.addEventListener('click', function (e) {
        const tab = e.target.closest('.tab');
        if (!tab) return;
        const filter = tab.dataset.filter;
        if (!filter) return;

        // Ignore the Trash tab — handled by admin-trash.js
        if (filter === '__trash__') return;

        // Mark active
        orderTabs.querySelectorAll('.tab').forEach(function (t) { t.classList.remove('active'); });
        tab.classList.add('active');

        state.activeFilter = filter;
        applyFilter();
      });
    }

    // Search
    const search = document.getElementById('orderSearch');
    if (search && search.dataset.wired !== '1') {
      search.dataset.wired = '1';
      search.addEventListener('input', applyFilter);
    }

    // Refresh button
    const refresh = document.getElementById('refreshOrdersBtn');
    if (refresh && refresh.dataset.wired !== '1') {
      refresh.dataset.wired = '1';
      refresh.addEventListener('click', loadOrders);
    }

    // Open-order delegation
    document.addEventListener('click', function (e) {
      const btn = e.target.closest('[data-act="open-order"]');
      if (!btn) return;
      e.preventDefault();
      openOrderDetail(btn.dataset.id);
    }, true);
  }

  /* ============================================================
     6. INIT
     ============================================================ */
  function init() {
    wireEvents();
    window.loadOrders = loadOrders;
    window.openOrderDetail = openOrderDetail;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();