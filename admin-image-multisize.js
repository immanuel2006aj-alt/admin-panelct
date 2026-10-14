/* ============================================================
   CENTRAL & STORES — MULTI-SIZE IMAGE PROCESSOR
   ------------------------------------------------------------
   When an image is uploaded:
     1. Generate 3 variants: 400px, 800px, 1200px (max side)
     2. Each variant compressed as WebP (2–8 KB each)
     3. Upload all 3 to Supabase Storage with suffix:
          products/1234-abc.webp         (1200px, primary)
          products/1234-abc-400.webp     (400px)
          products/1234-abc-800.webp     (800px)
     4. Return { url, srcset, sizes, all } so pages can build
        a srcset.

   PUBLIC API (window.MultiSizeUploader):
     uploadAll(file, bucket, folder)   → Promise<{ url, srcset, sizes, all }>
     buildSrcset(variants)             → string
     buildSrcsetFor(primaryUrl)        → string
     deriveVariantsFromUrl(url)        → { src400, src800, src1200 }
     SIZES                             → array

   USED BY: admin-products.js, admin-ads.js, admin-categories.js

   FALLBACK: if this file isn't loaded, callers fall back to
   single-variant upload using ImageCompressor directly.
   ============================================================ */

(function () {
  'use strict';

  const SIZES = [
    { key: 'src400',  max: 400,  targetBytes: 2048, quality: 0.75 },
    { key: 'src800',  max: 800,  targetBytes: 4096, quality: 0.78 },
    { key: 'src1200', max: 1200, targetBytes: 8192, quality: 0.80 }
  ];

  // Prevent base-name collision when uploading many files in the same millisecond
  let sessionCounter = 0;

  /* ============================================================
     UTILITIES
     ============================================================ */
  function generateBaseName() {
    const ts = Date.now();
    const rand = Math.random().toString(36).slice(2, 8);
    sessionCounter = (sessionCounter + 1) % 10000;
    const seq = sessionCounter.toString(36).padStart(3, '0');
    return ts + '-' + rand + seq;
  }

  function sleep(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  /* ============================================================
     UPLOAD ONE VARIANT (with 1 retry on failure)
     ============================================================ */
  async function uploadVariant(blob, bucket, path) {
    if (!window.db) throw new Error('Supabase not available');

    const attempt = async function () {
      const { error } = await window.db.storage
        .from(bucket)
        .upload(path, blob, {
          cacheControl: '31536000', // 1 year
          contentType: 'image/webp',
          upsert: false
        });
      if (error) throw error;
      const { data } = window.db.storage.from(bucket).getPublicUrl(path);
      return data.publicUrl;
    };

    try {
      return await attempt();
    } catch (err) {
      // Retry once after 500ms — helps with transient network hiccups
      await sleep(500);
      return await attempt();
    }
  }

  /* ============================================================
     MAIN UPLOADER
     ------------------------------------------------------------
     @param {File|Blob} file  The user's original image
     @param {string} bucket   Storage bucket
     @param {string} folder   Subfolder ('products', 'ads', 'categories')
     @returns {Promise<{ url, srcset, sizes, all }>}
     ============================================================ */
  async function uploadAll(file, bucket, folder) {
    if (!file) throw new Error('No file provided');
    if (!bucket) throw new Error('No bucket provided');
    if (!window.ImageCompressor) {
      throw new Error('ImageCompressor not loaded — include admin-image-compressor.js first');
    }

    const base = generateBaseName();
    const cleanFolder = (folder || '').replace(/\/+$/, '');
    const prefix = cleanFolder ? cleanFolder + '/' : '';

    const variants = {};
    const failedSizes = [];

    // Sequential uploads (safer on Supabase free tier)
    for (const s of SIZES) {
      // Compress to target
      let blob = null;
      try {
        blob = await window.ImageCompressor.compressToTarget(
          file,
          s.targetBytes,
          {
            maxSize: s.max,
            quality: s.quality,
            minQuality: 0.4,
            background: null
          }
        );
      } catch (err) {
        console.warn('[multisize] compression failed for ' + s.max + 'px:', err.message);
        failedSizes.push(s.key);
        continue;
      }

      if (!blob || !blob.size) {
        console.warn('[multisize] empty blob for ' + s.max + 'px');
        failedSizes.push(s.key);
        continue;
      }

      // Naming: base.webp for 1200px, base-400.webp for 400px, etc.
      const suffix = s.key === 'src1200' ? '' : '-' + s.max;
      const path = prefix + base + suffix + '.webp';

      try {
        const url = await uploadVariant(blob, bucket, path);
        variants[s.key] = url;
      } catch (err) {
        console.warn('[multisize] upload failed for ' + s.max + 'px:', err.message);
        failedSizes.push(s.key);
      }
    }

    // Determine primary (largest successful variant)
    const primary = variants.src1200 || variants.src800 || variants.src400;
    if (!primary) {
      throw new Error('All variant uploads failed. Check your internet and Supabase Storage.');
    }

    // Warn if some variants failed
    if (failedSizes.length > 0) {
      console.warn('[multisize] some variants failed:', failedSizes.join(', '));
    }

    return {
      url: primary,
      srcset: buildSrcset(variants),
      sizes: '(max-width: 400px) 400px, (max-width: 800px) 800px, 1200px',
      all: variants,
      failed: failedSizes
    };
  }

  /* ============================================================
     BUILD SRCSET ATTRIBUTE from variant URLs
     ============================================================ */
  function buildSrcset(variants) {
    if (!variants) return '';
    const parts = [];
    if (variants.src400)  parts.push(variants.src400  + ' 400w');
    if (variants.src800)  parts.push(variants.src800  + ' 800w');
    if (variants.src1200) parts.push(variants.src1200 + ' 1200w');
    return parts.join(', ');
  }

  /* ============================================================
     DERIVE VARIANT URLs from a primary URL
     ------------------------------------------------------------
     If URL ends with -400.webp or -800.webp, use it as-is
     (edge case where primary is not the 1200 variant).
     ============================================================ */
  function deriveVariantsFromUrl(primaryUrl) {
    if (!primaryUrl || typeof primaryUrl !== 'string') {
      return { src400: '', src800: '', src1200: '' };
    }

    // If the URL already has a size suffix, strip it first
    let cleanUrl = primaryUrl;
    const m = primaryUrl.match(/^(.*?)-(\d{3})\.webp(\?.*)?$/i);
    if (m) {
      // Reconstruct without suffix; keep query string if present
      cleanUrl = m[1] + '.webp' + (m[3] || '');
    }

    const base = cleanUrl.replace(/\.webp(\?.*)?$/i, '');

    return {
      src400:  base + '-400.webp',
      src800:  base + '-800.webp',
      src1200: cleanUrl
    };
  }

  /* ============================================================
     SRCSET BUILDER FOR PUBLIC SITE
     ------------------------------------------------------------
     Call from products-grid.js / ads.js:
       <img src="${image_url}"
            srcset="${MultiSizeUploader.buildSrcsetFor(image_url)}"
            sizes="(max-width: 400px) 400px, (max-width: 800px) 800px, 1200px"
            loading="lazy">
     ============================================================ */
  function buildSrcsetFor(primaryUrl) {
    const v = deriveVariantsFromUrl(primaryUrl);
    const parts = [];
    if (v.src400)  parts.push(v.src400  + ' 400w');
    if (v.src800)  parts.push(v.src800  + ' 800w');
    if (v.src1200) parts.push(v.src1200 + ' 1200w');
    return parts.join(', ');
  }

  /* ============================================================
     EXPORTS
     ============================================================ */
  window.MultiSizeUploader = {
    uploadAll: uploadAll,
    buildSrcset: buildSrcset,
    buildSrcsetFor: buildSrcsetFor,
    deriveVariantsFromUrl: deriveVariantsFromUrl,
    SIZES: SIZES
  };
})();
