/* ============================================================
   CENTRAL & STORES — IMAGE SCRAPER v2.0
   ------------------------------------------------------------
   Fix: Only accepts an image if the product title on the
        source page actually MATCHES the search query.
        Prevents wrong images (ads, bundles, sponsored items).

   PRIMARY SOURCE: BigBasket (cleanest, Indian grocery focused)
   FALLBACKS:      Amazon.in → JioMart → Flipkart
                   → OpenFoodFacts → Wikipedia → DuckDuckGo

   MATCHING LOGIC
     Normalizes both query and candidate title, then requires
     a token overlap of >= 60%. Rejects mismatch.

   PUBLIC API
     window.findProductImage(query) → { url, source, matchedTitle }
   ============================================================ */

(function () {
  'use strict';

  const toast = window.AdminCore ? window.AdminCore.toast : function () {};

  /* ============================================================
     CORS PROXIES (rotate on failure)
     ============================================================ */
  const PROXIES = [
    function (url) { return 'https://api.allorigins.win/raw?url=' + encodeURIComponent(url); },
    function (url) { return 'https://corsproxy.io/?' + encodeURIComponent(url); },
    function (url) { return 'https://images.weserv.nl/?url=' + encodeURIComponent(url.replace(/^https?:\/\//, '')) + '&output=json'; }
  ];

  async function fetchWithProxies(url, options) {
    // Direct attempt
    try {
      const r = await fetch(url, Object.assign({ mode: 'cors' }, options || {}));
      if (r.ok) return r;
    } catch (e) {}

    // Proxy attempts
    for (let i = 0; i < PROXIES.length; i++) {
      try {
        const p = PROXIES[i](url);
        const r = await fetch(p, options || {});
        if (r.ok) return r;
      } catch (e) {}
    }
    return null;
  }

  async function fetchText(url) {
    const r = await fetchWithProxies(url);
    if (!r) return null;
    try { return await r.text(); } catch (e) { return null; }
  }

  async function fetchJSON(url) {
    const r = await fetchWithProxies(url, { headers: { 'Accept': 'application/json' } });
    if (!r) return null;
    try { return await r.json(); } catch (e) { return null; }
  }

  async function fetchBlob(url) {
    // Try direct first for images (many CDNs allow CORS)
    try {
      const r = await fetch(url, { mode: 'cors' });
      if (r.ok) return await r.blob();
    } catch (e) {}

    // Proxy fallback
    try {
      const proxied = 'https://images.weserv.nl/?url=' + encodeURIComponent(url.replace(/^https?:\/\//, ''));
      const r = await fetch(proxied);
      if (r.ok) return await r.blob();
    } catch (e) {}

    return null;
  }

  /* ============================================================
     MATCHING HELPERS
     ------------------------------------------------------------
     Normalize text → lowercase, strip punctuation, remove common
     unit words (g, kg, ml, pack, etc.). Then compute token overlap.
     ============================================================ */

  const STOP_WORDS = new Set([
    'the', 'a', 'an', 'and', 'or', 'for', 'with', 'of', 'in', 'on',
    'g', 'kg', 'ml', 'l', 'gm', 'gram', 'grams', 'pcs', 'pc', 'piece',
    'pieces', 'pack', 'packs', 'packet', 'packets', 'combo', 'set',
    'new', 'fresh', 'premium', 'best', 'buy', 'online', 'free', 'ship'
  ]);

  function normalize(str) {
    return String(str || '')
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function tokens(str) {
    return normalize(str)
      .split(' ')
      .filter(function (t) { return t && t.length > 1 && !STOP_WORDS.has(t); });
  }

  function matchScore(query, candidate) {
    const qTokens = tokens(query);
    const cTokens = tokens(candidate);
    if (!qTokens.length || !cTokens.length) return 0;

    // Count matches
    let hits = 0;
    const cSet = new Set(cTokens);
    for (const t of qTokens) {
      if (cSet.has(t)) { hits++; continue; }
      // Partial match: token contains or is contained by another
      for (const c of cSet) {
        if (c.indexOf(t) !== -1 || t.indexOf(c) !== -1) { hits++; break; }
      }
    }
    return hits / qTokens.length;
  }

  const MATCH_THRESHOLD = 0.6; // 60% token overlap required

  /* ============================================================
     1. BIGBASKET (primary — best for Indian groceries)
     ============================================================ */
  async function scrapeBigBasket(query) {
    try {
      const searchUrl = 'https://www.bigbasket.com/ps/?q=' + encodeURIComponent(query);
      const html = await fetchText(searchUrl);
      if (!html) return null;

      // Look for embedded JSON: BigBasket uses `__NEXT_DATA__`
      const nextDataMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
      if (nextDataMatch) {
        try {
          const data = JSON.parse(nextDataMatch[1]);
          const products = findProductsInJSON(data);
          for (const p of products) {
            const title = p.desc || p.name || p.title || '';
            const img = p.image || p.image_url || p.big_image_url || (p.images && p.images[0] && p.images[0].url);
            if (title && img && matchScore(query, title) >= MATCH_THRESHOLD) {
              return { url: img, matchedTitle: title, source: 'BigBasket' };
            }
          }
        } catch (e) {}
      }

      // Fallback: HTML patterns (image + nearby title)
      const productPatterns = [
        /<div[^>]*class="[^"]*product[^"]*"[^>]*>[\s\S]*?<img[^>]*src="([^"]+)"[^>]*>[\s\S]*?<div[^>]*class="[^"]*name[^"]*"[^>]*>([^<]+)<\/div>/gi,
        /<img[^>]*src="(https:\/\/www\.bbassets\.com\/media\/catalog\/product\/[^"]+\.(jpg|jpeg|png|webp))"[^>]*>[\s\S]{0,500}?<span[^>]*>([^<]+)<\/span>/gi
      ];

      for (const pattern of productPatterns) {
        const re = new RegExp(pattern.source, 'gi');
        let m;
        while ((m = re.exec(html)) !== null) {
          const img = m[1];
          const title = m[2] || m[3] || '';
          if (title && matchScore(query, title) >= MATCH_THRESHOLD) {
            return { url: img, matchedTitle: title, source: 'BigBasket' };
          }
        }
      }

      return null;
    } catch (e) { return null; }
  }

  /* ============================================================
     2. AMAZON.IN
     ============================================================ */
  async function scrapeAmazon(query) {
    try {
      const searchUrl = 'https://www.amazon.in/s?k=' + encodeURIComponent(query);
      const html = await fetchText(searchUrl);
      if (!html) return null;

      // Find all product blocks; each has a title and an image.
      // Amazon uses `data-asin` on the container with title in an `<h2>`.
      const blocks = html.split(/data-asin="[A-Z0-9]+"/);
      for (const block of blocks) {
        // Extract title
        const titleMatch = block.match(/<h2[^>]*>[\s\S]*?<span[^>]*>([^<]+)<\/span>/);
        if (!titleMatch) continue;
        const title = titleMatch[1].replace(/&amp;/g, '&').trim();

        // Extract first product image
        const imgMatch = block.match(/src="(https:\/\/m\.media-amazon\.com\/images\/I\/[^"]+\.jpg)"/);
        if (!imgMatch) continue;
        const img = imgMatch[1];

        if (matchScore(query, title) >= MATCH_THRESHOLD) {
          // Upgrade image size: replace `._AC_ULxxx_` with a large variant
          const bigImg = img.replace(/\._[A-Z0-9_,]+_\./, '._AC_SL1200_.');
          return { url: bigImg, matchedTitle: title, source: 'Amazon' };
        }
      }
      return null;
    } catch (e) { return null; }
  }

  /* ============================================================
     3. JIOMART
     ============================================================ */
  async function scrapeJioMart(query) {
    try {
      const searchUrl = 'https://www.jiomart.com/search/' + encodeURIComponent(query);
      const html = await fetchText(searchUrl);
      if (!html) return null;

      // Look for product tiles: img + title pairs
      const re = /<img[^>]*src="(https:\/\/www\.jiomart\.com\/images\/[^"]+)"[^>]*>[\s\S]{0,600}?<[^>]+class="[^"]*plp-prod-title[^"]*"[^>]*>([^<]+)</gi;
      let m;
      while ((m = re.exec(html)) !== null) {
        const img = m[1];
        const title = m[2].trim();
        if (matchScore(query, title) >= MATCH_THRESHOLD) {
          return { url: img, matchedTitle: title, source: 'JioMart' };
        }
      }

      // Fallback: JSON in script
      const scriptMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
      if (scriptMatch) {
        try {
          const data = JSON.parse(scriptMatch[1]);
          const products = findProductsInJSON(data);
          for (const p of products) {
            const title = p.name || p.title || p.desc || '';
            const img = p.image_url || p.image || p.big_image_url;
            if (title && img && matchScore(query, title) >= MATCH_THRESHOLD) {
              return { url: img, matchedTitle: title, source: 'JioMart' };
            }
          }
        } catch (e) {}
      }

      return null;
    } catch (e) { return null; }
  }

  /* ============================================================
     4. FLIPKART
     ============================================================ */
  async function scrapeFlipkart(query) {
    try {
      const searchUrl = 'https://www.flipkart.com/search?q=' + encodeURIComponent(query);
      const html = await fetchText(searchUrl);
      if (!html) return null;

      // Flipkart has products with title and image nearby
      const re = /<img[^>]*src="(https:\/\/rukminim[0-9]*\.flixcart\.com\/image\/[^"]+\.(jpeg|jpg|png|webp))"[^>]*>[\s\S]{0,800}?<div[^>]*class="[^"]*KzDlHZ[^"]*"[^>]*>([^<]+)</gi;
      let m;
      while ((m = re.exec(html)) !== null) {
        const img = m[1];
        const title = m[3].trim();
        if (matchScore(query, title) >= MATCH_THRESHOLD) {
          return { url: img, matchedTitle: title, source: 'Flipkart' };
        }
      }

      // Fallback: link pairs where image alt matches
      const re2 = /<img[^>]*alt="([^"]+)"[^>]*src="(https:\/\/rukminim[0-9]*\.flixcart\.com\/image\/[^"]+)"/gi;
      let m2;
      while ((m2 = re2.exec(html)) !== null) {
        const title = m2[1].trim();
        const img = m2[2];
        if (title && matchScore(query, title) >= MATCH_THRESHOLD) {
          return { url: img, matchedTitle: title, source: 'Flipkart' };
        }
      }

      return null;
    } catch (e) { return null; }
  }

  /* ============================================================
     5. OPENFOODFACTS (branded food)
     ============================================================ */
  async function scrapeOpenFoodFacts(query) {
    try {
      const clean = query.replace(/[0-9]+\s*(g|kg|ml|l|pcs|pack|gm|gram)/gi, '').trim();
      const url = 'https://world.openfoodfacts.org/cgi/search.pl' +
        '?search_terms=' + encodeURIComponent(clean) +
        '&search_simple=1&action=process&json=1&page_size=10';

      const data = await fetchJSON(url);
      if (!data || !data.products) return null;

      // OpenFoodFacts already does fuzzy matching, but we verify
      for (const p of data.products) {
        const title = p.product_name || p.generic_name || '';
        const img = p.image_front_url || p.image_url;
        if (title && img && matchScore(query, title) >= MATCH_THRESHOLD) {
          return { url: img, matchedTitle: title, source: 'OpenFoodFacts' };
        }
      }

      // If nothing matched strictly but we have results, take the best
      let best = null;
      let bestScore = 0;
      for (const p of data.products) {
        const title = p.product_name || '';
        const img = p.image_front_url || p.image_url;
        if (!title || !img) continue;
        const score = matchScore(query, title);
        if (score > bestScore) { bestScore = score; best = { url: img, matchedTitle: title, source: 'OpenFoodFacts' }; }
      }
      if (bestScore >= 0.4) return best; // looser for OpenFoodFacts

      return null;
    } catch (e) { return null; }
  }

  /* ============================================================
     6. WIKIPEDIA (generic items)
     ============================================================ */
  async function scrapeWikipedia(query) {
    try {
      const clean = query.replace(/[0-9]+\s*(g|kg|ml|l|pcs|pack|gm|gram)/gi, '').trim();

      // Try the summary API directly on the query
      const directUrl = 'https://en.wikipedia.org/api/rest_v1/page/summary/' + encodeURIComponent(clean);
      const direct = await fetchJSON(directUrl);
      if (direct && direct.thumbnail && direct.thumbnail.source) {
        const title = direct.title || clean;
        if (matchScore(query, title) >= 0.5) {
          return { url: direct.thumbnail.source, matchedTitle: title, source: 'Wikipedia' };
        }
      }

      // Fallback: search
      const searchUrl = 'https://en.wikipedia.org/w/api.php' +
        '?action=query&format=json&origin=*' +
        '&generator=search&gsrsearch=' + encodeURIComponent(clean) +
        '&gsrlimit=3&prop=pageimages&pithumbsize=800';
      const data = await fetchJSON(searchUrl);
      if (data && data.query && data.query.pages) {
        for (const id in data.query.pages) {
          const p = data.query.pages[id];
          if (p.thumbnail && p.thumbnail.source && matchScore(query, p.title || '') >= 0.5) {
            return { url: p.thumbnail.source, matchedTitle: p.title || '', source: 'Wikipedia' };
          }
        }
      }
      return null;
    } catch (e) { return null; }
  }

  /* ============================================================
     7. DUCKDUCKGO
     ============================================================ */
  async function scrapeDuckDuckGo(query) {
    try {
      const clean = query.replace(/[0-9]+\s*(g|kg|ml|l|pcs|pack|gm|gram)/gi, '').trim();
      const url = 'https://api.duckduckgo.com/?q=' +
        encodeURIComponent(clean + ' product') +
        '&format=json&no_html=1&skip_disambig=1';
      const data = await fetchJSON(url);
      if (!data) return null;

      if (data.Image && data.Heading) {
        if (matchScore(query, data.Heading) >= MATCH_THRESHOLD) {
          const img = data.Image.startsWith('http') ? data.Image : 'https://duckduckgo.com' + data.Image;
          return { url: img, matchedTitle: data.Heading, source: 'DuckDuckGo' };
        }
      }

      if (data.RelatedTopics) {
        for (const t of data.RelatedTopics) {
          if (t.Icon && t.Icon.URL && t.Text) {
            const title = t.Text.split(' - ')[0] || '';
            if (matchScore(query, title) >= MATCH_THRESHOLD) {
              const img = t.Icon.URL.startsWith('http') ? t.Icon.URL : 'https://duckduckgo.com' + t.Icon.URL;
              return { url: img, matchedTitle: title, source: 'DuckDuckGo' };
            }
          }
        }
      }
      return null;
    } catch (e) { return null; }
  }

  /* ============================================================
     HELPER: find product-like objects in any JSON tree
     ============================================================ */
  function findProductsInJSON(obj, results) {
    results = results || [];
    if (!obj || typeof obj !== 'object') return results;

    if (Array.isArray(obj)) {
      for (const item of obj) findProductsInJSON(item, results);
      return results;
    }

    // Heuristic: object has name/title AND image fields
    if ((obj.name || obj.title || obj.desc) && (obj.image || obj.image_url || obj.images)) {
      results.push(obj);
    }

    for (const k in obj) {
      if (obj[k] && typeof obj[k] === 'object') {
        findProductsInJSON(obj[k], results);
      }
    }
    return results;
  }

  /* ============================================================
     MAIN PIPELINE
     ------------------------------------------------------------
     Order: BigBasket → Amazon → JioMart → Flipkart
            → OpenFoodFacts → Wikipedia → DuckDuckGo
     Each scraper MUST return a matchedTitle that passes the score.
     ============================================================ */
  async function findProductImage(query, options) {
    const opts = options || {};
    const onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : function () {};

    if (!query || !query.trim()) return null;
    const q = query.trim();

    const scrapers = [
      { fn: scrapeBigBasket,    label: 'Searching BigBasket…' },
      { fn: scrapeAmazon,       label: 'Searching Amazon.in…' },
      { fn: scrapeJioMart,      label: 'Searching JioMart…' },
      { fn: scrapeFlipkart,     label: 'Searching Flipkart…' },
      { fn: scrapeOpenFoodFacts, label: 'Checking OpenFoodFacts…' },
      { fn: scrapeWikipedia,    label: 'Checking Wikipedia…' },
      { fn: scrapeDuckDuckGo,   label: 'Searching DuckDuckGo…' }
    ];

    for (const s of scrapers) {
      onProgress(s.label);
      try {
        const result = await s.fn(q);
        if (result && result.url) {
          onProgress('Validating image…');
          const blob = await fetchBlob(result.url);
          if (blob && blob.size > 500 && blob.type && blob.type.indexOf('image/') === 0) {
            return { url: result.url, source: result.source, matchedTitle: result.matchedTitle, blob: blob };
          }
        }
      } catch (e) {
        // continue
      }
    }

    return null;
  }

  /* ============================================================
     UPLOAD FOUND IMAGE
     ============================================================ */
  async function uploadFoundImage(blob, query) {
    if (!window.db) throw new Error('Supabase not available');

    if (window.MultiSizeUploader && typeof window.MultiSizeUploader.uploadAll === 'function') {
      const r = await window.MultiSizeUploader.uploadAll(blob, 'product-images', 'products');
      return r.url;
    }

    if (!window.ImageCompressor) throw new Error('ImageCompressor not loaded');

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
     BUTTON HANDLER
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
    if (btn) { btn.disabled = true; btn.innerHTML = '🔍 Starting…'; }

    const updateProgress = function (msg) {
      if (btn) btn.innerHTML = '🔍 ' + msg;
    };

    try {
      const result = await findProductImage(query, { onProgress: updateProgress });

      if (!result) {
        toast('No matching image found. Try a more specific name or upload manually.', 'warning');
        return;
      }

      updateProgress('Compressing…');

      const publicUrl = await uploadFoundImage(result.blob, query);

      // Update editor state
      if (window.__productsState) window.__productsState.editorImageUrl = publicUrl;
      const preview = document.getElementById('uploadPreviewImg');
      const prevWrap = document.getElementById('uploadPreview');
      const zone = document.getElementById('uploadZone');
      if (preview) preview.src = publicUrl;
      if (prevWrap) prevWrap.classList.remove('hidden');
      if (zone) zone.classList.add('hidden');

      toast('Image found via ' + result.source + ': "' + result.matchedTitle + '"', 'success');
    } catch (err) {
      console.warn('[scraper] failed:', err);
      toast('Image search failed: ' + (err.message || 'Unknown'), 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.innerHTML = originalHtml; }
    }
  }

  /* ============================================================
     WIRE UP
     ============================================================ */
  function wireFindImageButton() {
    const btn = document.getElementById('findImageBtn');
    if (!btn) return;
    if (btn.dataset.scraperWired === '1') return;
    btn.dataset.scraperWired = '1';
    btn.addEventListener('click', handleFindImageClick);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wireFindImageButton, { once: true });
  } else {
    wireFindImageButton();
  }

  const observer = new MutationObserver(wireFindImageButton);
  if (document.body) observer.observe(document.body, { childList: true, subtree: true });

  /* ============================================================
     EXPORTS
     ============================================================ */
  window.findProductImage = findProductImage;
  window.ImageScraper = {
    findProductImage: findProductImage,
    uploadFoundImage: uploadFoundImage,
    matchScore: matchScore,
    scrapers: {
      bigbasket: scrapeBigBasket,
      amazon: scrapeAmazon,
      jiomart: scrapeJioMart,
      flipkart: scrapeFlipkart,
      openfoodfacts: scrapeOpenFoodFacts,
      wikipedia: scrapeWikipedia,
      duckduckgo: scrapeDuckDuckGo
    }
  };
})();