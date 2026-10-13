/* ============================================================
   CENTRAL & STORES — ADMIN REVIEWS
   ------------------------------------------------------------
   Reviews moderation:
     • List all reviews (pending, approved, rejected)
     • Filter tabs
     • Approve / Reject / Delete
     • Stats: total, pending, approved, rejected
     • Sidebar badge for pending
     • Soft delete (via admin-trash.js)
     • Live reflection — approved reviews appear on public site

   Depends on: admin-core.js
   ============================================================ */

(function () {
  'use strict';

  const esc = window.AdminCore.esc;
  const toast = window.AdminCore.toast;
  const setBtnLoading = window.AdminCore.setBtnLoading;
  const fmtDate = window.AdminCore.fmtDate;

  /* ============================================================
     STATE
     ============================================================ */
  const state = {
    allReviews: [],
    activeFilter: 'all',
    loaded: false
  };

  const STATUS_LABEL = {
    pending: 'Pending',
    approved: 'Approved',
    rejected: 'Rejected'
  };

  /* ============================================================
     1. LOAD REVIEWS
     ============================================================ */
  async function loadReviewsAdmin() {
    if (!window.db) return;

    const container = document.getElementById('reviewsAdminContainer');
    if (container) {
      container.innerHTML =
        '<div class="card"><div class="card-body">' +
          '<div class="skeleton" style="height:80px;margin-bottom:12px"></div>' +
          '<div class="skeleton" style="height:80px"></div>' +
        '</div></div>';
    }

    try {
      const { data, error } = await window.db
        .from('reviews')
        .select('*')
        .is('deleted_at', null)
        .order('created_at', { ascending: false });

      if (error) throw error;

      state.allReviews = data || [];
      state.loaded = true;

      updateStats();
      updateBadge();
      renderReviews();
    } catch (err) {
      console.warn('[reviews] load failed:', err);
      if (container) {
        container.innerHTML =
          '<div class="card"><div class="card-body">' +
            '<div class="empty">' +
              '<h3>Unable to load reviews</h3>' +
              '<p>' + esc(err.message || '') + '</p>' +
              '<button class="btn btn-primary" id="reviewsRetryBtn">Try Again</button>' +
            '</div>' +
          '</div></div>';

        const retry = document.getElementById('reviewsRetryBtn');
        if (retry) retry.addEventListener('click', loadReviewsAdmin);
      }
    }
  }

  /* ============================================================
     2. BADGE + STATS
     ============================================================ */
  function updateBadge() {
    const pending = state.allReviews.filter(function (r) { return r.status === 'pending'; }).length;
    const badge = document.getElementById('reviewsNavBadge');
    if (!badge) return;
    if (pending > 0) {
      badge.textContent = pending > 99 ? '99+' : String(pending);
      badge.classList.remove('hidden');
    } else {
      badge.classList.add('hidden');
    }
  }

  function updateStats() {
    const t = state.allReviews.length;
    const p = state.allReviews.filter(function (r) { return r.status === 'pending'; }).length;
    const a = state.allReviews.filter(function (r) { return r.status === 'approved'; }).length;
    const j = state.allReviews.filter(function (r) { return r.status === 'rejected'; }).length;

    const set = function (id, v) {
      const el = document.getElementById(id);
      if (el) el.textContent = v;
    };

    set('rvStatTotal', t);
    set('rvStatPending', p);
    set('rvStatApproved', a);
    set('rvStatRejected', j);
  }

  /* ============================================================
     3. RENDER
     ============================================================ */
  function renderStars(rating) {
    const n = Math.max(1, Math.min(5, Number(rating) || 0));
    let out = '';
    for (let i = 0; i < n; i++) {
      out += '<svg viewBox="0 0 24 24" style="width:14px;height:14px;fill:#f5b400;stroke:#f5b400"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>';
    }
    return out;
  }

  function renderReviews() {
    const container = document.getElementById('reviewsAdminContainer');
    if (!container) return;

    let list = state.allReviews;
    if (state.activeFilter !== 'all') {
      list = state.allReviews.filter(function (r) { return r.status === state.activeFilter; });
    }

    if (list.length === 0) {
      const isEmpty = state.allReviews.length === 0;
      container.innerHTML =
        '<div class="card"><div class="card-body">' +
          '<div class="empty">' +
            '<svg viewBox="0 0 24 24"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>' +
            '<h3>' + (isEmpty ? 'No reviews yet' : 'No ' + state.activeFilter + ' reviews') + '</h3>' +
            '<p>' + (isEmpty
              ? 'Reviews from your website will appear here.'
              : 'Try a different tab.') + '</p>' +
          '</div>' +
        '</div></div>';
      return;
    }

    container.innerHTML = '<div class="card">' + list.map(function (r) {
      const name = esc(r.customer_name || 'Customer');
      const text = esc(r.review_text || '');
      const status = ['pending', 'approved', 'rejected'].includes(r.status) ? r.status : 'pending';
      const date = fmtDate(r.created_at);
      const statusCls = status === 'approved' ? 'badge-green' : status === 'rejected' ? 'badge-red' : 'badge-gold';

      let actions = '';
      if (status === 'pending') {
        actions =
          '<button class="action-btn restore" data-act="approve-review" data-id="' + esc(String(r.id)) + '">' +
            '<svg viewBox="0 0 24 24"><use href="#icon-save"></use></svg> Approve' +
          '</button>' +
          '<button class="action-btn delete" data-act="reject-review" data-id="' + esc(String(r.id)) + '">' +
            '<svg viewBox="0 0 24 24"><use href="#icon-close"></use></svg> Reject' +
          '</button>' +
          '<button class="icon-action danger" data-act="del" data-id="' + esc(String(r.id)) + '" title="Delete"><svg viewBox="0 0 24 24"><use href="#icon-trash"></use></svg></button>';
      } else if (status === 'approved') {
        actions =
          '<button class="action-btn delete" data-act="reject-review" data-id="' + esc(String(r.id)) + '">' +
            '<svg viewBox="0 0 24 24"><use href="#icon-close"></use></svg> Hide' +
          '</button>' +
          '<button class="icon-action danger" data-act="del" data-id="' + esc(String(r.id)) + '" title="Delete"><svg viewBox="0 0 24 24"><use href="#icon-trash"></use></svg></button>';
      } else {
        actions =
          '<button class="action-btn restore" data-act="approve-review" data-id="' + esc(String(r.id)) + '">' +
            '<svg viewBox="0 0 24 24"><use href="#icon-save"></use></svg> Approve' +
          '</button>' +
          '<button class="icon-action danger" data-act="del" data-id="' + esc(String(r.id)) + '" title="Delete"><svg viewBox="0 0 24 24"><use href="#icon-trash"></use></svg></button>';
      }

      return '<div style="padding:16px 18px;border-bottom:1px solid var(--gray-100)">' +
        '<div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:8px">' +
          '<div style="min-width:0">' +
            '<strong>' + name + '</strong> ' +
            '<span style="display:inline-flex;gap:2px;vertical-align:middle;margin-left:4px">' + renderStars(r.rating) + '</span>' +
          '</div>' +
          '<div style="display:flex;gap:6px;align-items:center;flex-shrink:0">' +
            '<span class="badge ' + statusCls + '">' + esc(STATUS_LABEL[status] || status) + '</span>' +
            '<span class="text-muted" style="font-size:.75rem">' + esc(date) + '</span>' +
          '</div>' +
        '</div>' +
        '<div style="font-size:.875rem;color:var(--gray-700);line-height:1.6;word-break:break-word;overflow-wrap:anywhere;margin-bottom:10px">' + text + '</div>' +
        '<div class="row-actions" style="flex-wrap:wrap;gap:8px">' + actions + '</div>' +
      '</div>';
    }).join('') + '</div>';
  }

  /* ============================================================
     4. ACTIONS
     ============================================================ */
  async function reviewAction(action, id) {
    if (!window.db) return;

    let payload = null;
    let successMsg = '';

    if (action === 'approve') {
      payload = { status: 'approved' };
      successMsg = 'Review approved';
    } else if (action === 'reject') {
      payload = { status: 'rejected' };
      successMsg = 'Review rejected';
    } else if (action === 'delete') {
      if (!confirm('Permanently delete this review? This cannot be undone.')) return;
      const { error } = await window.db.from('reviews').delete().eq('id', id);
      if (error) { toast('Unable to delete: ' + error.message, 'error'); return; }
      toast('Review deleted');
      loadReviewsAdmin();
      if (typeof window.loadDashboard === 'function') window.loadDashboard();
      return;
    }

    const { error } = await window.db.from('reviews').update(payload).eq('id', id);
    if (error) { toast('Unable to update: ' + error.message, 'error'); return; }

    toast(successMsg);
    loadReviewsAdmin();
    if (typeof window.loadDashboard === 'function') window.loadDashboard();
  }

  /* ============================================================
     5. EVENT WIRING
     ============================================================ */
  function wireEvents() {
    // Approve / Reject / Delete buttons
    document.addEventListener('click', function (e) {
      const btn = e.target.closest('[data-act]');
      if (!btn) return;

      const act = btn.dataset.act;
      const id = btn.dataset.id;
      if (!id) return;

      if (act === 'approve-review') {
        e.preventDefault();
        reviewAction('approve', id);
      } else if (act === 'reject-review') {
        e.preventDefault();
        reviewAction('reject', id);
      }
      // del is handled by admin-trash.js (soft delete)
    }, true);

    // Filter tabs
    document.querySelectorAll('#reviewTabs .tab').forEach(function (tab) {
      tab.addEventListener('click', function () {
        document.querySelectorAll('#reviewTabs .tab').forEach(function (t) { t.classList.remove('active'); });
        tab.classList.add('active');
        state.activeFilter = tab.dataset.filter || 'all';
        renderReviews();
      });
    });

    // Refresh
    const refresh = document.getElementById('refreshReviewsBtn');
    if (refresh) refresh.addEventListener('click', loadReviewsAdmin);
  }

  /* ============================================================
     6. INIT
     ============================================================ */
  function init() {
    wireEvents();

    window.loadReviewsAdmin = loadReviewsAdmin;
    window.loadReviewBadge = function () {
      // Called on login — fetch only the count
      if (!window.db) return;
      window.db
        .from('reviews')
        .select('id')
        .eq('status', 'pending')
        .is('deleted_at', null)
        .then(function (res) {
          const count = (res.data || []).length;
          const badge = document.getElementById('reviewsNavBadge');
          if (!badge) return;
          if (count > 0) {
            badge.textContent = count > 99 ? '99+' : String(count);
            badge.classList.remove('hidden');
          } else {
            badge.classList.add('hidden');
          }
        })
        .catch(function () {});
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
