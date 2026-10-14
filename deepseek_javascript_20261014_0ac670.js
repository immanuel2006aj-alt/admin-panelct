/* ============================================================
   CENTRAL & STORES — OPEN FOOD FACTS LOOKUP
   ------------------------------------------------------------
   Queries Open Food Facts for a given brand + product name,
   downloads the image, uploads to Supabase Storage, returns
   the public URL.

   PUBLIC API (window.OFFLookup)
     query(brandName, productName)   → Promise<{ url, meta }>
     searchByBarcode(barcode)         → Promise<{ url, meta }>

   LEGAL
     Data: ODbL, Images: CC BY-SA. Attribution required.
     Add to your site footer:
       "Product data and images from Open Food Facts (ODbL)"

   DEPENDS ON: admin-core.js, admin-image-compressor.js,
               admin-image-multisize.js, admin-image-watermark.js
   ============================================================ */

(function () {
  'use strict';

  const USER_AGENT = 'CentralAndStores/1.0 (centralstorezmangalam@gmail.com)';
  const API_BASE = 'https://world.openfoodfacts.org';
  const SEARCH_TIMEOUT_MS = 20000;

  function fetchWithTimeout(url, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(function () { controller.abort(); }, timeoutMs);
    return fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': USER_AGENT }
    }).finally(function () { clearTimeout(timer); });
  }

  /* ---------- Search by brand + product name ---------- */
  async function query(brandName, productName) {
    if (!brandName) throw new Error('Brand is required');

    const brandSlug = brandName.toLowerCase().replace(/\s+/g, '-');
    const url = new URL(API_BASE + '/api/v2/search');
    url.searchParams.set('brands_tags', brandSlug);
    url.searchParams.set('fields', 'code,product_name,brands,image_url,quantity');
    url.searchParams.set('page_size', '30');

    const resp = await fetchWithTimeout(url.toString(), SEARCH_TIMEOUT_MS);
    if (!resp.ok) throw new Error('Open Food Facts HTTP ' + resp.status);

    const data = await resp.json();
    const products = (data && data.products) || [];

    if (!products.length) {
      throw new Error('No products found for brand "' + brandName + '" on Open Food Facts.');
    }

    // If product name given, pick the closest match
    let match = null;
    if (productName) {
      const needle = productName.toLowerCase();
      match = products.find(function (p) {
        return p.product_name && p.product_name.toLowerCase().indexOf(needle) !== -1;
      });
    }
    if (!match) {
      // Fall back: pick first product with an image
      match = products.find(function (p) { return p.image_url && p.image_url.trim(); });
    }
    if (!match) {
      throw new Error('No product with an image found for "' + productName + '" on Open Food Facts.');
    }

    return await downloadAndUpload(match);
  }

  /* ---------- Search by barcode ---------- */
  async function searchByBarcode(barcode) {
    if (!barcode) throw new Error('Barcode is required');

    const url = API_BASE + '/api/v0/product/' + encodeURIComponent(barcode) + '.json';
    const resp = await fetchWithTimeout(url, SEARCH_TIMEOUT_MS);
    if (!resp.ok) throw new Error('Open Food Facts HTTP ' + resp.status);

    const data = await resp.json();
    if (!data || data.status !== 1 || !data.product) {
      throw new Error('Barcode not found in Open Food Facts.');
    }
    if (!data.product.image_url) {
      throw new Error('Product found but has no image.');
    }

    return await downloadAndUpload(data.product);
  }

  /* ---------- Download image + upload to Supabase ---------- */
  async function downloadAndUpload(product) {
    const imageUrl = product.image_url;
    if (!imageUrl) throw new Error('No image URL');

    const resp = await fetchWithTimeout(imageUrl, SEARCH_TIMEOUT_MS);
    if (!resp.ok) throw new Error('Image download HTTP ' + resp.status);
    const blob = await resp.blob();
    if (!blob || !blob.size) throw new Error('Downloaded image is empty');

    // Watermark @centralstores
    let watermarked = blob;
    if (window.ImageWatermark && typeof window.ImageWatermark.apply === 'function') {
      try {
        watermarked = await window.ImageWatermark.apply(blob, {
          text: '@centralstores',
          position: 'br',
          opacity: 0.72
        });
      } catch (e) { /* continue with raw */ }
    }

    // Upload (multi-size if available)
    let uploaded;
    if (window.MultiSizeUploader && window.MultiSizeUploader.uploadAll) {
      uploaded = await window.MultiSizeUploader.uploadAll(watermarked, 'product-images', 'products');
    } else {
      uploaded = await singleUpload(watermarked);
    }

    return {
      url: uploaded.url,
      srcset: uploaded.srcset || '',
      variants: uploaded.variants || uploaded.all || {},
      meta: {
        source: 'openfoodfacts',
        barcode: product.code || null,
        name: product.product_name || '',
        brand: product.brands || '',
        quantity: product.quantity || '',
        image_url: imageUrl
      }
    };
  }

  async function singleUpload(blob) {
    let compressed = blob;
    if (window.ImageCompressor && window.ImageCompressor.compressToWebP) {
      try { compressed = await window.ImageCompressor.compressToWebP(blob, 'product'); }
      catch (e) {}
    }
    const fname = 'products/off-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.webp';
    const { error } = await window.db.storage.from('product-images').upload(fname, compressed, {
      cacheControl: '31536000',
      contentType: compressed.type || 'image/webp',
      upsert: false
    });
    if (error) throw error;
    const { data } = window.db.storage.from('product-images').getPublicUrl(fname);
    return { url: data.publicUrl, variants: { src1200: data.publicUrl } };
  }

  window.OFFLookup = {
    query: query,
    searchByBarcode: searchByBarcode
  };
})();