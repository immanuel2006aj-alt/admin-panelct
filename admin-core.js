/* ============================================================
   CENTRAL & STORES — ADMIN CORE
   ------------------------------------------------------------
   The engine. Loads first. Provides:
     • Supabase client (window.db)
     • Auth (login, logout, session, password change)
     • Navigation between sections
     • Toast notifications (window.toast)
     • Button loading states (window.setBtnLoading)
     • Utilities: escape, safeImg, formatINR, formatDate
     • Order badge polling (new orders notification)
     • Public API for other admin scripts

   Every other admin-*.js depends on this file.
   ============================================================ */

(function () {
  'use strict';

  /* ============================================================
     1. SUPABASE CLIENT
     ============================================================ */
  const SUPABASE_URL = 'https://xcdzozyhvkonvesqvxbp.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhjZHpvenlodmtvbnZlc3F2eGJwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk5MDIwMTYsImV4cCI6MjEwNTQ3ODAxNn0.mX0u55mSR14FGr8Lt6ofENfaOqH6JcGp4ACjKnC3gKA';

  if (!window.supabase || typeof window.supabase.createClient !== 'function') {
    console.error('[Admin] Supabase SDK failed to load. Check your internet or CDN.');
    window.db = null;
    window.dbReadyPromise = Promise.resolve(null);
  } else {
    try {
      window.db = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true
        }
      });
      window.dbReadyPromise = Promise.resolve(window.db);
    } catch (err) {
      console.error('[Admin] Supabase init failed:', err);
      window.db = null;
      window.dbReadyPromise = Promise.resolve(null);
    }
  }

  /* ============================================================
     2. GLOBAL STATE
     ============================================================ */
  window.AdminState = {
    user: null,
    currentPage: 'dashboard',
    ordersPollTimer: null,
    lastSeenOrderCount: 0,
    authStateSubscribed: false,
    visibilityListenerAttached: false
  };

  const LOGIN_TIMEOUT_MS = 15000;
  const ORDERS_POLL_MS = 30000;

  /* ============================================================
     3. UTILITIES
     ============================================================ */

  function esc(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function safeImg(url) {
    if (!url || typeof url !== 'string') return '';
    const u = url.trim();
    if (u.startsWith('http://') || u.startsWith('https://') || u.startsWith('/') || u.startsWith('./')) return u;
    return '';
  }

  function fmtINR(n) {
    const value = Number(n) || 0;
    try {
      return new Intl.NumberFormat('en-IN', {
        style: 'currency',
        currency: 'INR',
        maximumFractionDigits: 0
      }).format(value);
    } catch (e) {
      return '₹' + value;
    }
  }

  function fmtDate(iso) {
    if (!iso) return '';
    try {
      return new Date(iso).toLocaleDateString('en-IN', {
        year: 'numeric', month: 'short', day: 'numeric'
      });
    } catch (e) {
      return '';
    }
  }

  function fmtDateTime(iso) {
    if (!iso) return '';
    try {
      return new Date(iso).toLocaleString('en-IN', {
        year: 'numeric', month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit'
      });
    } catch (e) {
      return '';
    }
  }

  function clearChildren(el) {
    if (!el) return;
    while (el.firstChild) el.removeChild(el.firstChild);
  }

  function copyToClipboard(text) {
    if (!text) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(
        function () { window.toast('Copied', 'success'); },
        function () { window.toast('Unable to copy', 'error'); }
      );
    } else {
      const inp = document.createElement('input');
      inp.value = text;
      document.body.appendChild(inp);
      inp.select();
      try { document.execCommand('copy'); window.toast('Copied', 'success'); }
      catch (e) { window.toast('Unable to copy', 'error'); }
      inp.remove();
    }
  }

  /* ============================================================
     4. TOAST NOTIFICATIONS
     ============================================================ */
  const SVG_NS = 'http://www.w3.org/2000/svg';

  function toast(msg, type) {
    const wrap = document.getElementById('toastWrap');
    if (!wrap) return;

    const t = document.createElement('div');
    t.className = 'toast ' + (type || 'success');

    const s = document.createElementNS(SVG_NS, 'svg');
    s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('fill', 'none');
    s.setAttribute('stroke', 'currentColor');
    s.setAttribute('stroke-width', '2.4');
    s.setAttribute('stroke-linecap', 'round');
    s.setAttribute('stroke-linejoin', 'round');

    if (type === 'success') {
      const p = document.createElementNS(SVG_NS, 'polyline');
      p.setAttribute('points', '20 6 9 17 4 12');
      s.appendChild(p);
    } else {
      const c = document.createElementNS(SVG_NS, 'circle');
      c.setAttribute('cx', '12'); c.setAttribute('cy', '12'); c.setAttribute('r', '10');
      const l1 = document.createElementNS(SVG_NS, 'line');
      l1.setAttribute('x1', '15'); l1.setAttribute('y1', '9'); l1.setAttribute('x2', '9'); l1.setAttribute('y2', '15');
      const l2 = document.createElementNS(SVG_NS, 'line');
      l2.setAttribute('x1', '9'); l2.setAttribute('y1', '9'); l2.setAttribute('x2', '15'); l2.setAttribute('y2', '15');
      s.appendChild(c); s.appendChild(l1); s.appendChild(l2);
    }

    const sp = document.createElement('span');
    sp.textContent = msg;

    t.appendChild(s);
    t.appendChild(sp);
    wrap.appendChild(t);

    setTimeout(function () {
      t.style.opacity = '0';
      setTimeout(function () { t.remove(); }, 260);
    }, 3200);
  }

  /* ============================================================
     5. BUTTON LOADING STATE
     ============================================================ */
  function setBtnLoading(btn, loading, label) {
    if (!btn) return;
    if (loading) {
      if (!btn.dataset.origHtml) btn.dataset.origHtml = btn.innerHTML;
      btn.textContent = '';
      const sp = document.createElement('span');
      sp.className = 'spinner';
      btn.appendChild(sp);
      if (label) {
        const lb = document.createElement('span');
        lb.textContent = label;
        btn.appendChild(lb);
      }
      btn.disabled = true;
    } else {
      if (btn.dataset.origHtml) {
        btn.innerHTML = btn.dataset.origHtml;
        delete btn.dataset.origHtml;
      }
      btn.disabled = false;
    }
  }

  /* ============================================================
     6. AUTH SCREEN
     ============================================================ */
  function showAuthError(msg) {
    const err = document.getElementById('authError');
    if (!err) return;
    err.textContent = msg;
    err.classList.add('show');
  }

  function clearAuthError() {
    const err = document.getElementById('authError');
    if (!err) return;
    err.textContent = '';
    err.classList.remove('show');
  }

  function showAuthInfo(msg) {
    const el = document.getElementById('authInfo');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('show');
  }

  function clearAuthInfo() {
    const el = document.getElementById('authInfo');
    if (!el) return;
    el.textContent = '';
    el.classList.remove('show');
  }

  function describeError(err) {
    if (!err) return 'Sign in failed. Please try again.';
    const msg = (err.message || '').toLowerCase();
    if (msg.includes('invalid login') || msg.includes('invalid credentials')) return 'Email or password is incorrect.';
    if (msg.includes('email not confirmed')) return 'Email not confirmed. Confirm the user in Supabase → Authentication → Users.';
    if (msg.includes('rate limit') || msg.includes('too many')) return 'Too many attempts. Please wait a minute and try again.';
    if (msg.includes('network') || msg.includes('failed to fetch')) return 'Network error. Check your internet connection.';
    if (msg.includes('user not found')) return 'No account found with that email.';
    return err.message || 'Sign in failed. Please try again.';
  }

  /* ============================================================
     7. SHOW/HIDE SCREENS
     ============================================================ */
  function showAuth() {
    const auth = document.getElementById('authScreen');
    const admin = document.getElementById('adminScreen');
    if (auth) auth.style.display = 'flex';
    if (admin) admin.classList.remove('visible');
    stopOrderPolling();
    clearTitleBadge();
  }

  function showAdmin() {
    const auth = document.getElementById('authScreen');
    const admin = document.getElementById('adminScreen');
    if (auth) auth.style.display = 'none';
    if (admin) admin.classList.add('visible');

    const user = window.AdminState.user;
    const email = (user && user.email) || '';

    const avatar = document.getElementById('avatarInitial');
    if (avatar) avatar.textContent = email.charAt(0).toUpperCase() || 'A';

    const name = document.getElementById('profileName');
    if (name) name.textContent = email.split('@')[0] || 'Admin';

    const accEmail = document.getElementById('accEmail');
    if (accEmail) accEmail.value = email;

    hydrateSettings();

    if (typeof window.loadDashboard === 'function') {
      window.loadDashboard();
    }

    if (typeof window.loadReviewBadge === 'function') {
      window.loadReviewBadge();
    }
    if (typeof window.loadOrderBadge === 'function') {
      window.loadOrderBadge();
    } else {
      loadOrderBadge();
    }

    startOrderPolling();
  }

  function hydrateSettings() {
    const cfg = window.STORE_CONFIG || {
      name: 'Central & Stores',
      phone: { display: '+91 93446 21645' },
      whatsapp: { display: '+91 93446 21645' },
      address: { street: '1/90 C Tirupur Main Road', locality: 'Mangalam', region: 'Tamil Nadu', postalCode: '641663' },
      openingHours: { display: 'Mon–Thu, Sat–Sun · 8:00 AM – 10:00 PM' }
    };

    const setVal = function (id, v) {
      const el = document.getElementById(id);
      if (el) el.value = v || '';
    };

    setVal('setName', cfg.name);
    setVal('setPhone', cfg.phone && cfg.phone.display);
    setVal('setWhatsapp', cfg.whatsapp && cfg.whatsapp.display);

    const a = cfg.address || {};
    const fullAddress = [a.street, a.locality, a.region, a.postalCode].filter(Boolean).join(', ');
    setVal('setAddress', fullAddress);
    setVal('setHours', cfg.openingHours && cfg.openingHours.display);
  }

  /* ============================================================
     8. AUTHENTICATION
     ============================================================ */
  async function checkAuth() {
    if (!window.db) {
      const btn = document.getElementById('signinBtn');
      if (btn) btn.disabled = true;
      showAuthInfo('Connecting to Supabase...');
      return false;
    }

    clearAuthInfo();

    try {
      // Get current session
      const { data: sessionData, error: sessionErr } = await window.db.auth.getSession();
      if (sessionErr) console.warn('[Admin] getSession error:', sessionErr);

      if (!sessionData || !sessionData.session) {
        showAuth();
        return false;
      }

      // Verify with getUser (fresh check — catches expired tokens)
      const { data: userData, error: userErr } = await window.db.auth.getUser();
      if (userErr || !userData || !userData.user) {
        console.warn('[Admin] getUser failed, showing auth:', userErr);
        showAuth();
        return false;
      }

      window.AdminState.user = userData.user;
      showAdmin();
      return true;
    } catch (e) {
      console.warn('[Admin] checkAuth threw:', e);
      showAuth();
      return false;
    }
  }

  async function doLogin(email, password) {
    if (!window.db) {
      showAuthError('Supabase is not reachable. Check your internet connection.');
      return false;
    }

    const btn = document.getElementById('signinBtn');
    setBtnLoading(btn, true, 'Signing in...');

    let timeoutId = setTimeout(function () {
      setBtnLoading(btn, false);
      showAuthError('Login timed out. Check your internet and try again.');
    }, LOGIN_TIMEOUT_MS);

    try {
      const { data, error } = await window.db.auth.signInWithPassword({ email, password });
      clearTimeout(timeoutId);

      if (error) {
        showAuthError(describeError(error));
        setBtnLoading(btn, false);
        return false;
      }

      if (!data || !data.user) {
        showAuthError('Sign in returned no user. Please try again.');
        setBtnLoading(btn, false);
        return false;
      }

      window.AdminState.user = data.user;
      setBtnLoading(btn, false);
      showAdmin();
      toast('Welcome back!');
      return true;
    } catch (err) {
      clearTimeout(timeoutId);
      showAuthError(describeError(err));
      setBtnLoading(btn, false);
      return false;
    }
  }

  async function doLogout() {
    try {
      if (window.db) await window.db.auth.signOut();
    } catch (e) {}
    window.AdminState.user = null;
    showAuth();
    toast('Logged out');
  }

  /* ============================================================
     9. NAVIGATION
     ============================================================ */
  const PAGE_TITLES = {
    dashboard: 'Dashboard',
    orders: 'Orders',
    products: 'Products',
    editor: 'Product Editor',
    categories: 'Categories',
    reviews: 'Reviews',
    ads: 'Advertisements',
    media: 'Media Library',
    settings: 'Store Settings',
    account: 'Account'
  };

  function navigateTo(page) {
    if (!page) return;

    // Handle virtual pages like "editor-new"
    if (page === 'editor-new') {
      if (typeof window.openEditor === 'function') {
        window.openEditor(null);
      } else {
        // Retry after a short delay (in case the script is still loading)
        setTimeout(function () {
          if (typeof window.openEditor === 'function') {
            window.openEditor(null);
          } else {
            toast('Product editor not ready yet. Try again.', 'error');
          }
        }, 200);
      }
      return;
    }

    // Hide all sections
    document.querySelectorAll('.page-section').forEach(function (s) {
      s.classList.remove('active');
    });

    // Show target section
    const target = document.getElementById('section-' + page);
    if (target) target.classList.add('active');

    // Update nav active states
    document.querySelectorAll('.nav-item[data-page], .bottom-nav-item[data-page]').forEach(function (n) {
      n.classList.remove('active');
    });
    document.querySelectorAll('.nav-item[data-page="' + page + '"], .bottom-nav-item[data-page="' + page + '"]').forEach(function (n) {
      n.classList.add('active');
    });

    // Update title bar
    const bar = document.getElementById('pageTitleBar');
    if (bar) bar.textContent = PAGE_TITLES[page] || 'Admin';

    // Close sidebar on mobile
    closeSidebar();

    // Trigger section loader based on page
    if (page === 'dashboard' && typeof window.loadDashboard === 'function') window.loadDashboard();
    if (page === 'orders' && typeof window.loadOrders === 'function') window.loadOrders();
    if (page === 'products' && typeof window.loadProducts === 'function') window.loadProducts();
    if (page === 'categories' && typeof window.loadCategories === 'function') window.loadCategories();
    if (page === 'reviews' && typeof window.loadReviewsAdmin === 'function') window.loadReviewsAdmin();
    if (page === 'ads' && typeof window.loadAds === 'function') window.loadAds();
    if (page === 'media' && typeof window.loadMedia === 'function') window.loadMedia();

    window.AdminState.currentPage = page;
  }

  /* ============================================================
     10. SIDEBAR OPEN/CLOSE
     ============================================================ */
  function openSidebar() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebarOverlay');
    const btn = document.getElementById('hamburgerBtn');
    if (sidebar) sidebar.classList.add('open');
    if (overlay) overlay.classList.add('show');
    if (btn) btn.setAttribute('aria-expanded', 'true');
    document.body.style.overflow = 'hidden';
  }

  function closeSidebar() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebarOverlay');
    const btn = document.getElementById('hamburgerBtn');
    if (sidebar) sidebar.classList.remove('open');
    if (overlay) overlay.classList.remove('show');
    if (btn) btn.setAttribute('aria-expanded', 'false');
    document.body.style.overflow = '';
  }

  /* ============================================================
     11. ORDER BADGE + POLLING
     ============================================================ */
  function updateOrderBadges(count) {
    const show = count > 0;
    const label = count > 99 ? '99+' : String(count);

    ['ordersNavBadge', 'headerOrdersBadge', 'bottomOrdersBadge'].forEach(function (id) {
      const el = document.getElementById(id);
      if (!el) return;
      if (show) {
        el.textContent = label;
        el.classList.remove('hidden');
      } else {
        el.classList.add('hidden');
      }
    });
  }

  async function loadOrderBadge() {
    if (!window.db) return;
    try {
      const { data } = await window.db
        .from('orders')
        .select('id')
        .eq('status', 'NEW')
        .is('deleted_at', null);
      const count = (data || []).length;
      updateOrderBadges(count);
      window.AdminState.lastSeenOrderCount = count;
    } catch (e) {
      // Silent
    }
  }

  function startOrderPolling() {
    stopOrderPolling();
    // Pause polling when tab is hidden — resume when visible again
    if (!window.AdminState.visibilityListenerAttached) {
      window.AdminState.visibilityListenerAttached = true;
      document.addEventListener('visibilitychange', function () {
        if (document.hidden) {
          stopOrderPolling();
        } else if (window.AdminState.user) {
          startOrderPolling();
        }
      });
    }
    window.AdminState.ordersPollTimer = setInterval(checkForNewOrders, ORDERS_POLL_MS);
    setTimeout(checkForNewOrders, 2000);
  }

  function stopOrderPolling() {
    if (window.AdminState.ordersPollTimer) {
      clearInterval(window.AdminState.ordersPollTimer);
      window.AdminState.ordersPollTimer = null;
    }
  }

  async function checkForNewOrders() {
    if (!window.db || !window.AdminState.user) return;
    if (document.hidden) return;

    try {
      const { data } = await window.db
        .from('orders')
        .select('id')
        .eq('status', 'NEW')
        .is('deleted_at', null);

      const count = (data || []).length;
      const prev = window.AdminState.lastSeenOrderCount;

      updateOrderBadges(count);

      if (count > prev && prev !== 0) {
        const diff = count - prev;
        toast(diff + ' new order' + (diff > 1 ? 's' : '') + ' received', 'info');
        playNotificationSound();
      }

      window.AdminState.lastSeenOrderCount = count;

      if (count > 0) {
        document.title = '(' + count + ') New order' + (count > 1 ? 's' : '') + ' — Central & Stores Admin';
      } else {
        clearTitleBadge();
      }
    } catch (e) {
      // Silent
    }
  }

  function clearTitleBadge() {
    document.title = 'CENTRAL & STORES — Admin Panel';
  }

  /* ============================================================
     12. NOTIFICATION SOUND
     ============================================================ */
  let audioCtx = null;

  function playNotificationSound() {
    try {
      if (!audioCtx) {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return;
        audioCtx = new Ctx();
      }
      if (audioCtx.state === 'suspended') {
        audioCtx.resume().catch(function () {});
      }

      const now = audioCtx.currentTime;
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, now);
      osc.frequency.setValueAtTime(1175, now + 0.09);

      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.14, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);

      osc.connect(gain);
      gain.connect(audioCtx.destination);

      osc.start(now);
      osc.stop(now + 0.24);
    } catch (e) {}
  }

  /* ============================================================
     13. EVENT WIRING
     ============================================================ */
  function wireEvents() {
    // Password toggle
    const pwToggle = document.getElementById('pwToggle');
    if (pwToggle && pwToggle.dataset.wired !== '1') {
      pwToggle.dataset.wired = '1';
      pwToggle.addEventListener('click', function () {
        const input = document.getElementById('loginPassword');
        if (!input) return;
        input.type = input.type === 'password' ? 'text' : 'password';
      });
    }

    // Login form
    const loginForm = document.getElementById('loginForm');
    if (loginForm && loginForm.dataset.wired !== '1') {
      loginForm.dataset.wired = '1';
      loginForm.addEventListener('submit', function (e) {
        e.preventDefault();
        clearAuthError();
        clearAuthInfo();

        const email = (document.getElementById('loginEmail') || {}).value || '';
        const password = (document.getElementById('loginPassword') || {}).value || '';

        if (!email.trim() || !password) {
          showAuthError('Please enter both email and password.');
          return;
        }

        doLogin(email.trim(), password);
      });
    }

    // Hamburger
    const hamburger = document.getElementById('hamburgerBtn');
    if (hamburger && hamburger.dataset.wired !== '1') {
      hamburger.dataset.wired = '1';
      hamburger.addEventListener('click', openSidebar);
    }

    // Sidebar overlay
    const overlay = document.getElementById('sidebarOverlay');
    if (overlay && overlay.dataset.wired !== '1') {
      overlay.dataset.wired = '1';
      overlay.addEventListener('click', closeSidebar);
    }

    // Profile dropdown toggle
    const profileBtn = document.getElementById('profileBtn');
    if (profileBtn && profileBtn.dataset.wired !== '1') {
      profileBtn.dataset.wired = '1';
      profileBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        const dd = document.getElementById('profileDropdown');
        if (dd) dd.classList.toggle('open');
      });
    }

    // Close profile dropdown on outside click
    if (!window.AdminState.dropdownOutsideAttached) {
      window.AdminState.dropdownOutsideAttached = true;
      document.addEventListener('click', function (e) {
        if (!e.target.closest('.dropdown-wrap')) {
          const dd = document.getElementById('profileDropdown');
          if (dd) dd.classList.remove('open');
        }
      });
    }

    // Global navigation & logout (event delegation)
    if (!window.AdminState.navDelegationAttached) {
      window.AdminState.navDelegationAttached = true;
      document.addEventListener('click', function (e) {
        const navEl = e.target.closest('[data-page]');
        if (navEl && navEl.dataset.page) {
          e.preventDefault();
          navigateTo(navEl.dataset.page);
          return;
        }

        const logoutEl = e.target.closest('[data-action="logout"]');
        if (logoutEl) {
          e.preventDefault();
          doLogout();
        }
      });
    }

    // Header orders button
    const headerOrders = document.getElementById('headerOrdersBtn');
    if (headerOrders && headerOrders.dataset.wired !== '1') {
      headerOrders.dataset.wired = '1';
      headerOrders.addEventListener('click', function () {
        navigateTo('orders');
      });
    }

    // Change password
    const cpBtn = document.getElementById('changePasswordBtn');
    if (cpBtn && cpBtn.dataset.wired !== '1') {
      cpBtn.dataset.wired = '1';
      cpBtn.addEventListener('click', async function () {
        if (!window.db) { toast('Not connected', 'error'); return; }

        const cur = (document.getElementById('cpCurrent') || {}).value || '';
        const nw = (document.getElementById('cpNew') || {}).value || '';
        const cf = (document.getElementById('cpConfirm') || {}).value || '';

        if (!nw || !cf) { toast('Fill new password fields', 'error'); return; }
        if (nw.length < 8) { toast('Password must be at least 8 characters', 'error'); return; }
        if (nw !== cf) { toast('Passwords do not match', 'error'); return; }

        setBtnLoading(cpBtn, true, 'Updating...');
        try {
          const { error } = await window.db.auth.updateUser({ password: nw });
          if (error) throw error;
          toast('Password updated');
          const el1 = document.getElementById('cpCurrent');
          const el2 = document.getElementById('cpNew');
          const el3 = document.getElementById('cpConfirm');
          if (el1) el1.value = '';
          if (el2) el2.value = '';
          if (el3) el3.value = '';
        } catch (err) {
          toast('Unable to update: ' + (err.message || 'Unknown error'), 'error');
        } finally {
          setBtnLoading(cpBtn, false);
        }
      });
    }
  }

  /* ============================================================
     14. PUBLIC API
     ============================================================ */
  window.AdminCore = {
    esc: esc,
    safeImg: safeImg,
    fmtINR: fmtINR,
    fmtDate: fmtDate,
    fmtDateTime: fmtDateTime,
    clearChildren: clearChildren,
    copyToClipboard: copyToClipboard,
    toast: toast,
    setBtnLoading: setBtnLoading,
    navigateTo: navigateTo,
    showAuth: showAuth,
    showAdmin: showAdmin,
    describeError: describeError,
    updateOrderBadges: updateOrderBadges,
    checkForNewOrders: checkForNewOrders,
    clearTitleBadge: clearTitleBadge,
    playNotificationSound: playNotificationSound
  };

  // Also expose top-level helpers for legacy callers
  window.toast = toast;
  window.setBtnLoading = setBtnLoading;
  window.esc = esc;
  window.safeImg = safeImg;
  window.fmtINR = fmtINR;
  window.fmtDate = fmtDate;
  window.fmtDateTime = fmtDateTime;
  window.loadOrderBadge = loadOrderBadge;

  /* ============================================================
     15. BOOT
     ============================================================ */
  function boot() {
    wireEvents();

    // Wait for Supabase client, then check auth
    if (window.db) {
      checkAuth();
    } else if (window.dbReadyPromise && typeof window.dbReadyPromise.then === 'function') {
      window.dbReadyPromise.then(function () {
        checkAuth();
      });
    } else {
      let n = 0;
      const t = setInterval(function () {
        if (window.db) {
          clearInterval(t);
          checkAuth();
        } else if (++n > 50) {
          clearInterval(t);
          showAuthInfo('Supabase is unreachable. Check your internet connection.');
        }
      }, 100);
    }

    // React to auth state changes
    if (window.db && window.db.auth && typeof window.db.auth.onAuthStateChange === 'function'
        && !window.AdminState.authStateSubscribed) {
      window.AdminState.authStateSubscribed = true;
      window.db.auth.onAuthStateChange(function (evt) {
        if (evt === 'SIGNED_OUT') {
          window.AdminState.user = null;
          showAuth();
        } else if (evt === 'TOKEN_REFRESHED' || evt === 'SIGNED_IN') {
          // Session refreshed — make sure admin screen is still visible
          if (!window.AdminState.user) {
            checkAuth();
          }
        }
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
