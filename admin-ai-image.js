/* ============================================================
   CENTRAL & STORES — AI IMAGE GENERATOR
   ------------------------------------------------------------
   Generates a clean product photo from the product name using
   Pollinations.ai — completely free, no API key, no rate limit.

   WORKFLOW
     1. User types product name in editor
     2. Clicks "Generate with AI"
     3. This file builds a grocery-photo prompt
     4. Calls Pollinations.ai
     5. Receives a generated image (JPEG/PNG)
     6. Compresses to WebP (~5–20 KB)
     7. Uploads to Supabase Storage
     8. Sets the editor image URL

   PUBLIC API
     window.generateProductImage(productName, options)
        → { url: storage_url, source: 'pollinations' }
   ============================================================ */

(function () {
  'use strict';

  const toast = window.AdminCore ? window.AdminCore.toast : function () {};

  /* ============================================================
     PROMPT BUILDER
     ------------------------------------------------------------
     Builds a prompt that produces a clean, centered product
     photo — like an Amazon/Blinkit listing image.
     ============================================================ */
  function buildPrompt(productName, options) {
    const opts = options || {};
    const style = opts.style || 'clean';

    // Base — a professional grocery product photo
    let base = 'Professional e-commerce product photo of ' + productName + ', ';

    // Style variants
    if (style === 'clean') {
      base += 'centered on pure white background, soft studio lighting, ' +
              'high detail, sharp focus, catalog photography, ' +
              'no text, no logos, no watermarks, 4k, single product, ' +
              'no people, no hands, no props, minimal shadow';
    } else if (style === 'packaging') {
      base += 'with simple unbranded packaging, white background, ' +
              'studio lighting, catalog photography, single unit, ' +
              'no text, no logos, no watermarks, 4k, no people';
    } else if (style === 'natural') {
      base += 'on a clean white plate, natural lighting, ' +
              'fresh appearance, top-down view, minimal props, ' +
              'no text, no logos, 4k, no people';
    } else if (style === 'bulk') {
      base += 'stacked units on white background, product photography, ' +
              'studio lighting, no text, no logos, 4k, no people';
    }

    return base;
  }

  /* ============================================================
     POLLINATIONS.AI CALL
     ------------------------------------------------------------
     Public API: https://image.pollinations.ai/prompt/{prompt}
     Query params:
       width, height, seed, model, nologo, private, enhance
     ============================================================ */
  async function generateViaPollinations(prompt, options) {
    const opts = options || {};
    const width = opts.width || 800;
    const height = opts.height || 800;
    const seed = opts.seed || Math.floor(Math.random() * 1e9);
    const model = opts.model || 'flux'; // 'flux' | 'turbo'

    const url =
      'https://image.pollinations.ai/prompt/' +
      encodeURIComponent(prompt) +
      '?width=' + width +
      '&height=' + height +
      '&seed=' + seed +
      '&model=' + model +
      '&nologo=true' +
      '&private=true' +
      '&enhance=false';

    // Pollinations returns the image bytes directly
    const resp = await fetch(url, { mode: 'cors' });
    if (!resp.ok) throw new Error('Pollinations returned HTTP ' + resp.status);

    const blob = await resp.blob();
    if (!blob || !blob.size) throw new Error('Empty image from Pollinations');
    if (!blob.type || blob.type.indexOf('image/') !== 0) {
      throw new Error('Non-image response from Pollinations: ' + blob.type);
    }

    return blob;
  }

  /* ============================================================
     ALTERNATE — Pollinations fallback via a proxy
     ------------------------------------------------------------
     If CORS fails on the primary endpoint, try the images.weserv
     proxy which fetches the URL server-side.
     ============================================================ */
  async function generateViaPollinationsProxy(prompt, options) {
    const opts = options || {};
    const width = opts.width || 800;
    const height = opts.height || 800;
    const seed = opts.seed || Math.floor(Math.random() * 1e9);

    const primary =
      'https://image.pollinations.ai/prompt/' +
      encodeURIComponent(prompt) +
      '?width=' + width +
      '&height=' + height +
      '&seed=' + seed +
      '&model=flux' +
      '&nologo=true';

    const proxied = 'https://images.weserv.nl/?url=' + encodeURIComponent(primary.replace(/^https?:\/\//, ''));

    const resp = await fetch(proxied);
    if (!resp.ok) throw new Error('Proxy returned HTTP ' + resp.status);

    const blob = await resp.blob();
    if (!blob || !blob.size) throw new Error('Empty image from proxy');

    return blob;
  }

  /* ============================================================
     UPLOAD
     ============================================================ */
  async function uploadBlob(blob, productName) {
    if (!window.db) throw new Error('Supabase not available');

    // Multi-size if available
    if (window.MultiSizeUploader && typeof window.MultiSizeUploader.uploadAll === 'function') {
      const r = await window.MultiSizeUploader.uploadAll(blob, 'product-images', 'products');
      return r.url;
    }

    // Fallback: single compressed upload
    let compressed = blob;
    if (window.ImageCompressor) {
      compressed = await window.ImageCompressor.compressToWebP(blob, 'product');
    }

    const fname =
      'products/ai-' +
      Date.now() +
      '-' +
      Math.random().toString(36).slice(2, 8) +
      '.webp';

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
     MAIN API
     ============================================================ */
  async function generateProductImage(productName, options) {
    if (!productName || !productName.trim()) {
      throw new Error('Product name required');
    }

    const opts = options || {};
    const prompt = buildPrompt(productName.trim(), opts);

    console.log('[AI image] prompt:', prompt);

    // Try direct
    let blob = null;
    try {
      blob = await generateViaPollinations(prompt, opts);
    } catch (err) {
      console.warn('[AI image] direct failed, trying proxy:', err.message);
      blob = await generateViaPollinationsProxy(prompt, opts);
    }

    if (!blob) throw new Error('AI image generation failed');

    const url = await uploadBlob(blob, productName);
    return { url: url, source: 'pollinations', prompt: prompt };
  }

  /* ============================================================
     BUTTON HANDLER — wire to #openAiBtn
     ============================================================ */
  async function handleAIGenerateClick() {
    const btn = document.getElementById('openAiBtn');
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
    btn.innerHTML = '✨ Generating…';

    try {
      const result = await generateProductImage(query, {
        style: 'clean',
        width: 800,
        height: 800
      });

      // Set editor image
      if (window.__productsState) window.__productsState.editorImageUrl = result.url;
      const preview = document.getElementById('uploadPreviewImg');
      const prevWrap = document.getElementById('uploadPreview');
      const zone = document.getElementById('uploadZone');
      if (preview) preview.src = result.url;
      if (prevWrap) prevWrap.classList.remove('hidden');
      if (zone) zone.classList.add('hidden');

      toast('Image generated with AI ✓', 'success');
    } catch (err) {
      console.error('[AI image] error:', err);
      toast('AI generation failed: ' + (err.message || 'Unknown'), 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = originalHtml;
    }
  }

  /* ============================================================
     WIRE UP
     ============================================================ */
  function wireAIButton() {
    const btn = document.getElementById('openAiBtn');
    if (!btn) return;
    if (btn.dataset.aiWired === '1') return;
    btn.dataset.aiWired = '1';
    btn.addEventListener('click', handleAIGenerateClick);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wireAIButton, { once: true });
  } else {
    wireAIButton();
  }

  const observer = new MutationObserver(wireAIButton);
  if (document.body) observer.observe(document.body, { childList: true, subtree: true });

  /* ============================================================
     EXPORTS
     ============================================================ */
  window.generateProductImage = generateProductImage;
  window.AIImage = {
    generateProductImage: generateProductImage,
    buildPrompt: buildPrompt
  };
})();
