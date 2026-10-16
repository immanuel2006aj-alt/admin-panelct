/* ============================================================
   CENTRAL & STORES — CATEGORY IMAGE CAPTURE
   ------------------------------------------------------------
   Adds camera AND upload capture to the Categories page.

   Every category card gets:
     • Photo button  → opens rear camera
     • Upload button → opens file picker

   Both run the same pipeline:
     enhance → grid-fit → mini watermark → compress → upload
   and save the URL to categories.image_url.

   DEPENDS ON
     admin-image-camera.js    (pipeline)
     admin-image-compressor.js
     admin-image-multisize.js
     admin-core.js

   PUBLIC API (window.CategoryImage)
     openCameraFor(id)  → camera
     openUploadFor(id)  → file picker
     process(id, file)  → pipeline + save
   ============================================================ */

(function () {
  'use strict';

  const toast = (window.AdminCore && window.AdminCore.toast) || function () {};

  /* ============================================================
     STATE
     ============================================================ */
  let activeCategoryId = null;
  let activeMode = null; // 'camera' | 'upload'

  /* ============================================================
     HIDDEN INPUTS
     ------------------------------------------------------------
     Two inputs, one for camera, one for file picker. Both point
     at the currently selected category.
     ============================================================ */
  function ensureCameraInput() {
    let input = document.getElementById('categoryCameraInput');
    if (input) return input;

    input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.capture = 'environment';
    input.id = 'categoryCameraInput';
    input.style.display = 'none';
    document.body.appendChild(input);

    input.addEventListener('change', function (e) {
      const file = e.target.files && e.target.files[0];
      if (file && activeCategoryId) {
        processCategoryImage(activeCategoryId, file);
      }
      input.value = '';
    });

    return input;
  }

  function ensureUploadInput() {
    let input = document.getElementById('categoryUploadInput');
    if (input) return input;

    input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/jpeg,image/png,image/webp';
    input.id = 'categoryUploadInput';
    input.style.display = 'none';
    document.body.appendChild(input);

    input.addEventListener('change', function (e) {
      const file = e.target.files && e.target.files[0];
      if (file && activeCategoryId) {
        processCategoryImage(activeCategoryId, file);
      }
      input.value = '';
    });

    return input;
  }

  /* ============================================================
     PUBLIC TRIGGERS
     ============================================================ */
  function openCameraFor(categoryId) {
    if (!categoryId) {
      toast('No category selected', 'error');
      return;
    }
    activeCategoryId = String(categoryId);
    activeMode = 'camera';
    const input = ensureCameraInput();
    input.value = '';
    input.click();
  }

  function openUploadFor(categoryId) {
    if (!categoryId) {
      toast('No category selected', 'error');
      return;
    }
    activeCategoryId = String(categoryId);
    activeMode = 'upload';
    const input = ensureUploadInput();
    input.value = '';
    input.click();
  }

  /* ============================================================
     PIPELINE — enhance, grid-fit, watermark, compress, upload
     ============================================================ */
  async function processCategoryImage(categoryId, rawFile) {
    if (!window.db) { toast('Not connected', 'error'); return; }

    const label = activeMode === 'upload' ? 'Image' : 'Photo';
    toast(label + ' processing…');

    let blob = rawFile;

    // 1. Enhance + grid-fit + watermark (via camera pipeline if loaded)
    if (window.CameraCapture && typeof window.CameraCapture.process === 'function') {
      try {
        blob = await window.CameraCapture.process(blob);
      } catch (e) {
        console.warn('[category-image] pipeline failed:', e.message);
        blob = rawFile;
      }
    } else if (window.ImageEnhancer && typeof window.ImageEnhancer.enhance === 'function') {
      try {
        blob = await window.ImageEnhancer.enhance(blob, { mode: 'catalogue' });
      } catch (e) {}
    }

    // 2. Upload to category-images bucket
    let url;
    try {
      if (window.MultiSizeUploader && typeof window.MultiSizeUploader.uploadAll === 'function') {
        toast('Compressing and uploading…');
        const r = await window.MultiSizeUploader.uploadAll(blob, 'category-images', 'categories');
        if (!r || !r.url) throw new Error('Upload returned no URL');
        url = r.url;
      } else {
        let compressed = blob;
        if (window.ImageCompressor && typeof window.ImageCompressor.compressToWebP === 'function') {
          try {
            compressed = await window.ImageCompressor.compressToWebP(blob, 'category');
          } catch (e) {}
        }

        const fname = 'categories/' + (activeMode === 'upload' ? 'upload' : 'photo') +
          '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.webp';

        const { error } = await window.db.storage
          .from('category-images')
          .upload(fname, compressed, {
            cacheControl: '31536000',
            contentType: compressed.type || 'image/webp',
            upsert: false
          });
        if (error) throw error;

        const { data } = window.db.storage.from('category-images').getPublicUrl(fname);
        if (!data || !data.publicUrl) throw new Error('No public URL');
        url = data.publicUrl;
      }
    } catch (err) {
      console.warn('[category-image] upload failed:', err);
      toast('Upload failed: ' + (err.message || 'Unknown'), 'error');
      return;
    }

    // 3. Save to categories table
    try {
      const { error } = await window.db
        .from('categories')
        .update({ image_url: url })
        .eq('id', categoryId);

      if (error) throw error;

      toast('Category image saved');

      if (typeof window.loadCategories === 'function') {
        window.loadCategories();
      }
    } catch (err) {
      toast('Save failed: ' + (err.message || 'Unknown'), 'error');
    }
  }

  /* ============================================================
     DECORATE CATEGORY CARDS
     ------------------------------------------------------------
     Adds Photo + Upload + Remove buttons to every .cat-card.
     ============================================================ */
  function decorateCategoryCards() {
    const grid = document.getElementById('categoriesGrid');
    if (!grid) return;

    const cards = grid.querySelectorAll('.cat-card');
    if (!cards.length) return;

    cards.forEach(function (card) {
      const catId = card.dataset.catId;
      if (!catId) return;
      if (card.dataset.imageActionsWired === '1') return;
      card.dataset.imageActionsWired = '1';

      const actions = card.querySelector('.cat-card-actions');
      if (!actions) return;

      // Remove existing action children that we might duplicate
      // (Edit + Delete stay; we only append our image buttons)

      // PHOTO button
      const photoBtn = document.createElement('button');
      photoBtn.type = 'button';
      photoBtn.className = 'action-btn';
      photoBtn.style.cssText = 'flex:0 0 auto;background:#f2bd24;color:#111;border:none;padding:0 10px;height:36px;font-size:.75rem;font-weight:700;border-radius:8px';
      photoBtn.title = 'Take photo';
      photoBtn.innerHTML =
        '<svg viewBox="0 0 24 24" style="width:14px;height:14px;fill:none;stroke:currentColor;stroke-width:2;margin-right:4px">' +
          '<path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/>' +
          '<circle cx="12" cy="13" r="4"/>' +
        '</svg>Photo';
      photoBtn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        openCameraFor(catId);
      });

      // UPLOAD button
      const uploadBtn = document.createElement('button');
      uploadBtn.type = 'button';
      uploadBtn.className = 'action-btn';
      uploadBtn.style.cssText = 'flex:0 0 auto;background:#e4e9f0;color:#111;border:none;padding:0 10px;height:36px;font-size:.75rem;font-weight:700;border-radius:8px';
      uploadBtn.title = 'Upload image';
      uploadBtn.innerHTML =
        '<svg viewBox="0 0 24 24" style="width:14px;height:14px;fill:none;stroke:currentColor;stroke-width:2;margin-right:4px">' +
          '<path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>' +
          '<polyline points="17 8 12 3 7 8"/>' +
          '<line x1="12" y1="3" x2="12" y2="15"/>' +
        '</svg>Upload';
      uploadBtn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        openUploadFor(catId);
      });

      // Insert both before Edit
      const editBtn = actions.querySelector('[data-cat-act="edit"]');
      if (editBtn) {
        actions.insertBefore(photoBtn, editBtn);
        actions.insertBefore(uploadBtn, editBtn);
      } else {
        actions.appendChild(photoBtn);
        actions.appendChild(uploadBtn);
      }
    });
  }

  /* ============================================================
     WATCH FOR CATEGORY GRID RE-RENDERS
     ============================================================ */
  function watchCategoryGrid() {
    const grid = document.getElementById('categoriesGrid');
    if (!grid) return;

    if (typeof MutationObserver !== 'function') return;

    const obs = new MutationObserver(function () {
      requestAnimationFrame(decorateCategoryCards);
    });
    obs.observe(grid, { childList: true, subtree: true });

    // Initial pass
    decorateCategoryCards();

    // Safety pass — in case admin-categories.js renders slightly later
    setTimeout(decorateCategoryCards, 300);
    setTimeout(decorateCategoryCards, 1500);
  }

  /* ============================================================
     INIT
     ============================================================ */
  function init() {
    ensureCameraInput();
    ensureUploadInput();
    watchCategoryGrid();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }

  /* ============================================================
     EXPORTS
     ============================================================ */
  window.CategoryImage = {
    openCameraFor: openCameraFor,
    openUploadFor: openUploadFor,
    processCategoryImage: processCategoryImage
  };
})();