/* ============================================================
   CENTRAL & STORES — IMAGE COMPRESSOR
   ------------------------------------------------------------
   Runs in the browser. Takes any user-selected image and
   returns a WebP blob that's typically 2–15 KB depending on
   the source content.

   Strategy:
     1. Load image into memory
     2. Resize so the largest side is ≤ maxSize
     3. Draw onto <canvas>
     4. Export as WebP at chosen quality
     5. If resulting blob > targetBytes, re-encode at lower
        quality (iterative loop)
     6. Return the smallest acceptable blob

   PUBLIC API (window.ImageCompressor):
     compressToWebP(fileOrBlob, options)  → Promise<Blob>
     compressToTarget(fileOrBlob, targetBytes, options)
                                          → Promise<Blob>
     PRESETS                              → { product, ad, category }

   USED BY: admin-products.js, admin-ads.js, admin-categories.js
   ============================================================ */

(function () {
  'use strict';

  /* ============================================================
     PRESETS
     ============================================================ */
  const PRESETS = {
    product: {
      maxSize: 800,
      quality: 0.78,
      targetBytes: 4096,       // aim for ~4 KB
      minQuality: 0.45
    },
    ad: {
      maxSize: 1400,
      quality: 0.82,
      targetBytes: 15360,      // aim for ~15 KB
      minQuality: 0.5
    },
    category: {
      maxSize: 600,
      quality: 0.75,
      targetBytes: 3072,       // aim for ~3 KB
      minQuality: 0.4
    }
  };

  /* ============================================================
     HELPERS
     ============================================================ */

  function loadImageFromBlob(blob) {
    return new Promise(function (resolve, reject) {
      const url = URL.createObjectURL(blob);
      const img = new Image();

      img.onload = function () {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error('Unable to decode image.'));
      };

      img.src = url;
    });
  }

  function canvasToBlob(canvas, type, quality) {
    return new Promise(function (resolve) {
      if (canvas.toBlob) {
        canvas.toBlob(function (blob) {
          resolve(blob);
        }, type, quality);
      } else {
        // Very old browsers
        try {
          const dataUrl = canvas.toDataURL(type, quality);
          const bin = atob(dataUrl.split(',')[1]);
          const arr = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
          resolve(new Blob([arr], { type: type }));
        } catch (e) {
          resolve(null);
        }
      }
    });
  }

  function computeTargetSize(imgWidth, imgHeight, maxSize) {
    let w = imgWidth, h = imgHeight;
    if (w > maxSize || h > maxSize) {
      if (w > h) {
        h = Math.round((h * maxSize) / w);
        w = maxSize;
      } else {
        w = Math.round((w * maxSize) / h);
        h = maxSize;
      }
    }
    return { width: w, height: h };
  }

  async function drawToCanvas(img, maxSize, background) {
    const dims = computeTargetSize(img.width, img.height, maxSize);

    const canvas = document.createElement('canvas');
    canvas.width = dims.width;
    canvas.height = dims.height;

    const ctx = canvas.getContext('2d', { alpha: true });

    // Optional white background (for transparent PNGs we might want white)
    if (background) {
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, dims.width, dims.height);
    }

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    // High-quality multi-step downscale to reduce pixelation
    let currentW = img.width, currentH = img.height;
    const steps = [];

    while (currentW > dims.width * 2 && currentH > dims.height * 2) {
      currentW = Math.round(currentW / 2);
      currentH = Math.round(currentH / 2);
      steps.push({ w: currentW, h: currentH });
    }

    let source = img;
    for (let i = 0; i < steps.length; i++) {
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = steps[i].w;
      tempCanvas.height = steps[i].h;
      const tempCtx = tempCanvas.getContext('2d');
      tempCtx.imageSmoothingEnabled = true;
      tempCtx.imageSmoothingQuality = 'high';
      tempCtx.drawImage(source, 0, 0, steps[i].w, steps[i].h);
      source = tempCanvas;
    }

    ctx.drawImage(source, 0, 0, dims.width, dims.height);

    return canvas;
  }

  /* ============================================================
     CORE COMPRESSION — single pass
     ============================================================ */
  async function compressOnce(img, maxSize, quality, background) {
    const canvas = await drawToCanvas(img, maxSize, background);
    let blob = await canvasToBlob(canvas, 'image/webp', quality);

    // Fallback for browsers that can't encode WebP
    if (!blob || blob.type !== 'image/webp') {
      blob = await canvasToBlob(canvas, 'image/jpeg', quality);
    }

    return blob;
  }

  /* ============================================================
     CORE COMPRESSION — iterative to hit a byte target
     ============================================================ */
  async function compressToTarget(fileOrBlob, targetBytes, options) {
    const opts = Object.assign({
      maxSize: 800,
      quality: 0.85,
      minQuality: 0.4,
      background: null
    }, options || {});

    // If input is smaller than target, still process (to strip metadata)
    const img = await loadImageFromBlob(fileOrBlob);

    let best = null;
    let q = opts.quality;

    // Attempt up to 6 passes, each step 0.1 lower quality
    for (let pass = 0; pass < 6; pass++) {
      const blob = await compressOnce(img, opts.maxSize, q, opts.background);
      if (!blob) break;

      if (!best || blob.size < best.size) best = blob;

      if (blob.size <= targetBytes) {
        return blob;
      }

      if (q <= opts.minQuality) break;
      q = Math.max(opts.minQuality, q - 0.1);
    }

    // If we still can't hit target, try again with smaller maxSize
    if (best && best.size > targetBytes) {
      let smallerMax = Math.max(300, Math.round(opts.maxSize * 0.7));
      for (let pass = 0; pass < 3; pass++) {
        const blob = await compressOnce(img, smallerMax, opts.minQuality, opts.background);
        if (blob && blob.size < best.size) best = blob;
        if (blob && blob.size <= targetBytes) return blob;
        smallerMax = Math.max(300, Math.round(smallerMax * 0.75));
      }
    }

    return best;
  }

  /* ============================================================
     SIMPLE WRAPPER — use a preset
     ============================================================ */
  async function compressToWebP(fileOrBlob, optionsOrPreset) {
    let opts;

    if (typeof optionsOrPreset === 'string' && PRESETS[optionsOrPreset]) {
      opts = PRESETS[optionsOrPreset];
    } else if (optionsOrPreset && typeof optionsOrPreset === 'object') {
      opts = optionsOrPreset;
    } else {
      opts = PRESETS.product;
    }

    return compressToTarget(fileOrBlob, opts.targetBytes, {
      maxSize: opts.maxSize,
      quality: opts.quality,
      minQuality: opts.minQuality
    });
  }

  /* ============================================================
     EXPORTS
     ============================================================ */
  window.ImageCompressor = {
    compressToWebP: compressToWebP,
    compressToTarget: compressToTarget,
    PRESETS: PRESETS
  };

  // Also expose as global function for older code paths
  window.compressToWebP = compressToWebP;
})();