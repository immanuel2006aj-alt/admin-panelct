/* ============================================================
   CENTRAL & STORES — AUTO IMAGE SCRAPER
   ------------------------------------------------------------
   The "Find Image Automatically" button pipeline.

   SCRAPER ORDER (first success wins):
     1. Amazon.in       — via public search endpoint
     2. Flipkart        — via public search endpoint
     3. BigBasket       — via public search endpoint
     4. JioMart         — via public search endpoint
     5. OpenFoodFacts   — free food database
     6. Wikipedia       — free encyclopedia
     7. DuckDuckGo      — image search via Instant Answer API
     8. AI (optional)   — Supabase Edge Function `generate-product-image`

   Each scraper:
     • Returns a direct image URL (string) or null
     • Uses only public endpoints (no API keys required)
     • Runs through a CORS proxy when the source blocks direct fetch

   After a URL is found:
     • Fetch as blob
     • Compress to WebP (~2–5 KB) via ImageCompressor
     • Upload to Supabase Storage `product-images`
     • Set the editor image

   DEPENDENCIES
     • admin-core.js (window.db, toast)
     • admin-image-compressor.js (window.ImageCompressor)

   PUBLIC API
     window.findProductImage(name, options) → Promise<{ url, source } | null>
   ============================================================ */

(function () {
  'use strict';

  const toast = window.AdminCore ? window.AdminCore.toast : function () {};
  const esc = window.AdminCore ? window.AdminCore.esc : function (s) { return String(s); };

  /* ============================================================
     CORS PROXIES
     ------------------------------------------------------------
     Public proxies used to bypass CORS when scraping HTML.
     The `.png` version below is highly reliable and free.
     ============================================================ */
  const PROXIES = [
    function (url) { return 'https://images.weserv.nl/?url=' + encodeURIComponent(url.replace(/^https?:\/\//, '')); },
    function (url) { return 'https://api.allorigins.win/raw?url=' + encodeURIComponent(url); },
    function (url) { return 'https://corsproxy.io/?' + encodeURIComponent(url); }
  ];

  async function fetchWithProxies(url, options) {
    // Try direct first
    try {
      const resp = await fetch(url, Object.assign({ mode: 'cors' }, options || {}));
      if (resp.ok) return resp;
    } catch (e) { /* fall through to proxies */ }

    // Try each proxy
    for (let i = 0; i < PROXIES.length; i++) {
      try {
        const proxied = PROXIES[i](url);
        const resp = await fetch(proxied, options || {});
        if (resp.ok) return resp;
      } catch (e) { /* next proxy */ }
    }

    return null;
  }

  async function fetchText(url) {
    const resp = await fetchWithProxies(url);
    if (!resp) return null;
    try { return await resp.text(); } catch (e) { return null; }
  }

  async function fetchJSON(url) {
    const resp = await fetchWithProxies(url, { headers: { 'Accept': 'application/json' } });
    if (!resp) return null;
    try { return await resp.json(); } catch (e) { return null; }
  }

  async function fetchBlob(url) {
    const resp = await fetchWithProxies(url);
    if (!resp) return null;
    try { return await resp.blob(); } catch (e) { return null; }
  }

  /* ============================================================
     1. AMAZON.IN
     ============================================================ */
  async function scrapeAmazon(query) {
    try {
      const searchUrl = 'https://www.amazon.in/s?k=' + encodeURIComponent(query);
      const html = await fetchText(searchUrl);
      if (!html) return null;

      // Amazon product images are usually hosted on m.media-amazon.com
      // and appear in `data-a-dynamic-image` or `src` attributes.
      const patterns = [
        /https:\/\/m\.media-amazon\.com\/images\/I\/[A-Za-z0-9]+\._AC_[A-Za-z0-9_,]+_\.jpg/g,
        /https:\/\/m\.media-amazon\.com\/images\/I\/[A-Za-z0-9]+\.jpg/g,
        /data-a-dynamic-image="([^"]+)"/,
        /"hiRes":"(https:\/\/[^"]+)"/,
        /"large":"(https:\/\/[^"]+)"/
      ];

      for (const pattern of patterns) {
        const matches = html.match(pattern);
        if (matches && matches.length) {
          let candidate = matches[0];
          // Handle the dynamic-image JSON case
          if (candidate.indexOf('{') === 0 || candidate.indexOf('"') === 0) {
            try {
              const cleaned = candidate.replace(/^[^"]*"/, '').replace(/"[^"]*$/, '');
              const urls = cleaned.match(/https:\/\/[^"]+\.jpg/g);
              if (urls && urls.length) candidate = urls[0];
            } catch (e) {}
          }
          if (candidate.startsWith('https://')) return candidate;
        }
      }
      return null;
    } catch (e) { return null; }
  }

  /* ============================================================
     2. FLIPKART
     ============================================================ */
  async function scrapeFlipkart(query) {
    try {
      const searchUrl = 'https://www.flipkart.com/search?q=' + encodeURIComponent(query);
      const html = await fetchText(searchUrl);
      if (!html) return null;

      // Flipkart images on rukminim*.flixcart.com
      const patterns = [
        /https:\/\/rukminim[0-9]*\.flixcart\.com\/image\/[0-9]+\/[0-9]+\/[a-z0-9]+\/[a-z0-9]+\/[a-z0-9\-]+\.jpeg\?[^"']+/g,
        /https:\/\/rukminim[0-9]*\.flixcart\.com\/image\/[0-9]+\/[0-9]+\/[a-z0-9]+\/[a-z0-9]+\/[a-z0-9\-]+\.jpeg/g,
        /"image":"(https:\/\/[^"]+flixcart[^"]+)"/,
        /"imageUrl":"(https:\/\/[^"]+flixcart[^"]+)"/
      ];

      for (const pattern of patterns) {
        const matches = html.match(pattern);
        if (matches && matches.length) {
          let candidate = matches[0];
          // Clean JSON-ish captured group
          if (candidate.indexOf('"') !== -1) {
            candidate = candidate.replace(/^[^"]*"/, '').replace(/"[^"]*$/, '');
          }
          if (candidate.startsWith('https://')) return candidate;
        }
      }
      return null;
    } catch (e) { return null; }
  }

  /* ============================================================
     3. BIGBASKET
     ============================================================ */
  async function scrapeBigBasket(query) {
    try {
      const searchUrl = 'https://www.bigbasket.com/ps/?q=' + encodeURIComponent(query);
      const html = await fetchText(searchUrl);
      if (!html) return null;

      // BigBasket images on www.bbassets.com or bigbasket.com
      const patterns = [
        /https:\/\/www\.bbassets\.com\/media\/catalog\/product\/[a-zA-Z0-9_\-\/]+\.jpg/g,
        /https:\/\/bigbasket\.com\/media\/catalog\/product\/[a-zA-Z0-9_\-\/]+\.jpg/g,
        /"image":"(https:\/\/[^"]+bbassets[^"]+)"/,
        /"image":"(https:\/\/[^"]+bigbasket[^"]+)"/
      ];

      for (const pattern of patterns) {
        const matches = html.match(pattern);
        if (matches && matches.length) {
          let candidate = matches[0];
          if (candidate.indexOf('"') !== -1) {
            candidate = candidate.replace(/^[^"]*"/, '').replace(/"[^"]*$/, '');
          }
          if (candidate.startsWith('https://')) return candidate;
        }
      }
      return null;
    } catch (e) { return null; }
  }

  /* ============================================================
     4. JIOMART
     ============================================================ */
  async function scrapeJioMart(query) {
    try {
      const searchUrl = 'https://www.jiomart.com/search/' + encodeURIComponent(query);
      const html = await fetchText(searchUrl);
      if (!html) return null;

      const patterns = [
        /https:\/\/www\.jiomart\.com\/images\/[a-zA-Z0-9_\-\/]+\.(jpg|jpeg|png|webp)/g,
        /https:\/\/cdn\.jiomart\.com\/[a-zA-Z0-9_\-\/]+\.(jpg|jpeg|png|webp)/g,
        /"image":"(https:\/\/[^"]+jiomart[^"]+)"/
      ];

      for (const pattern of patterns) {
        const matches = html.match(pattern);
        if (matches && matches.length) {
          let candidate = matches[0];
          if (candidate.indexOf('"') !== -1) {
            candidate = candidate.replace(/^[^"]*"/, '').replace(/"[^"]*$/, '');
          }
          if (candidate.startsWith('https://')) return candidate;
        }
      }
      return null;
    } catch (e) { return null; }
  }

  /* ============================================================
     5. OPENFOODFACTS
     ------------------------------------------------------------
     Free public food database. Excellent for packaged items.
     ============================================================ */
  async function scrapeOpenFoodFacts(query) {
    try {
      // Strip quantities from query
      const clean = query.replace(/[0-9]+\s*(g|kg|ml|l|pcs|pack|gm|gram)/gi, '').trim();
      const url = 'https://world.openfoodfacts.org/cgi/search.pl' +
        '?search_terms=' + encodeURIComponent(clean) +
        '&search_simple=1&action=process&json=1&page_size=5';

      const data = await fetchJSON(url);
      if (!data || !data.products) return null;

      for (const p of data.products) {
        const img =
          p.image_front_url ||
          p.image_url ||
          (p.selected_images && p.selected_images.front && p.selected_images.front.display && p.selected_images.front.display.en);
        if (img) return img;
      }
      return null;
    } catch (e) { return null; }
  }

  /* ============================================================
     6. WIKIPEDIA
     ------------------------------------------------------------
     Great for generic items: "Rice", "Wheat", "Turmeric".
     ============================================================ */
  async function scrapeWikipedia(query) {
    try {
      const clean = query.replace(/[0-9]+\s*(g|kg|ml|l|pcs|pack|gm|gram)/gi, '').trim();

      // Try the search endpoint
      const searchUrl = 'https://en.wikipedia.org/w/api.php' +
        '?action=query&format=json&origin=*' +
        '&generator=search&gsrsearch=' + encodeURIComponent(clean) +
        '&gsrlimit=1&prop=pageimages&pithumbsize=800';

      const data = await fetchJSON(searchUrl);
      if (data && data.query && data.query.pages) {
        for (const id in data.query.pages) {
          const p = data.query.pages[id];
          if (p.thumbnail && p.thumbnail.source) return p.thumbnail.source;
        }
      }

      // Fallback: try direct page lookup for common food items
      const directUrl = 'https://en.wikipedia.org/api/rest_v1/page/summary/' + encodeURIComponent(clean);
      const direct = await fetchJSON(directUrl);
      if (direct && direct.thumbnail && direct.thumbnail.source) return direct.thumbnail.source;

      return null;
    } catch (e) { return null; }
  }

  /* ============================================================
     7. DUCKDUCKGO IMAGES
     ------------------------------------------------------------
     Last resort. Uses the Instant Answer API for topic images.
     ============================================================ */
  async function scrapeDuckDuckGo(query) {
    try {
      const clean = query.replace(/[0-9]+\s*(g|kg|ml|l|pcs|pack|gm|gram)/gi, '').trim();
      const url = 'https://api.duckduckgo.com/?q=' +
        encodeURIComponent(clean + ' product') +
        '&format=json&no_html=1&skip_disambig=1';

      const data = await fetchJSON(url);
      if (!data) return null;

      if (data.Image) {
        return data.Image.startsWith('http') ? data.Image : 'https://duckduckgo.com' + data.Image;
      }

      if (data.RelatedTopics && data.RelatedTopics.length) {
        for (const t of data.RelatedTopics) {
          if (t.Icon && t.Icon.URL) {
            const iconUrl = t.Icon.URL.startsWith('http') ? t.Icon.URL : 'https://duckduckgo.com' + t.Icon.URL;
            return iconUrl;
          }
        }
      }

      return null;
    } catch (e) { return null; }
  }

  /* ============================================================
     8. AI GENERATION (Supabase Edge Function)
     ------------------------------------------------------------
     Optional. Requires an Edge Function called
     `generate-product-image` deployed on Supabase.
     If missing, silently returns null.
     ============================================================ */
  async function generateWithAI(query) {
    if (!window.db) return null;
    try {
      const { data, error } = await window.db.functions.invoke('generate-product-image', {
        body: { product: query, style: 'clean' }
      });
      if (error) return null;
      if (data && data.image_url) return data.image_url;
      return null;
    } catch (e) { return null; }
  }

  /* ============================================================
     MAIN PIPELINE
     ============================================================ */

  /**
   * Try every scraper in order and return the first valid image.
   * @param {string} query  Product name to search for
   * @param {object} options  { onProgress }
   * @returns {Promise<{ url: string, source: string } | null>}
   */
  async function findProductImage(query, options) {
    const opts = options || {};
    const onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : function () {};
    const cleanQuery = String(query || '').trim();

    if (!cleanQuery) return null;

    const scrapers = [
      { name: 'Amazon',        fn: scrapeAmazon,        label: 'Searching Amazon.in…' },
      { name: 'Flipkart',      fn: scrapeFlipkart,      label: 'Searching Flipkart…' },
      { name: 'BigBasket',     fn: scrapeBigBasket,     label: 'Searching BigBasket…' },
      { name: 'JioMart',       fn: scrapeJioMart,       label: 'Searching JioMart…' },
      { name: 'OpenFoodFacts', fn: scrapeOpenFoodFacts, label: 'Checking OpenFoodFacts…' },
      { name: 'Wikipedia',     fn: scrapeWikipedia,     label: 'Checking Wikipedia…' },
      { name: 'DuckDuckGo',    fn: scrapeDuckDuckGo,    label: 'Searching DuckDuckGo…' }
    ];

    for (const s of scrapers) {
      onProgress(s.label);
      try {
        const url = await s.fn(cleanQuery);
        if (url && typeof url === 'string' && url.startsWith('http')) {
          onProgress('Found on ' + s.name + ' — validating…');
          // Validate the URL actually returns an image
          const blob = await fetchBlob(url);
          if (blob && blob.size > 500 && blob.type && blob.type.startsWith('image/')) {
            return { url: url, source: s.name, blob: blob };
          }
        }
      } catch (e) {
        // Continue to next scraper
      }
    }

    // All scrapers failed. Try AI.
    onProgress('No image found. Trying AI generation…');
    try {
      const aiUrl = await generateWithAI(cleanQuery);
      if (aiUrl) {
        const blob = await fetchBlob(aiUrl);
        if (blob) return { url: aiUrl, source: 'AI', blob: blob };
      }
    } catch (e) {}

    return null;
  }

  /* ============================================================
     UPLOAD FOUND IMAGE TO SUPABASE
     ============================================================ */
  async function uploadFoundImage(blob, query) {
    if (!window.db) throw new Error('Supabase not available');

    // Use multisize uploader if available, else fall back to single
    if (window.MultiSizeUploader && typeof window.MultiSizeUploader.uploadAll === 'function') {
      const result = await window.MultiSizeUploader.uploadAll(blob, 'product-images', 'products');
      return result.url;
    }

    // Fallback: single compressed upload
    if (!window.ImageCompressor) {
      throw new Error('ImageCompressor not available');
    }

    const compressed = await window.ImageCompressor.compressToWebP(blob, 'product');
    const fname = 'products/' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.webp';

    const { error } = await window.db.storage
      .from('product-images')
      .upload(fname, compressed, {
        cacheControl: '31536000',
        contentType: 'image/webp',
        upsert: false
      });

    if (error) throw error;

    const { data } = window.db.storage.from('product-images').getPublicUrl(fname);
    return data.publicUrl;
  }

  /* ============================================================
     "FIND IMAGE" BUTTON HANDLER
     ------------------------------------------------------------
     Wired to #findImageBtn in the Product Editor.
     Reads product name from #pName, runs the pipeline, sets the
     editor image, uploads to Supabase Storage.
     ============================================================ */
  async function handleFindImageClick() {
    const btn = document.getElementById('findImageBtn');
    if (btn && btn.disabled) return;

    const nameField = document.getElementById('pName');
    const query = nameField ? nameField.value.trim() : '';

    if (!query) {
      toast('Enter a product name first', 'error');
      if (nameField) nameField.focus();
      return;
    }

    const originalHtml = btn ? btn.innerHTML : '';
    if (btn) { btn.disabled = true; btn.innerHTML = '🔍 Searching…'; }

    const updateProgress = function (msg) {
      if (btn) btn.innerHTML = '🔍 ' + msg;
    };

    try {
      const result = await findProductImage(query, { onProgress: updateProgress });

      if (!result) {
        toast('No image found. Try uploading manually or use AI.', 'warning');
        return;
      }

      updateProgress('Compressing…');

      // Upload the blob (compressed)
      let publicUrl;
      try {
        publicUrl = await uploadFoundImage(result.blob, query);
      } catch (uploadErr) {
        toast('Upload failed: ' + (uploadErr.message || 'Unknown'), 'error');
        return;
      }

      // Update editor state
      if (typeof window.__setEditorImage === 'function') {
        window.__setEditorImage(publicUrl);
      } else {
        // Fallback: write directly to known editor state
        if (window.__productsState) window.__productsState.editorImageUrl = publicUrl;
        const preview = document.getElementById('uploadPreviewImg');
        const prevWrap = document.getElementById('uploadPreview');
        const zone = document.getElementById('uploadZone');
        if (preview) preview.src = publicUrl;
        if (prevWrap) prevWrap.classList.remove('hidden');
        if (zone) zone.classList.add('hidden');
      }

      toast('Image found via ' + result.source + ' and set', 'success');
    } catch (err) {
      console.warn('[scraper] failed:', err);
      toast('Image search failed: ' + (err.message || 'Unknown'), 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.innerHTML = originalHtml; }
    }
  }

  /* ============================================================
     WIRE UP THE BUTTON
     ============================================================ */
  function wireFindImageButton() {
    const btn = document.getElementById('findImageBtn');
    if (!btn) return;
    if (btn.dataset.scraperWired === '1') return;
    btn.dataset.scraperWired = '1';

    btn.addEventListener('click', handleFindImageClick);
  }

  // Wire on load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wireFindImageButton, { once: true });
  } else {
    wireFindImageButton();
  }

  // Also re-wire whenever the editor section is shown (in case button
  // is rebuilt by another script — defensive).
  const observer = new MutationObserver(function () {
    wireFindImageButton();
  });
  if (document.body) {
    observer.observe(document.body, { childList: true, subtree: true });
  }

  /* ============================================================
     PUBLIC API
     ============================================================ */
  window.findProductImage = findProductImage;
  window.ImageScraper = {
    findProductImage: findProductImage,
    uploadFoundImage: uploadFoundImage,
    scrapers: {
      amazon: scrapeAmazon,
      flipkart: scrapeFlipkart,
      bigbasket: scrapeBigBasket,
      jiomart: scrapeJioMart,
      openfoodfacts: scrapeOpenFoodFacts,
      wikipedia: scrapeWikipedia,
      duckduckgo: scrapeDuckDuckGo
    }
  };
})();