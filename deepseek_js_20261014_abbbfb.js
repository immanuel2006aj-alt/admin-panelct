/* ============================================================
   CENTRAL & STORES — IMAGE SCRAPER v6 (Server-Backed)
   ------------------------------------------------------------
   Calls the `scrape-product-image` Supabase Edge Function
   which scrapes Flipkart → JioMart → Amazon.in server-side.
   No CORS. Title matching enforced. Exact product images.

   FLOW
     Browser → Edge Function (server) → Flipkart/JioMart/Amazon
     → returns matched image URL + base64 bytes
     → browser → compress to WebP (multi-size) → Supabase Storage
     → editor image set

   FALLBACK: if scrape fails → calls admin-ai-image.js

   PUBLIC API
     window.ImageScraper.findProductImage(query) → Promise<data>
     window.ImageScraper.uploadBlob(blob)        → Promise<url>
     window.ImageScraper.setEditorImage(url)
   ============================================================ */

(function () {
  'use strict';

  const toast = window.AdminCore ? window.AdminCore.toast : function () {};
  const SUPABASE_URL = 'https://xcdzozyhvkonvesqvxbp.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhjZHpvenlodmtvbnZlc3F2eGJwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk5MDIwMTYsImV4cCI6MjEwNTQ3ODAxNn0.mX0u55mSR14FGr8Lt6ofENfaOqH6JcGp4ACjKnC3gKA';

  const SCRAPE_TIMEOUT_MS = 20000;
  const AI_TIMEOUT_MS = 30000;

  /* ============================================================
     EDGE FUNCTION CALLS
     ============================================================ */
  async function fetchWithTimeout(url, options, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(function () { controller.abort(); }, timeoutMs);
    try {
      const resp = await fetch(url, Object.assign({ signal: controller.signal }, options || {}));
      return resp;
    } finally {
      clearTimeout(timer);
    }
  }

  async function scrapeFromServer(query) {
    const url = SUPABASE_URL + '/functions/v1/scrape-product-image';

    let resp;
    try {
      resp = await fetchWithTimeout(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + SUPABASE_ANON_KEY,
          'apikey': SUPABASE_ANON_KEY
        },
        body: JSON.stringify({ query: query, include_image: true })
      }, SCRAPE_TIMEOUT_MS);
    } catch (err) {
      if (err && err.name === 'AbortError') {
        throw new Error('Scraper timed out after 20 seconds');
      }
      throw new Error('Network error while scraping');
    }

    if (!resp.ok) {
      throw new Error('Server HTTP ' + resp.status);
    }

    const data = await resp.json();
    if (!data.success) {
      throw new Error(data.error || 'Scrape failed');
    }

    return data;
  }

  /* ============================================================
     HELPERS
     ============================================================ */
  function b64ToBlob(b64, mime) {
    let chars;
    try {
      chars = atob(b64);
    } catch (e) {
      throw new Error('Invalid image data received');
    }
    const bytes = new Uint8Array(chars.length);
    for (let i = 0; i < chars.length; i++) bytes[i] = chars.charCodeAt(i);
    return new Blob([bytes], { type: mime || 'image/jpeg' });
  }

  async function downloadBlob(url) {
    const r = await fetch(url, { mode: 'cors' });
    if (!r.ok) throw new Error('Download HTTP ' + r.status);
    return await r.blob();
  }

  /* ============================================================
     UPLOAD (multi-size if available, else single)
     ============================================================ */
  async function uploadBlob(blob) {
    if (!window.db) throw new Error('Supabase not available');
    if (!blob || !blob.size) throw new Error('Empty image blob');

    // Prefer multi-size uploader
    if (window.MultiSizeUploader && typeof window.MultiSizeUploader.uploadAll === 'function') {
      const r = await window.MultiSizeUploader.uploadAll(blob, 'product-images', 'products');
      if (!r || !r.url) throw new Error('Multi-size upload returned no URL');
      return r.url;
    }

    // Single compressed upload fallback
    let compressed = blob;
    if (window.ImageCompressor) {
      try {
        compressed = await window.ImageCompressor.compressToWebP(blob, 'product');
      } catch (e) {
        console.warn('[scraper] compression failed, uploading original:', e.message);
        compressed = blob;
      }
    }

    const fname = 'products/scraped-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.webp';

    const { error } = await window.db.storage
      .from('product-images')
      .upload(fname, compressed, {
        cacheControl: '31536000',
        contentType: compressed.type || 'image/webp',
        upsert: false
      });

    if (error) throw error;

    const { data } = window.db.storage.from('product-images').getPublicUrl(fname);
    if (!data || !data.publicUrl) throw new Error('Unable to generate public URL');
    return data.publicUrl;
  }

  /* ============================================================
     SET EDITOR IMAGE
     ============================================================ */
  function setEditorImage(url) {
    if (!url) return;

    // Persist to editor state
    if (window.__productsState) {
      window.__productsState.editorImageUrl = url;
    }

    // Update preview UI
    const preview = document.getElementById('uploadPreviewImg');
    const prevWrap = document.getElementById('uploadPreview');
    const zone = document.getElementById('uploadZone');

    if (preview) preview.src = url;
    if (prevWrap) prevWrap.classList.remove('hidden');
    if (zone) zone.classList.add('hidden');
  }

  /* ============================================================
     AI FALLBACK
     ============================================================ */
  async function tryAIFallback(query) {
    if (typeof window.generateProductImage !== 'function') return null;

    try {
      // Race against a timeout so we don't hang forever
      const aiPromise = window.generateProductImage(query, { quality: 'medium' });
      const timeout = new Promise(function (_, reject) {
        setTimeout(function () { reject(new Error('AI generation timed out')); }, AI_TIMEOUT_MS);
      });
      const ai = await Promise.race([aiPromise, timeout]);
      return ai && ai.url ? ai.url : null;
    } catch (err) {
      console.warn('[scraper] AI fallback failed:', err.message);
      return null;
    }
  }

  /* ============================================================
     MAIN BUTTON HANDLER
     ============================================================ */
  async function handleFindImageClick() {
    const btn = document.getElementById('findImageBtn');
    if (!btn || btn.disabled) return;

    const nameField = document.getElementById('pName');
    const query = nameField ? nameField.value.trim() : '';

    if (!query) {
      toast('Enter a product name first', 'error');
      if (nameField) nameField.focus();
      return;
    }

    const originalHtml = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = 'Searching Flipkart…';

    try {
      // 1. Call server scraper
      const result = await scrapeFromServer(query);

      if (!result.imageB64 && !result.imageUrl) {
        throw new Error('No image returned');
      }

      btn.innerHTML = 'Downloading…';
      const blob = result.imageB64
        ? b64ToBlob(result.imageB64, result.mime)
        : await downloadBlob(result.imageUrl);

      if (!blob || !blob.size) throw new Error('Downloaded image is empty');

      btn.innerHTML = 'Compressing & uploading…';
      const publicUrl = await uploadBlob(blob);

      setEditorImage(publicUrl);

      toast(
        'Found on ' + result.source + ': "' + (result.matchedTitle || query) + '"',
        'success'
      );
      return;
    } catch (err) {
      console.warn('[scraper] failed:', err);

      // 2. AI fallback
      btn.innerHTML = 'Trying AI fallback…';
      const aiUrl = await tryAIFallback(query);
      if (aiUrl) {
        setEditorImage(aiUrl);
        toast('AI mockup generated (scraper found no exact match)', 'success');
        return;
      }

      // 3. Final failure
      toast('Scrape failed: ' + (err.message || 'Unknown') + ' — try manual upload', 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = originalHtml;
    }
  }

  /* ============================================================
     WIRE UP (single MutationObserver, debounced, self-cleaning)
     ============================================================ */
  let observer = null;
  let debounceTimer = null;

  function wire() {
    const btn = document.getElementById('findImageBtn');
    if (!btn) return;
    if (btn.dataset.scraperWired === '1') return;
    btn.dataset.scraperWired = '1';
    btn.addEventListener('click', handleFindImageClick);
  }

  function tryWire() {
    wire();
    // If the button is now wired, disconnect the observer — no more need
    const btn = document.getElementById('findImageBtn');
    if (btn && btn.dataset.scraperWired === '1' && observer) {
      try { observer.disconnect(); } catch (e) {}
      observer = null;
    }
  }

  function setupObserver() {
    if (typeof MutationObserver !== 'function') return;
    if (!document.body) return;
    observer = new MutationObserver(function () {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(tryWire, 300);
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      wire();
      setupObserver();
      // Safety: after 30s, stop watching regardless
      setTimeout(function () {
        if (observer) {
          try { observer.disconnect(); } catch (e) {}
          observer = null;
        }
      }, 30000);
    }, { once: true });
  } else {
    wire();
    setupObserver();
    setTimeout(function () {
      if (observer) {
        try { observer.disconnect(); } catch (e) {}
        observer = null;
      }
    }, 30000);
  }

  /* ============================================================
     EXPORTS
     ============================================================ */
  window.findProductImage = scrapeFromServer;
  window.ImageScraper = {
    findProductImage: scrapeFromServer,
    uploadBlob: uploadBlob,
    setEditorImage: setEditorImage
  };
})();