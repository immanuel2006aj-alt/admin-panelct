/* ============================================================
   CENTRAL & STORES — PIXABAY PICKER
   ------------------------------------------------------------
   Search Pixabay for a commodity image (rice, basmati, cashew,
   beans, butter beans, etc.). Admin picks one, it downloads,
   enhances via ImageEnhancer, compresses, uploads to Supabase.

   LEGAL
     Pixabay images are CC0 (public domain dedication). Free for
     commercial use. No attribution required. Modifications
     permitted. Modifying an image does not remove its CC0
     status, so the enhanced version remains free to use.

   TWO MODES
     • manual  (default) — opens pixabay.com in a new tab.
                          Admin downloads, uploads via existing
                          upload zone.
     • api     — uses the Pixabay JSON API for in-editor search.
                 Requires a free API key from
                 https://pixabay.com/api/docs/

   PUBLIC API (window.PixabayPicker)
     search(query, options)  → Promise<Array>
     pickFromResults(query)  → Promise<{ url, meta } | null>
     setApiKey(key)          → void
     getMode()               → 'manual' | 'api'

   USED BY: admin-products.js, admin-image-pixabay wiring
   ============================================================ */

(function () {
  'use strict';

  const toast = (window.AdminCore && window.AdminCore.toast) || function () {};

  const PIXABAY_API_BASE = 'https://pixabay.com/api/';
  const RESULT_LIMIT = 12;
  const TIMEOUT_MS = 20000;

  /* ---------- state ---------- */
  let apiKey = null;

  /* ---------- read API key from localStorage ---------- */
  try {
    const stored = localStorage.getItem('cs_pixabay_key');
    if (stored) apiKey = stored;
  } catch (e) {}

  /* ============================================================
     API KEY
     ============================================================ */
  function setApiKey(key) {
    apiKey = key ? String(key).trim() : null;
    try {
      if (apiKey) localStorage.setItem('cs_pixabay_key', apiKey);
      else localStorage.removeItem('cs_pixabay_key');
    } catch (e) {}
  }

  function getMode() {
    return apiKey ? 'api' : 'manual';
  }

  /* ============================================================
     API SEARCH
     ============================================================ */
  async function search(query, options) {
    const opts = options || {};

    if (!apiKey) {
      // Return empty — caller should fall back to manual mode
      return [];
    }

    if (!query || !String(query).trim()) return [];

    const url = new URL(PIXABAY_API_BASE);
    url.searchParams.set('key', apiKey);
    url.searchParams.set('q', String(query).trim());
    url.searchParams.set('image_type', 'photo');
    url.searchParams.set('safesearch', 'true');
    url.searchParams.set('per_page', String(opts.limit || RESULT_LIMIT));
    url.searchParams.set('orientation', 'all');
    url.searchParams.set('category', opts.category || 'food');

    const controller = new AbortController();
    const timer = setTimeout(function () { controller.abort(); }, TIMEOUT_MS);

    let resp;
    try {
      resp = await fetch(url.toString(), { signal: controller.signal });
    } catch (err) {
      clearTimeout(timer);
      throw new Error(err.name === 'AbortError'
        ? 'Pixabay request timed out'
        : 'Network error: ' + err.message);
    }
    clearTimeout(timer);

    if (!resp.ok) {
      throw new Error('Pixabay HTTP ' + resp.status);
    }

    const data = await resp.json();
    const hits = (data && data.hits) || [];

    return hits.map(function (h) {
      return {
        id: h.id,
        preview: h.webformatURL || h.previewURL,
        full: h.largeImageURL || h.webformatURL || h.previewURL,
        width: h.imageWidth,
        height: h.imageHeight,
        tags: h.tags,
        user: h.user,
        pageURL: h.pageURL
      };
    });
  }

  /* ============================================================
     DOWNLOAD
     ============================================================ */
  async function downloadImage(url) {
    const controller = new AbortController();
    const timer = setTimeout(function () { controller.abort(); }, TIMEOUT_MS);

    let resp;
    try {
      resp = await fetch(url, { signal: controller.signal, mode: 'cors' });
    } catch (err) {
      clearTimeout(timer);
      throw new Error(err.name === 'AbortError'
        ? 'Download timed out'
        : 'Network error: ' + err.message);
    }
    clearTimeout(timer);

    if (!resp.ok) throw new Error('Download HTTP ' + resp.status);

    const blob = await resp.blob();
    if (!blob || !blob.size) throw new Error('Empty download');

    return blob;
  }

  /* ============================================================
     ENHANCE (optional — skip if ImageEnhancer not loaded)
     ============================================================ */
  async function enhanceImage(blob) {
    if (!window.ImageEnhancer || typeof window.ImageEnhancer.enhance !== 'function') {
      return blob;
    }
    try {
      return await window.ImageEnhancer.enhance(blob, { mode: 'catalogue' });
    } catch (e) {
      console.warn('[pixabay] enhance failed, using raw:', e.message);
      return blob;
    }
  }

  /* ============================================================
     UPLOAD (reuse MultiSizeUploader if available)
     ============================================================ */
  async function uploadBlob(blob) {
    if (!window.db) throw new Error('Supabase not ready');

    if (window.MultiSizeUploader && typeof window.MultiSizeUploader.uploadAll === 'function') {
      const r = await window.MultiSizeUploader.uploadAll(blob, 'product-images', 'products');
      if (r && r.url) return r;
      throw new Error('Multi-size upload returned no URL');
    }

    // Single-size fallback
    let compressed = blob;
    if (window.ImageCompressor && typeof window.ImageCompressor.compressToWebP === 'function') {
      try {
        compressed = await window.ImageCompressor.compressToWebP(blob, 'product');
      } catch (e) {}
    }

    const fname = 'products/pxb-' + Date.now() + '-' +
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

    return {
      url: data.publicUrl,
      srcset: data.publicUrl + ' 1200w',
      variants: { src1200: data.publicUrl }
    };
  }

  /* ============================================================
     PICK FLOW
     ------------------------------------------------------------
     Downloads the chosen image, enhances, uploads, returns URL.
     ============================================================ */
  async function pickFromResults(result) {
    if (!result || !result.full) throw new Error('No image selected');

    const rawBlob = await downloadImage(result.full);
    const enhanced = await enhanceImage(rawBlob);
    const uploaded = await uploadBlob(enhanced);

    return {
      url: uploaded.url,
      srcset: uploaded.srcset || '',
      variants: uploaded.variants || {},
      meta: {
        source: 'pixabay',
        id: result.id,
        tags: result.tags,
        user: result.user,
        pageURL: result.pageURL
      }
    };
  }

  /* ============================================================
     UI MODAL — pick from API results
     ------------------------------------------------------------
     Opened by admin-products.js when the admin clicks the
     Pixabay button and API key is set. Renders a grid of
     preview images. Admin taps one → callback fires.
     ============================================================ */
  function openPickerModal(query, onPick) {
    const existing = document.getElementById('pixabayPickerModal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'pixabayPickerModal';
    modal.className = 'modal-overlay open';
    modal.innerHTML =
      '<div class="modal modal-wide" role="dialog" aria-modal="true">' +
        '<h3>Pick a Pixabay image</h3>' +
        '<p>Search results for "' + escapeHtml(query) + '". Tap one to use it.</p>' +
        '<div id="pixabayResults" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:10px;max-height:60vh;overflow:auto;padding:6px"></div>' +
        '<div class="modal-actions" style="margin-top:16px">' +
          '<button class="btn btn-secondary" id="pixabayCloseBtn" type="button">Cancel</button>' +
        '</div>' +
      '</div>';

    document.body.appendChild(modal);

    function close() {
      modal.remove();
      document.body.style.overflow = '';
    }

    document.getElementById('pixabayCloseBtn').addEventListener('click', close);
    modal.addEventListener('click', function (e) { if (e.target === modal) close(); });

    const grid = document.getElementById('pixabayResults');
    grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:20px;color:#777">Searching…</div>';

    search(query).then(function (results) {
      if (!results.length) {
        grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:20px;color:#777">No results. Try a different keyword.</div>';
        return;
      }

      grid.innerHTML = '';
      results.forEach(function (r) {
        const card = document.createElement('button');
        card.type = 'button';
        card.style.cssText = 'border:1px solid #eee;border-radius:8px;overflow:hidden;background:#fff;cursor:pointer;padding:0;aspect-ratio:1;display:flex;align-items:center;justify-content:center';

        const img = document.createElement('img');
        img.src = r.preview;
        img.alt = r.tags || 'preview';
        img.loading = 'lazy';
        img.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block';
        card.appendChild(img);

        card.addEventListener('click', function () {
          close();
          onPick(r);
        });

        grid.appendChild(card);
      });
    }).catch(function (err) {
      grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:20px;color:#c0392b">' + escapeHtml(err.message) + '</div>';
    });
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /* ============================================================
     PUBLIC ENTRY POINT
     ------------------------------------------------------------
     Called by admin-products.js when the admin clicks
     "Find on Pixabay" in the editor.
     ============================================================ */
  async function pickFromPixabay(productName) {
    const query = String(productName || '').trim();
    if (!query) {
      toast('Enter a product name first', 'error');
      return null;
    }

    const mode = getMode();

    if (mode === 'manual') {
      // Open Pixabay search in a new tab and return null
      const url = 'https://pixabay.com/images/search/' +
        encodeURIComponent(query) + '/';
      window.open(url, '_blank', 'noopener');
      toast('Pixabay opened in a new tab. Download the image you want, then upload it in the editor.', 'success');
      return null;
    }

    // API mode — show the picker modal, await a pick
    return new Promise(function (resolve) {
      openPickerModal(query, function (result) {
        toast('Downloading and enhancing…');
        pickFromResults(result)
          .then(function (out) { resolve(out); })
          .catch(function (err) {
            toast('Failed: ' + err.message, 'error');
            resolve(null);
          });
      });
    });
  }

  /* ============================================================
     EXPORTS
     ============================================================ */
  window.PixabayPicker = {
    search: search,
    pickFromPixabay: pickFromPixabay,
    pickFromResults: pickFromResults,
    setApiKey: setApiKey,
    getMode: getMode
  };
})();
