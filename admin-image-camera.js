/* ============================================================
   CENTRAL & STORES — CAMERA CAPTURE PIPELINE
   ------------------------------------------------------------
   One-tap camera capture in the product editor. Opens the
   phone's rear camera, runs the full pipeline, uploads:

     capture → enhance → grid-fit (1:1) → mini watermark → compress → upload

   WATERMARK
     Text:     @central&stores   (rendered with ampersand)
     Position: bottom-right
     Size:     ~2.5% of shortest side
     Opacity:  78%
     Shadow:   soft dark behind text (no pill, no box)

   DEPENDS ON
     • admin-image-enhancer.js   (auto-levels, white balance, sharpen)
     • admin-image-compressor.js (WebP encoding)
     • admin-image-multisize.js  (400/800/1200 variants)
     • admin-core.js             (db, toast)

   PUBLIC API (window.CameraCapture)
     open()                    → triggers camera file input
     process(file)             → Promise<{ url, variants, meta }>
     PIPELINE_VERSION
   ============================================================ */

(function () {
  'use strict';

  const toast = (window.AdminCore && window.AdminCore.toast) || function () {};

  const PIPELINE_VERSION = '1.0.0';

  /* ---------- watermark config ---------- */
  const WATERMARK = {
    text: '@central&stores',
    position: 'br',
    sizePct: 0.025,        // 2.5% of shortest side
    opacity: 0.78,
    padPct: 0.020,
    shadowBlur: 0.6,       // relative to font size
    shadowAlpha: 0.45,
    fontFamily: '"Poppins", "Segoe UI", system-ui, -apple-system, sans-serif',
    fontWeight: 700,
    fillColor: '#ffffff'
  };

  /* ============================================================
     HELPERS
     ============================================================ */
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

  /* ============================================================
     GRID-FIT — center-crop to 1:1 with white padding
     ------------------------------------------------------------
     Produces a square canvas so every product card is visually
     identical. Handles both landscape and portrait sources.
     ============================================================ */
  async function gridFitToSquare(blob, size, background) {
    const bg = background || '#ffffff';
    const img = await loadImageFromBlob(blob);

    const side = size || Math.max(img.width, img.height);
    const canvas = document.createElement('canvas');
    canvas.width = side;
    canvas.height = side;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, side, side);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    // Scale so the image fits inside the square, then center it
    const scale = Math.min(side / img.width, side / img.height);
    const drawW = Math.round(img.width * scale);
    const drawH = Math.round(img.height * scale);
    const dx = Math.round((side - drawW) / 2);
    const dy = Math.round((side - drawH) / 2);

    ctx.drawImage(img, dx, dy, drawW, drawH);

    const outBlob = await canvasToBlob(canvas, 'image/png');
    return outBlob || blob;
  }

  /* ============================================================
     WATERMARK — mini @central&stores bottom-right
     ============================================================ */
  async function applyMiniWatermark(blob, options) {
    const opts = Object.assign({}, WATERMARK, options || {});
    if (!opts.text) return blob;

    const img = await loadImageFromBlob(blob);
    const W = img.width;
    const H = img.height;

    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d', { alpha: true });
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, W, H);

    const minSide = Math.min(W, H);
    const fontSize = Math.max(9, Math.round(minSide * opts.sizePct));
    const pad = Math.max(6, Math.round(minSide * opts.padPct));

    const fontSpec = opts.fontWeight + ' ' + fontSize + 'px ' + opts.fontFamily;
    ctx.font = fontSpec;
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'right';

    // Determine vertical baseline (bottom-right)
    const baselineY = H - pad;
    const textX = W - pad;

    // Shadow
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,' + opts.shadowAlpha + ')';
    ctx.shadowBlur = Math.max(3, Math.round(fontSize * opts.shadowBlur));
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = Math.max(1, Math.round(fontSize * 0.06));
    ctx.fillStyle = 'rgba(0,0,0,0.001)'; // invisible fill to force shadow render
    ctx.fillText(opts.text, textX, baselineY);
    ctx.restore();

    // Text
    ctx.save();
    ctx.font = fontSpec;
    ctx.fillStyle = opts.fillColor;
    ctx.globalAlpha = opts.opacity;
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'right';
    ctx.fillText(opts.text, textX, baselineY);
    ctx.restore();

    const outBlob = await canvasToBlob(canvas, 'image/png');
    return outBlob || blob;
  }

  /* ============================================================
     MAIN PIPELINE
     ------------------------------------------------------------
     capture → enhance → grid-fit → watermark
     ------------------------------------------------------------
     The final compress + upload is handled by the existing
     MultiSizeUploader (called from admin-products.js).
     ============================================================ */
  async function process(file, options) {
    const opts = options || {};
    if (!file || !file.size) throw new Error('No file provided');

    // --- 1. Enhance (auto-levels, white balance, sharpen) ---
    let blob = file;
    if (window.ImageEnhancer && typeof window.ImageEnhancer.enhance === 'function') {
      try {
        toast('Enhancing…');
        blob = await window.ImageEnhancer.enhance(blob, { mode: 'catalogue' });
      } catch (e) {
        console.warn('[camera] enhance failed:', e.message);
        blob = file;
      }
    }

    // --- 2. Grid-fit to square ---
    try {
      toast('Fitting to grid…');
      blob = await gridFitToSquare(blob, 1200, '#ffffff');
    } catch (e) {
      console.warn('[camera] grid-fit failed:', e.message);
    }

    // --- 3. Mini watermark ---
    try {
      blob = await applyMiniWatermark(blob);
    } catch (e) {
      console.warn('[camera] watermark failed:', e.message);
    }

    return blob;
  }

  /* ============================================================
     OPEN CAMERA
     ------------------------------------------------------------
     Triggers a hidden file input with capture="environment" so
     mobile browsers open the rear camera directly.
     ============================================================ */
  function open() {
    const input = document.getElementById('cameraInput');
    if (!input) {
      toast('Camera input not found in editor', 'error');
      return;
    }
    input.value = '';
    input.click();
  }

  /* ============================================================
     EXPORTS
     ============================================================ */
  window.CameraCapture = {
    open: open,
    process: process,
    gridFitToSquare: gridFitToSquare,
    applyMiniWatermark: applyMiniWatermark,
    PIPELINE_VERSION: PIPELINE_VERSION,
    WATERMARK: WATERMARK
  };
})();
