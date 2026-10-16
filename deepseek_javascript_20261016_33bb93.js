/* ============================================================
   CENTRAL & STORES — IMAGE ENHANCER
   ------------------------------------------------------------
   In-browser enhancement for phone photos and Pixabay images.
   Two modes:
     • catalogue (default) — clean white-background product look
     • natural             — subtle correction, keeps photo feel

   Runs in ~50 ms per image. Zero network. Zero cost.

   PUBLIC API (window.ImageEnhancer)
     enhance(blob, options)       → Promise<Blob>
     enhanceWithStats(blob, opts) → Promise<{ blob, stats }>
     MODES                        → { catalogue, natural }

   OPTIONS
     mode        'catalogue' | 'natural'  (default: 'catalogue')
     autoLevels  boolean                  (default: true)
     whiteBalance boolean                 (default: true)
     sharpen     number 0..2              (default: 0.6)
     brightness  number -100..100         (default: 0)
     contrast    number -100..100         (default: 0)
     saturation  number -100..100         (default: 0)
     bgLift      boolean                  (default: true in catalogue mode)

   USED BY: admin-products.js (upload pipeline),
            admin-image-pixabay.js
   ============================================================ */

(function () {
  'use strict';

  const MODES = {
    catalogue: {
      autoLevels: true,
      whiteBalance: true,
      sharpen: 0.7,
      brightness: 6,
      contrast: 8,
      saturation: 4,
      bgLift: true
    },
    natural: {
      autoLevels: true,
      whiteBalance: true,
      sharpen: 0.35,
      brightness: 2,
      contrast: 2,
      saturation: 2,
      bgLift: false
    }
  };

  /* ---------- helpers ---------- */

  function loadImageFromBlob(blob) {
    return new Promise(function (resolve, reject) {
      let url;
      try { url = URL.createObjectURL(blob); }
      catch (e) { reject(new Error('Unable to read image')); return; }

      const img = new Image();
      img.onload = function () {
        try { URL.revokeObjectURL(url); } catch (e) {}
        resolve(img);
      };
      img.onerror = function () {
        try { URL.revokeObjectURL(url); } catch (e) {}
        reject(new Error('Unable to decode image'));
      };
      img.src = url;
    });
  }

  function canvasToBlob(canvas, type, quality) {
    return new Promise(function (resolve) {
      if (canvas.toBlob) {
        canvas.toBlob(function (b) { resolve(b); }, type, quality);
      } else {
        try {
          const dataUrl = canvas.toDataURL(type, quality);
          const bin = atob(dataUrl.split(',')[1]);
          const arr = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
          resolve(new Blob([arr], { type: type }));
        } catch (e) { resolve(null); }
      }
    });
  }

  /* ---------- auto-levels (histogram stretch) ---------- */

  function autoLevels(data, width, height) {
    const len = data.length;
    let minR = 255, maxR = 0;
    let minG = 255, maxG = 0;
    let minB = 255, maxB = 0;

    // Sample every 4th pixel for speed
    for (let i = 0; i < len; i += 16) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      if (r < minR) minR = r; if (r > maxR) maxR = r;
      if (g < minG) minG = g; if (g > maxG) maxG = g;
      if (b < minB) minB = b; if (b > maxB) maxB = b;
    }

    // Guard against flat images
    if (maxR - minR < 10) { minR = 0; maxR = 255; }
    if (maxG - minG < 10) { minG = 0; maxG = 255; }
    if (maxB - minB < 10) { minB = 0; maxB = 255; }

    const scaleR = 255 / (maxR - minR);
    const scaleG = 255 / (maxG - minG);
    const scaleB = 255 / (maxB - minB);

    for (let i = 0; i < len; i += 4) {
      data[i]     = Math.min(255, Math.max(0, (data[i]     - minR) * scaleR));
      data[i + 1] = Math.min(255, Math.max(0, (data[i + 1] - minG) * scaleG));
      data[i + 2] = Math.min(255, Math.max(0, (data[i + 2] - minB) * scaleB));
    }
  }

  /* ---------- white balance (gray-world assumption) ---------- */

  function whiteBalance(data, width, height) {
    const len = data.length;
    let sumR = 0, sumG = 0, sumB = 0;
    let count = 0;

    for (let i = 0; i < len; i += 16) {
      sumR += data[i];
      sumG += data[i + 1];
      sumB += data[i + 2];
      count++;
    }

    if (!count) return;

    const avgR = sumR / count;
    const avgG = sumG / count;
    const avgB = sumB / count;
    const avg = (avgR + avgG + avgB) / 3;

    const scaleR = avg / (avgR || 1);
    const scaleG = avg / (avgG || 1);
    const scaleB = avg / (avgB || 1);

    for (let i = 0; i < len; i += 4) {
      data[i]     = Math.min(255, data[i]     * scaleR);
      data[i + 1] = Math.min(255, data[i + 1] * scaleG);
      data[i + 2] = Math.min(255, data[i + 2] * scaleB);
    }
  }

  /* ---------- brightness / contrast / saturation ---------- */

  function applyAdjustments(data, brightness, contrast, saturation) {
    const b = brightness;
    const c = contrast;
    const s = saturation;

    const contrastFactor = (259 * (c + 255)) / (255 * (259 - c));

    for (let i = 0; i < data.length; i += 4) {
      let r = data[i] + b;
      let g = data[i + 1] + b;
      let bl = data[i + 2] + b;

      // Contrast
      r = contrastFactor * (r - 128) + 128;
      g = contrastFactor * (g - 128) + 128;
      bl = contrastFactor * (bl - 128) + 128;

      // Saturation (blend toward luminance)
      const lum = r * 0.299 + g * 0.587 + bl * 0.114;
      const satFactor = 1 + (s / 100);
      r = lum + (r - lum) * satFactor;
      g = lum + (g - lum) * satFactor;
      bl = lum + (bl - lum) * satFactor;

      data[i]     = Math.min(255, Math.max(0, r));
      data[i + 1] = Math.min(255, Math.max(0, g));
      data[i + 2] = Math.min(255, Math.max(0, bl));
    }
  }

  /* ---------- unsharp mask (sharpen) ---------- */

  function sharpen(data, width, height, amount) {
    if (amount <= 0) return;

    const len = data.length;
    const copy = new Uint8ClampedArray(data);

    const kernel = [
       0, -1,  0,
      -1,  5, -1,
       0, -1,  0
    ];

    const strength = Math.max(0, Math.min(1, amount));

    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const idx = (y * width + x) * 4;

        for (let ch = 0; ch < 3; ch++) {
          let sum = 0;
          let k = 0;
          for (let ky = -1; ky <= 1; ky++) {
            for (let kx = -1; kx <= 1; kx++) {
              const pIdx = ((y + ky) * width + (x + kx)) * 4 + ch;
              sum += copy[pIdx] * kernel[k];
              k++;
            }
          }
          const original = copy[idx + ch];
          const sharpened = sum;
          data[idx + ch] = Math.min(255, Math.max(0,
            original * (1 - strength) + sharpened * strength
          ));
        }
      }
    }
  }

  /* ---------- background lift (push near-white toward pure white) ---------- */

  function bgLift(data, width, height) {
    const len = data.length;

    // Only modify pixels that are already bright (near-white background)
    const threshold = 210;

    for (let i = 0; i < len; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];

      const lum = r * 0.299 + g * 0.587 + b * 0.114;

      if (lum >= threshold) {
        // Push toward 255
        const t = (lum - threshold) / (255 - threshold);
        const boost = Math.min(1, t * 1.5);
        data[i]     = Math.min(255, r + (255 - r) * boost * 0.7);
        data[i + 1] = Math.min(255, g + (255 - g) * boost * 0.7);
        data[i + 2] = Math.min(255, b + (255 - b) * boost * 0.7);
      }
    }
  }

  /* ---------- main enhancement pipeline ---------- */

  async function enhance(blob, options) {
    if (!blob || !blob.size) return blob;

    const opts = Object.assign({}, MODES.catalogue, options || {});

    // If mode string given, merge preset
    if (options && typeof options.mode === 'string' && MODES[options.mode]) {
      Object.assign(opts, MODES[options.mode]);
    }

    let img;
    try {
      img = await loadImageFromBlob(blob);
    } catch (e) {
      console.warn('[enhancer] decode failed, returning original:', e.message);
      return blob;
    }

    const W = img.width;
    const H = img.height;

    // Cap at 1600px on the long edge for speed
    const maxDim = 1600;
    let drawW = W;
    let drawH = H;
    if (W > maxDim || H > maxDim) {
      const ratio = Math.min(maxDim / W, maxDim / H);
      drawW = Math.round(W * ratio);
      drawH = Math.round(H * ratio);
    }

    const canvas = document.createElement('canvas');
    canvas.width = drawW;
    canvas.height = drawH;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, drawW, drawH);

    const imageData = ctx.getImageData(0, 0, drawW, drawH);
    const data = imageData.data;

    if (opts.autoLevels) autoLevels(data, drawW, drawH);
    if (opts.whiteBalance) whiteBalance(data, drawW, drawH);
    applyAdjustments(
      data,
      opts.brightness || 0,
      opts.contrast || 0,
      opts.saturation || 0
    );
    if (opts.sharpen && opts.sharpen > 0) {
      sharpen(data, drawW, drawH, opts.sharpen);
    }
    if (opts.bgLift) bgLift(data, drawW, drawH);

    ctx.putImageData(imageData, 0, 0);

    const outType = (blob.type && blob.type.indexOf('image/') === 0)
      ? blob.type
      : 'image/jpeg';
    const quality = outType === 'image/png' ? undefined : 0.92;

    const outBlob = await canvasToBlob(canvas, outType, quality);
    if (!outBlob || !outBlob.size) return blob;

    return outBlob;
  }

  async function enhanceWithStats(blob, options) {
    const start = (typeof performance !== 'undefined' && performance.now)
      ? performance.now()
      : Date.now();
    const out = await enhance(blob, options);
    const end = (typeof performance !== 'undefined' && performance.now)
      ? performance.now()
      : Date.now();

    return {
      blob: out,
      stats: {
        inputSize: blob ? blob.size : 0,
        outputSize: out ? out.size : 0,
        ms: Math.round(end - start),
        mode: (options && options.mode) || 'catalogue'
      }
    };
  }

  /* ---------- exports ---------- */

  window.ImageEnhancer = {
    enhance: enhance,
    enhanceWithStats: enhanceWithStats,
    MODES: MODES
  };
})();