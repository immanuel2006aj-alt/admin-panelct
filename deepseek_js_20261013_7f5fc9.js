/* ============================================================
   CENTRAL & STORES — IMAGE SCRAPER v5 (Server-Backed)
   ------------------------------------------------------------
   Calls the `scrape-product-image` Supabase Edge Function
   which scrapes Flipkart → JioMart → Amazon.in server-side.
   No CORS. Title matching enforced. Exact product images.

   FLOW
     Browser → Edge Function (server) → Flipkart
     → returns matched image URL + base64 bytes
     → browser → compress to WebP → Supabase Storage
     → editor image set

   FALLBACK: if scrape fails → calls admin-ai-image.js
   ============================================================ */

(function () {
  'use strict';

  const toast = window.AdminCore ? window.AdminCore.toast : function () {};
  const SUPABASE_URL = 'https://xcdzozyhvkonvesqvxbp.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhjZHpvenlodmtvbnZlc3F2eGJwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk5MDIwMTYsImV4cCI6MjEwNTQ3ODAxNn0.mX0u55mSR14FGr8Lt6ofENfaOqH6JcGp4ACjKnC3gKA';

  /* ---------- Call the Edge Function ---------- */
  async function scrapeFromServer(query) {
    const url = SUPABASE_URL + '/functions/v1/scrape-product-image';

    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + SUPABASE_ANON_KEY,
        'apikey': SUPABASE_ANON_KEY
      },
      body: JSON.stringify({ query: query, include_image: true })
    });

    if (!resp.ok) {
      throw new Error('Server HTTP ' + resp.status);
    }

    const data = await resp.json();
    if (!data.success) {
      throw new Error(data.error || 'Scrape failed');
    }

    return data;
  }

  /* ---------- base64 → Blob ---------- */
  function b64ToBlob(b64, mime) {
    const chars = atob(b64);
    const bytes = new Uint8Array(chars.length);
    for (let i = 0; i < chars.length; i++) bytes[i] = chars.charCodeAt(i);
    return new Blob([bytes], { type: mime || 'image/jpeg' });
  }

  /* ---------- Download from URL (fallback if b64 missing) ---------- */
  async function downloadBlob(url) {
    const r = await fetch(url, { mode: 'cors' });
    if (!r.ok) throw new Error('Download HTTP ' + r.status);
    return await r.blob();
  }

  /* ---------- Upload to Supabase Storage ---------- */
  async function uploadBlob(blob) {
    if (!window.db) throw new Error('Supabase not available');

    // Multi-size uploader if available (3 variants)
    if (window.MultiSizeUploader && typeof window.MultiSizeUploader.uploadAll === 'function') {
      const r = await window.MultiSizeUploader.uploadAll(blob, 'product-images', 'products');
      return r.url;
    }

    // Fallback: single compressed upload
    let compressed = blob;
    if (window.ImageCompressor) {
      compressed = await window.ImageCompressor.compressToWebP(blob, 'product');
    }

    const fname = 'products/scraped-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.webp';

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

  /* ---------- Set editor image ---------- */
  function setEditorImage(url) {
    if (window.__productsState) window.__productsState.editorImageUrl = url;

    const preview = document.getElementById('uploadPreviewImg');
    const prevWrap = document.getElementById('uploadPreview');
    const zone = document.getElementById('uploadZone');

    if (preview) preview.src = url;
    if (prevWrap) prevWrap.classList.remove('hidden');
    if (zone) zone.classList.add('hidden');
  }

  /* ---------- Main: Find Image button handler ---------- */
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
    btn.innerHTML = '🔍 Searching Flipkart…';

    try {
      // 1. Call server scraper
      const result = await scrapeFromServer(query);

      if (!result.imageB64 && !result.imageUrl) {
        throw new Error('No image returned');
      }

      btn.innerHTML = '⬇️ Downloading…';
      const blob = result.imageB64
        ? b64ToBlob(result.imageB64, result.mime)
        : await downloadBlob(result.imageUrl);

      btn.innerHTML = '🗜️ Compressing…';
      // Upload (which internally compresses + multi-sizes)
      const publicUrl = await uploadBlob(blob);

      setEditorImage(publicUrl);

      toast(
        '✓ Found on ' + result.source + ': "' + (result.matchedTitle || query) + '"',
        'success'
      );
    } catch (err) {
      console.warn('[scraper] failed:', err);

      // Fallback to AI if available
      if (typeof window.generateProductImage === 'function') {
        btn.innerHTML = '✨ AI fallback…';
        try {
          const ai = await window.generateProductImage(query, { quality: 'medium' });
          setEditorImage(ai.url);
          toast('✓ AI mockup generated (scraper found no exact match)', 'success');
          return;
        } catch (aiErr) {
          console.warn('[scraper] AI fallback failed:', aiErr);
        }
      }

      toast('Scrape failed: ' + (err.message || 'Unknown') + ' — try manual upload', 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = originalHtml;
    }
  }

  /* ---------- Wire up button ---------- */
  function wire() {
    const btn = document.getElementById('findImageBtn');
    if (!btn || btn.dataset.scraperWired === '1') return;
    btn.dataset.scraperWired = '1';
    btn.addEventListener('click', handleFindImageClick);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wire, { once: true });
  } else {
    wire();
  }

  const observer = new MutationObserver(wire);
  if (document.body) observer.observe(document.body, { childList: true, subtree: true });

  /* ---------- Exports ---------- */
  window.findProductImage = scrapeFromServer;
  window.ImageScraper = {
    findProductImage: scrapeFromServer,
    uploadBlob: uploadBlob,
    setEditorImage: setEditorImage
  };
})();