/* ============================================================
   CENTRAL & STORES — ADMIN ADVERTISEMENTS
   ------------------------------------------------------------
   Full ad management:
     • List with filters (placement, status)
     • Search by title
     • Add / Edit / Delete
     • Scheduling (start_at, end_at)
     • Targeting (category, product)
     • CTA types (URL, product, category, WhatsApp, contact)
     • Image upload (compressed)
     • Live preview inside modal
     • Impression / click tracking
     • Stats cards
     • Soft delete via admin-trash.js

   Depends on: admin-core.js
   ============================================================ */

(function () {
  'use strict';

  const esc = window.AdminCore.esc;
  const safeImg = window.AdminCore.safeImg;
  const fmtDate = window.AdminCore.fmtDate;
  const toast = window.AdminCore.toast;
  const setBtnLoading = window.AdminCore.setBtnLoading;

  /* ============================================================
     STATE
     ============================================================ */
  const state = {
    allAds: [],
    filteredAds: [],
    formMode: 'new',
    formId: null,
    formImageUrl: '',
    deleteTargetId: null,
    loaded: false
  };

  const PLACEMENT_LABELS = {
    homepage_hero: 'Homepage Hero',
    homepage_promotional_banner: 'Homepage Promo',
    category_banner: 'Category Banner',
    product_listing_banner: 'Product Listing Banner',
    product_detail_promotion: 'Product Detail Promo',
    cart_promotion: 'Cart Promo',
    checkout_promotion: 'Checkout Promo'
  };

  const STATUS_LABELS = {
    draft: 'Draft',
    active: 'Active',
    disabled: 'Disabled'
  };

  /* ============================================================
     1. LOAD ADS
     ============================================================ */
  async function loadAds() {
    if (!window.db) return;

    const tbody = document.getElementById('adsBody');
    const mobile = document.getElementById('adsMobile');
    if (tbody) tbody.innerHTML = '<tr><td colspan="7" style="padding:24px"><div class="skeleton" style="height:24px"></div></td></tr>';
    if (mobile) mobile.innerHTML = '<div class="skeleton" style="height:80px"></div>';

    try {
      const { data, error } = await window.db
        .from('advertisements')
        .select('*')
        .is('deleted_at', null)
        .order('display_order', { ascending: true })
        .order('created_at', { ascending: false });

      if (error) throw error;

      state.allAds = data || [];
      state.loaded = true;

      updateStats();
      applyFilters();
    } catch (err) {
      console.warn('[ads] load failed:', err);
      if (tbody) tbody.innerHTML = '<tr><td colspan="7"><div class="empty"><h3>Unable to load advertisements</h3><p>' + esc(err.message || '') + '</p></div></td></tr>';
      if (mobile) mobile.innerHTML = '';
    }
  }

  /* ============================================================
     2. STATS
     ============================================================ */
  function updateStats() {
    const total = state.allAds.length;
    const now = Date.now();
    let active = 0, scheduled = 0, impressions = 0;

    state.allAds.forEach(function (ad) {
      impressions += Number(ad.impression_count) || 0;
      if (ad.status === 'active') {
        const start = ad.start_at ? new Date(ad.start_at).getTime() : null;
        const end = ad.end_at ? new Date(ad.end_at).getTime() : null;
        if ((start === null || start <= now) && (end === null || end >= now)) active++;
        else if (start !== null && start > now) scheduled++;
      }
    });

    const set = function (id, v) {
      const el = document.getElementById(id);
      if (el) el.textContent = v;
    };

    set('adsStatTotal', total);
    set('adsStatActive', active);
    set('adsStatScheduled', scheduled);
    set('adsStatImpressions', impressions.toLocaleString('en-IN'));
  }

  /* ============================================================
     3. FILTERS
     ============================================================ */
  function applyFilters() {
    const q = (document.getElementById('adsSearch') || {}).value || '';
    const pl = (document.getElementById('adsFilterPlacement') || {}).value || '';
    const st = (document.getElementById('adsFilterStatus') || {}).value || '';

    let list = state.allAds.slice();
    if (q.trim()) {
      const query = q.trim().toLowerCase();
      list = list.filter(function (a) {
        return String(a.title || '').toLowerCase().includes(query);
      });
    }
    if (pl) list = list.filter(function (a) { return a.placement === pl; });
    if (st) list = list.filter(function (a) { return a.status === st; });

    state.filteredAds = list;
    renderAds();
  }

  /* ============================================================
     4. DISPLAY STATUS
     ============================================================ */
  function computeDisplayStatus(ad) {
    if (ad.status === 'draft') return { label: 'Draft', cls: 'badge-gray' };
    if (ad.status === 'disabled') return { label: 'Disabled', cls: 'badge-red' };
    const now = Date.now();
    const start = ad.start_at ? new Date(ad.start_at).getTime() : null;
    const end = ad.end_at ? new Date(ad.end_at).getTime() : null;
    if (start !== null && start > now) return { label: 'Scheduled', cls: 'badge-blue' };
    if (end !== null && end < now) return { label: 'Expired', cls: 'badge-warn' };
    return { label: 'Live', cls: 'badge-green' };
  }

  function adScheduleText(ad) {
    const start = ad.start_at ? fmtDate(ad.start_at) : '—';
    const end = ad.end_at ? fmtDate(ad.end_at) : '—';
    if (!ad.start_at && !ad.end_at) return 'Always';
    return start + ' → ' + end;
  }

  /* ============================================================
     5. RENDER
     ============================================================ */
  function renderAds() {
    const tbody = document.getElementById('adsBody');
    const mobile = document.getElementById('adsMobile');
    const items = state.filteredAds;

    if (items.length === 0) {
      const isEmpty = state.allAds.length === 0;
      const empty =
        '<div class="empty">' +
          '<svg viewBox="0 0 24 24"><path d="M3 11v2a1 1 0 001 1h2l4 4V6L6 10H4a1 1 0 00-1 1z" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M15.5 8.5a5 5 0 010 7" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M18.5 5.5a9 9 0 010 13" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>' +
          '<h3>' + (isEmpty ? 'No advertisements yet' : 'No matching ads') + '</h3>' +
          '<p>' + (isEmpty ? 'Create your first ad to promote products.' : 'Try a different filter.') + '</p>' +
          (isEmpty ? '<button class="btn btn-primary" id="adsEmptyNewBtn">New Advertisement</button>' : '') +
        '</div>';
      if (tbody) tbody.innerHTML = '<tr><td colspan="7">' + empty + '</td></tr>';
      if (mobile) mobile.innerHTML = '';
      const emptyBtn = document.getElementById('adsEmptyNewBtn');
      if (emptyBtn) emptyBtn.addEventListener('click', function () { openAdForm(null); });
      return;
    }

    if (tbody) {
      tbody.innerHTML = items.map(function (ad) {
        const img = safeImg(ad.image_url);
        const disp = computeDisplayStatus(ad);
        return '<tr>' +
          '<td><div class="prod-cell">' +
            '<div class="prod-thumb">' + (img ? '<img src="' + esc(img) + '" alt="" loading="lazy">' : '') + '</div>' +
            '<div style="min-width:0"><div class="prod-name" title="' + esc(ad.title) + '">' + esc(ad.title) + '</div>' +
              '<div class="text-muted" style="font-size:.7rem">#' + esc(String(ad.id)) + '</div>' +
            '</div>' +
          '</div></td>' +
          '<td>' + esc(PLACEMENT_LABELS[ad.placement] || ad.placement) + '</td>' +
          '<td><span class="badge badge-gray">' + esc(ad.campaign_type || 'GENERAL') + '</span></td>' +
          '<td><span class="text-muted" style="font-size:.75rem">' + esc(adScheduleText(ad)) + '</span></td>' +
          '<td><span class="badge ' + disp.cls + '">' + esc(disp.label) + '</span></td>' +
          '<td><div style="display:flex;flex-direction:column;gap:2px;font-size:.75rem">' +
            '<span>👁 ' + Number(ad.impression_count || 0).toLocaleString('en-IN') + '</span>' +
            '<span>🖱 ' + Number(ad.click_count || 0).toLocaleString('en-IN') + '</span>' +
          '</div></td>' +
          '<td><div class="row-actions">' +
            '<button class="icon-action" data-act="ad-edit" data-id="' + esc(String(ad.id)) + '" title="Edit"><svg viewBox="0 0 24 24"><use href="#icon-edit"></use></svg></button>' +
            '<button class="icon-action" data-act="ad-toggle" data-id="' + esc(String(ad.id)) + '" title="' + (ad.status === 'active' ? 'Disable' : 'Enable') + '"><svg viewBox="0 0 24 24"><use href="#icon-eye"></use></svg></button>' +
            '<button class="icon-action danger" data-act="del" data-id="' + esc(String(ad.id)) + '" title="Delete"><svg viewBox="0 0 24 24"><use href="#icon-trash"></use></svg></button>' +
          '</div></td>' +
        '</tr>';
      }).join('');
    }

    if (mobile) {
      mobile.innerHTML = items.map(function (ad) {
        const img = safeImg(ad.image_url);
        const disp = computeDisplayStatus(ad);
        return '<div class="mobile-card">' +
          '<div class="mobile-card-top">' +
            '<div class="mobile-card-thumb" style="width:80px;height:52px">' +
              (img ? '<img src="' + esc(img) + '" alt="" loading="lazy">' : '') +
            '</div>' +
            '<div class="mobile-card-info">' +
              '<div class="mobile-card-name">' + esc(ad.title) + '</div>' +
              '<div class="mobile-card-meta">' + esc(PLACEMENT_LABELS[ad.placement] || ad.placement) + '</div>' +
              '<div class="mobile-card-meta">' + esc(adScheduleText(ad)) + '</div>' +
            '</div>' +
          '</div>' +
          '<div class="mobile-card-badges">' +
            '<span class="badge ' + disp.cls + '">' + esc(disp.label) + '</span>' +
            '<span class="badge badge-gray">' + esc(ad.campaign_type || 'GENERAL') + '</span>' +
          '</div>' +
          '<div class="text-muted" style="font-size:.75rem;margin-bottom:8px">👁 ' +
            Number(ad.impression_count || 0).toLocaleString('en-IN') + ' · 🖱 ' +
            Number(ad.click_count || 0).toLocaleString('en-IN') + '</div>' +
          '<div class="mobile-card-actions">' +
            '<button class="action-btn edit" data-act="ad-edit" data-id="' + esc(String(ad.id)) + '">' +
              '<svg viewBox="0 0 24 24"><use href="#icon-edit"></use></svg> Edit' +
            '</button>' +
            '<button class="action-btn delete" data-act="del" data-id="' + esc(String(ad.id)) + '">' +
              '<svg viewBox="0 0 24 24"><use href="#icon-trash"></use></svg> Delete' +
            '</button>' +
          '</div>' +
        '</div>';
      }).join('');
    }
  }

  /* ============================================================
     6. AD FORM MODAL
     ============================================================ */
  async function openAdForm(id) {
    state.formMode = id ? 'edit' : 'new';
    state.formId = id;
    state.formImageUrl = '';

    let existing = null;
    if (id) {
      const { data, error } = await window.db
        .from('advertisements')
        .select('*')
        .eq('id', id)
        .single();
      if (error) { toast('Unable to load ad', 'error'); return; }
      existing = data;
    }

    const modal = document.createElement('div');
    modal.className = 'modal-overlay open';
    modal.id = 'adFormModal';
    modal.innerHTML =
      '<div class="modal modal-wide" role="dialog" aria-modal="true">' +
        '<h3>' + (existing ? 'Edit Advertisement' : 'New Advertisement') + '</h3>' +
        '<p>' + (existing
          ? 'Update the ad. Changes take effect immediately.'
          : 'Fill in the details. Ads preview as customers see them.') + '</p>' +

        '<div class="form-section">' +
          '<div class="form-section-head">Creative</div>' +
          '<div id="adUploadZoneWrap">' +
            '<div class="upload-zone" id="adUploadZone">' +
              '<svg viewBox="0 0 24 24"><use href="#icon-upload"></use></svg>' +
              '<h4>Upload creative</h4>' +
              '<p>Recommended: 16:7 for banners, 16:9 for cards</p>' +
              '<p style="font-size:.7rem;color:var(--gray-400);margin-top:10px">JPG · PNG · WEBP · Max 5 MB</p>' +
            '</div>' +
            '<input type="file" id="adImageInput" accept="image/jpeg,image/png,image/webp" hidden>' +
            '<div class="upload-preview hidden" id="adUploadPreview">' +
              '<img id="adUploadPreviewImg" alt="Ad preview">' +
              '<div class="upload-preview-actions">' +
                '<button type="button" class="icon-action" id="adReplaceImage" aria-label="Replace"><svg viewBox="0 0 24 24"><use href="#icon-restore"></use></svg></button>' +
                '<button type="button" class="icon-action danger" id="adRemoveImage" aria-label="Remove"><svg viewBox="0 0 24 24"><use href="#icon-trash"></use></svg></button>' +
              '</div>' +
            '</div>' +
          '</div>' +
        '</div>' +

        '<div class="form-section">' +
          '<div class="form-section-head">Content</div>' +
          '<div class="field"><label for="adTitle">Title *</label><input type="text" id="adTitle" maxlength="120" placeholder="e.g. Diwali Special Offer"></div>' +
          '<div class="field"><label for="adDescription">Description</label><textarea id="adDescription" maxlength="300" placeholder="Short supporting text"></textarea></div>' +
          '<div class="field"><label for="adAltText">Alt text (accessibility)</label><input type="text" id="adAltText" maxlength="120" placeholder="Short image description"></div>' +
        '</div>' +

        '<div class="form-section">' +
          '<div class="form-section-head">Placement &amp; Campaign</div>' +
          '<div class="field-row">' +
            '<div class="field"><label for="adPlacement">Placement *</label>' +
              '<select id="adPlacement" required>' +
                '<option value="homepage_hero">Homepage Hero</option>' +
                '<option value="homepage_promotional_banner" selected>Homepage Promotional Banner</option>' +
                '<option value="category_banner">Category Banner</option>' +
                '<option value="product_listing_banner">Product Listing Banner</option>' +
                '<option value="product_detail_promotion">Product Detail Promotion</option>' +
                '<option value="cart_promotion">Cart Promotion</option>' +
                '<option value="checkout_promotion">Checkout Promotion</option>' +
              '</select>' +
            '</div>' +
            '<div class="field"><label for="adCampaignType">Campaign Type</label>' +
              '<select id="adCampaignType">' +
                '<option value="PROMOTION">Promotion</option>' +
                '<option value="PRODUCT">Product</option>' +
                '<option value="CATEGORY">Category</option>' +
                '<option value="SEASONAL">Seasonal</option>' +
                '<option value="ANNOUNCEMENT">Announcement</option>' +
                '<option value="GENERAL" selected>General</option>' +
              '</select>' +
            '</div>' +
          '</div>' +
          '<div class="field-row">' +
            '<div class="field"><label for="adDisplayOrder">Display order</label>' +
              '<input type="number" id="adDisplayOrder" min="0" step="1" value="0">' +
              '<div class="field-hint">Lower numbers appear first.</div>' +
            '</div>' +
            '<div class="field"><label for="adStatus">Status *</label>' +
              '<select id="adStatus" required>' +
                '<option value="draft">Draft — not public</option>' +
                '<option value="active" selected>Active — live if schedule allows</option>' +
                '<option value="disabled">Disabled — manually off</option>' +
              '</select>' +
            '</div>' +
          '</div>' +
        '</div>' +

        '<div class="form-section">' +
          '<div class="form-section-head">Schedule (optional)</div>' +
          '<div class="field-row">' +
            '<div class="field"><label for="adStartAt">Start at</label><input type="datetime-local" id="adStartAt"></div>' +
            '<div class="field"><label for="adEndAt">End at</label><input type="datetime-local" id="adEndAt"></div>' +
          '</div>' +
        '</div>' +

        '<div class="form-section">' +
          '<div class="form-section-head">Targeting (optional)</div>' +
          '<div class="field-row">' +
            '<div class="field"><label for="adTargetCategory">Target category</label><input type="text" id="adTargetCategory" maxlength="80" placeholder="e.g. Rice &amp; Flours"></div>' +
            '<div class="field"><label for="adTargetProductId">Target product ID</label><input type="number" id="adTargetProductId" min="0" step="1"></div>' +
          '</div>' +
        '</div>' +

        '<div class="form-section">' +
          '<div class="form-section-head">Call to action</div>' +
          '<div class="field-row">' +
            '<div class="field"><label for="adCtaType">CTA type *</label>' +
              '<select id="adCtaType">' +
                '<option value="none">No CTA</option>' +
                '<option value="product">Product</option>' +
                '<option value="category">Category</option>' +
                '<option value="url">External URL</option>' +
                '<option value="whatsapp">WhatsApp</option>' +
                '<option value="contact">Contact section</option>' +
              '</select>' +
            '</div>' +
            '<div class="field"><label for="adCtaLabel">CTA label</label><input type="text" id="adCtaLabel" maxlength="40" placeholder="e.g. Shop Now"></div>' +
          '</div>' +
          '<div class="field" id="adCtaUrlWrap" style="display:none">' +
            '<label for="adCtaUrl">CTA URL</label>' +
            '<input type="text" id="adCtaUrl" placeholder="https://... or /internal/path">' +
          '</div>' +
        '</div>' +

        '<div class="modal-actions" style="margin-top:20px">' +
          '<button class="btn btn-secondary" id="adFormCancel" type="button">Cancel</button>' +
          '<button class="btn btn-primary" id="adFormSave" type="button">' + (existing ? 'Save Changes' : 'Create Advertisement') + '</button>' +
        '</div>' +
      '</div>';

    document.body.appendChild(modal);
    document.body.style.overflow = 'hidden';

    // Populate existing values
    if (existing) {
      const setVal = function (id, v) {
        const el = document.getElementById(id);
        if (el) el.value = v != null ? v : '';
      };
      setVal('adTitle', existing.title);
      setVal('adDescription', existing.description);
      setVal('adAltText', existing.alt_text);
      setVal('adPlacement', existing.placement);
      setVal('adCampaignType', existing.campaign_type || 'GENERAL');
      setVal('adDisplayOrder', existing.display_order || 0);
      setVal('adStatus', existing.status || 'draft');
      setVal('adTargetCategory', existing.target_category);
      setVal('adTargetProductId', existing.target_product_id);
      setVal('adCtaType', existing.cta_type || 'none');
      setVal('adCtaLabel', existing.cta_label);
      setVal('adCtaUrl', existing.cta_url);

      if (existing.start_at) {
        const d = new Date(existing.start_at);
        const pad = function (n) { return String(n).padStart(2, '0'); };
        setVal('adStartAt', d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes()));
      }
      if (existing.end_at) {
        const d = new Date(existing.end_at);
        const pad = function (n) { return String(n).padStart(2, '0'); };
        setVal('adEndAt', d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes()));
      }

      const img = safeImg(existing.image_url);
      if (img) {
        state.formImageUrl = img;
        showImagePreview(img);
      }
    }

    // Wire CTA URL toggle
    const ctaSelect = document.getElementById('adCtaType');
    if (ctaSelect) {
      ctaSelect.addEventListener('change', function () {
        const wrap = document.getElementById('adCtaUrlWrap');
        if (wrap) wrap.style.display = ctaSelect.value === 'url' ? '' : 'none';
      });
      // Initial state
      const wrap = document.getElementById('adCtaUrlWrap');
      if (wrap) wrap.style.display = ctaSelect.value === 'url' ? '' : 'none';
    }

    // Wire upload zone
    const zone = document.getElementById('adUploadZone');
    const input = document.getElementById('adImageInput');
    if (zone && input) {
      zone.addEventListener('click', function () { input.click(); });
      zone.addEventListener('dragover', function (e) { e.preventDefault(); zone.classList.add('drag'); });
      zone.addEventListener('dragleave', function () { zone.classList.remove('drag'); });
      zone.addEventListener('drop', function (e) {
        e.preventDefault();
        zone.classList.remove('drag');
        const f = e.dataTransfer.files[0];
        if (f) handleAdUpload(f);
      });
      input.addEventListener('change', function (e) {
        const f = e.target.files[0];
        if (f) handleAdUpload(f);
      });
    }

    const replace = document.getElementById('adReplaceImage');
    if (replace && input) replace.addEventListener('click', function () { input.click(); });

    const remove = document.getElementById('adRemoveImage');
    if (remove) {
      remove.addEventListener('click', function () {
        state.formImageUrl = '';
        const prev = document.getElementById('adUploadPreview');
        const zone = document.getElementById('adUploadZone');
        if (prev) prev.classList.add('hidden');
        if (zone) zone.classList.remove('hidden');
        if (input) input.value = '';
      });
    }

    // Close handlers
    const close = function () {
      modal.remove();
      document.body.style.overflow = '';
    };
    document.getElementById('adFormCancel').addEventListener('click', close);
    modal.addEventListener('click', function (e) { if (e.target === modal) close(); });

    // Save
    document.getElementById('adFormSave').addEventListener('click', saveAd);
  }

  /* ============================================================
     7. UPLOAD
     ============================================================ */
  function showImagePreview(url) {
    const img = document.getElementById('adUploadPreviewImg');
    const prev = document.getElementById('adUploadPreview');
    const zone = document.getElementById('adUploadZone');
    if (img) img.src = url;
    if (prev) prev.classList.remove('hidden');
    if (zone) zone.classList.add('hidden');
  }

  async function handleAdUpload(file) {
    if (!window.db) { toast('Not connected', 'error'); return; }

    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowed.includes(file.type)) { toast('Only JPG, PNG or WEBP allowed', 'error'); return; }
    if (file.size > 5 * 1024 * 1024) { toast('Max 5 MB', 'error'); return; }

    toast('Uploading...');
    const fname = 'ads/' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.webp';

    const { error } = await window.db.storage
      .from('advertisements')
      .upload(fname, file, {
        cacheControl: '3600',
        contentType: file.type,
        upsert: false
      });

    if (error) { toast('Upload failed: ' + error.message, 'error'); return; }

    const { data } = window.db.storage.from('advertisements').getPublicUrl(fname);
    state.formImageUrl = data.publicUrl;
    showImagePreview(state.formImageUrl);
    toast('Creative uploaded');
  }

  /* ============================================================
     8. SAVE AD
     ============================================================ */
  async function saveAd() {
    const title = (document.getElementById('adTitle') || {}).value || '';
    if (!title.trim()) { toast('Title is required', 'error'); return; }

    const ctaType = (document.getElementById('adCtaType') || {}).value || 'none';
    const ctaUrl = (document.getElementById('adCtaUrl') || {}).value || '';
    const targetCategory = (document.getElementById('adTargetCategory') || {}).value || '';
    const targetProductId = (document.getElementById('adTargetProductId') || {}).value || '';

    if (ctaType === 'product' && !targetProductId) { toast('CTA "Product" requires a target product ID', 'error'); return; }
    if (ctaType === 'category' && !targetCategory) { toast('CTA "Category" requires a target category', 'error'); return; }
    if (ctaType === 'url') {
      if (!ctaUrl.trim()) { toast('CTA "URL" requires a URL', 'error'); return; }
      const low = ctaUrl.toLowerCase();
      if (low.startsWith('javascript:') || low.startsWith('data:') || low.startsWith('vbscript:') || low.startsWith('file:') || low.startsWith('blob:')) {
        toast('That URL scheme is not allowed', 'error'); return;
      }
      if (!low.startsWith('https://') && !low.startsWith('/')) {
        toast('URL must start with https:// or /', 'error'); return;
      }
    }

    const startAt = (document.getElementById('adStartAt') || {}).value;
    const endAt = (document.getElementById('adEndAt') || {}).value;

    const payload = {
      title: title.trim(),
      description: ((document.getElementById('adDescription') || {}).value || '').trim() || null,
      alt_text: ((document.getElementById('adAltText') || {}).value || '').trim() || null,
      image_url: state.formImageUrl || null,
      placement: (document.getElementById('adPlacement') || {}).value,
      campaign_type: (document.getElementById('adCampaignType') || {}).value,
      status: (document.getElementById('adStatus') || {}).value,
      display_order: parseInt((document.getElementById('adDisplayOrder') || {}).value, 10) || 0,
      start_at: startAt ? new Date(startAt).toISOString() : null,
      end_at: endAt ? new Date(endAt).toISOString() : null,
      target_category: targetCategory.trim() || null,
      target_product_id: targetProductId ? parseInt(targetProductId, 10) : null,
      cta_type: ctaType,
      cta_label: ((document.getElementById('adCtaLabel') || {}).value || '').trim() || null,
      cta_url: ctaType === 'url' ? (ctaUrl.trim() || null) : null
    };

    const btn = document.getElementById('adFormSave');
    setBtnLoading(btn, true, 'Saving...');

    try {
      let result;
      if (state.formMode === 'edit' && state.formId) {
        result = await window.db.from('advertisements').update(payload).eq('id', state.formId);
      } else {
        result = await window.db.from('advertisements').insert(payload);
      }
      if (result.error) throw result.error;

      toast(state.formMode === 'edit' ? 'Advertisement updated' : 'Advertisement created');

      const modal = document.getElementById('adFormModal');
      if (modal) modal.remove();
      document.body.style.overflow = '';

      loadAds();
    } catch (err) {
      toast('Unable to save: ' + (err.message || 'Unknown'), 'error');
    } finally {
      setBtnLoading(btn, false);
    }
  }

  /* ============================================================
     9. TOGGLE STATUS
     ============================================================ */
  async function toggleAdStatus(id) {
    if (!window.db) return;
    const ad = state.allAds.find(function (a) { return String(a.id) === String(id); });
    if (!ad) return;
    const next = ad.status === 'active' ? 'disabled' : 'active';
    const { error } = await window.db
      .from('advertisements')
      .update({ status: next })
      .eq('id', id);
    if (error) { toast('Unable to update status', 'error'); return; }
    toast('Ad ' + (next === 'active' ? 'enabled' : 'disabled'));
    loadAds();
  }

  /* ============================================================
     10. EVENT WIRING
     ============================================================ */
  function wireEvents() {
    // New ad button
    const newBtn = document.getElementById('adsNewBtn');
    if (newBtn) newBtn.addEventListener('click', function () { openAdForm(null); });

    // Refresh
    const refresh = document.getElementById('adsRefreshBtn');
    if (refresh) refresh.addEventListener('click', loadAds);

    // Filters
    ['adsSearch', 'adsFilterPlacement', 'adsFilterStatus'].forEach(function (id) {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener(id === 'adsSearch' ? 'input' : 'change', applyFilters);
    });

    // Actions
    document.addEventListener('click', function (e) {
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      const act = btn.dataset.act;
      const id = btn.dataset.id;
      if (!id) return;

      if (act === 'ad-edit') { e.preventDefault(); openAdForm(id); }
      else if (act === 'ad-toggle') { e.preventDefault(); toggleAdStatus(id); }
      // 'del' handled by admin-trash.js (soft delete)
    }, true);
  }

  /* ============================================================
     11. INIT
     ============================================================ */
  function init() {
    wireEvents();
    window.loadAds = loadAds;
    window.openAdForm = openAdForm;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();