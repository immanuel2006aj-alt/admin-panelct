/* ============================================================
   CENTRAL & STORES — AI IMAGE GENERATOR v2.0
   ------------------------------------------------------------
   Uses a professional grocery pouch mockup prompt template.
   Auto-fills brand, product, weight, subtitle, and product-noun
   from the product name field.

   SOURCE: Pollinations.ai (free, unlimited, no key)
   ============================================================ */

(function () {
  'use strict';

  const toast = window.AdminCore ? window.AdminCore.toast : function () {};

  /* ============================================================
     KNOWN BRANDS — used to split "Aachi Sambar Powder" into
     brand="Aachi" + product="Sambar Powder"
     ============================================================ */
  const KNOWN_BRANDS = [
    'aachi', 'tata', 'amul', 'mtr', 'maggi', 'britannia', 'parle',
    'nestle', 'cadbury', 'dabur', 'patanjali', 'everest', 'mdh',
    'catch', 'ching\'s', 'knorr', 'itc', 'sunfeast', 'bingo',
    'lays', 'kurkure', 'haldiram', 'bikaji', 'balaji', 'gits',
    'priya', 'mother dairy', 'heritage', 'milky mist', 'amul',
    'lakshmi', 'idhayam', 'gold winner', 'saffola', 'fortune',
    'grb', 'kaleesuwari', 'lingam', 'vvd', 'sri sri', 'organic india',
    'sunrise', 'cothas', 'narasu', 'leo coffee', 'bru', 'red label',
    'taj mahal', 'tata tea', 'gemini', 'three roses', 'lion',
    'annapoorna', 'bambino', 'mtr foods', 'kelloggs', 'quaker',
    'bostan', 'cadbury dairy milk', 'dairy milk', 'kitkat', 'oreo'
  ];

  function splitBrandAndProduct(name) {
    const lower = name.toLowerCase().trim();
    for (const brand of KNOWN_BRANDS) {
      if (lower.indexOf(brand) === 0) {
        const brandTitle = brand.split(' ').map(function (w) {
          return w.charAt(0).toUpperCase() + w.slice(1);
        }).join(' ');
        const product = name.slice(brand.length).trim();
        return {
          brand: brandTitle,
          product: product || name
        };
      }
    }
    // No brand detected — use full name as product
    return {
      brand: 'CENTRAL & STORES',
      product: name
    };
  }

  /* ============================================================
     PRODUCT-NOUN MAP — describes what's visible in the window
     ============================================================ */
  const PRODUCT_NOUNS = [
    { match: ['basmati rice', 'basmati', 'raw rice', 'ponni', 'sona masoori', 'seeraga samba', 'rice'],
      noun: 'slender long raw white rice grains' },
    { match: ['toor dal', 'toor', 'thuvaram', 'arhar'],
      noun: 'bright yellow split pigeon peas (toor dal)' },
    { match: ['urad dal', 'urad', 'ulundhu', 'black gram'],
      noun: 'small white-black split urad dal lentils' },
    { match: ['moong dal', 'moong', 'pasipayaru', 'green gram'],
      noun: 'yellow split moong dal lentils' },
    { match: ['chana dal', 'chana', 'kadalai'],
      noun: 'yellow split chickpeas (chana dal)' },
    { match: ['rajma', 'kidney beans'],
      noun: 'dark red kidney beans' },
    { match: ['chickpea', 'kabuli chana', 'white chana'],
      noun: 'beige chickpeas' },
    { match: ['wheat', 'atta', 'godhumai'],
      noun: 'golden wheat grains' },
    { match: ['maida', 'flour'],
      noun: 'fine white flour' },
    { match: ['rava', 'sooji', 'suji', 'semolina'],
      noun: 'coarse golden semolina granules' },
    { match: ['poha', 'aval'],
      noun: 'flattened white rice flakes' },
    { match: ['turmeric', 'haldi', 'manjal'],
      noun: 'bright yellow turmeric powder' },
    { match: ['chilli powder', 'chili powder', 'milagai'],
      noun: 'deep red chilli powder' },
    { match: ['coriander powder', 'dhania'],
      noun: 'brown coriander powder' },
    { match: ['sambar powder', 'sambar'],
      noun: 'aromatic reddish-brown sambar powder' },
    { match: ['rasam powder', 'rasam'],
      noun: 'dark reddish rasam powder' },
    { match: ['garam masala'],
      noun: 'dark brown garam masala powder' },
    { match: ['cumin', 'jeera', 'seeragam'],
      noun: 'whole brown cumin seeds' },
    { match: ['mustard', 'kadugu'],
      noun: 'small round black mustard seeds' },
    { match: ['pepper', 'milagu'],
      noun: 'whole black peppercorns' },
    { match: ['cardamom', 'elakkai'],
      noun: 'green cardamom pods' },
    { match: ['clove', 'kirambu'],
      noun: 'whole dried cloves' },
    { match: ['cinnamon', 'pattai'],
      noun: 'rolled cinnamon bark' },
    { match: ['fenugreek', 'vendhayam'],
      noun: 'small golden-brown fenugreek seeds' },
    { match: ['fennel', 'sombu'],
      noun: 'small green fennel seeds' },
    { match: ['cashew', 'mundhiri'],
      noun: 'whole cream-white cashew nuts' },
    { match: ['almond', 'badam'],
      noun: 'whole brown almonds' },
    { match: ['pista', 'pistachio'],
      noun: 'green pistachios with shells' },
    { match: ['raisin', 'kishmish', 'dry grapes'],
      noun: 'dried golden raisins' },
    { match: ['peanut', 'groundnut', 'verkadalai'],
      noun: 'whole roasted peanuts' },
    { match: ['salt'],
      noun: 'fine white salt crystals' },
    { match: ['sugar'],
      noun: 'white sugar crystals' },
    { match: ['jaggery', 'vellam'],
      noun: 'golden-brown jaggery blocks' },
    { match: ['tea', 'chai', 'theeyilai'],
      noun: 'dark black tea leaves' },
    { match: ['coffee', 'kaapi'],
      noun: 'roasted brown coffee beans' },
    { match: ['coconut', 'thengai'],
      noun: 'white grated coconut' },
    { match: ['tamarind', 'puli'],
      noun: 'dark brown tamarind pulp' },
    { match: ['honey'],
      noun: 'golden honey' },
    { match: ['ghee'],
      noun: 'golden clarified butter' },
    { match: ['oil', 'ennei'],
      noun: 'golden cooking oil' },
    { match: ['biscuit', 'cookie'],
      noun: 'golden-brown biscuits' },
    { match: ['snack', 'namkeen', 'mixture'],
      noun: 'crunchy Indian savoury snack mix' },
    { match: ['noodle', 'pasta'],
      noun: 'curly noodles' },
    { match: ['soap'],
      noun: 'cream-white soap bar' },
    { match: ['detergent'],
      noun: 'white laundry powder' }
  ];

  function findProductNoun(productName) {
    const lower = productName.toLowerCase();
    for (const entry of PRODUCT_NOUNS) {
      for (const key of entry.match) {
        if (lower.indexOf(key) !== -1) return entry.noun;
      }
    }
    // Generic fallback
    return 'the product ' + productName.toLowerCase();
  }

  /* ============================================================
     SUBTITLE MAP — auto-picks subtitle from product type
     ============================================================ */
  function pickSubtitle(productName) {
    const lower = productName.toLowerCase();
    if (lower.indexOf('rice') !== -1 || lower.indexOf('basmati') !== -1) return 'PREMIUM LONG GRAIN';
    if (lower.indexOf('dal') !== -1 || lower.indexOf('lentil') !== -1) return 'PREMIUM QUALITY';
    if (lower.indexOf('flour') !== -1 || lower.indexOf('atta') !== -1 || lower.indexOf('maida') !== -1) return '100% NATURAL';
    if (lower.indexOf('spice') !== -1 || lower.indexOf('masala') !== -1 || lower.indexOf('powder') !== -1) return '100% NATURAL';
    if (lower.indexOf('oil') !== -1 || lower.indexOf('ghee') !== -1) return 'PURE & REFINED';
    if (lower.indexOf('tea') !== -1 || lower.indexOf('coffee') !== -1) return 'PREMIUM BLEND';
    if (lower.indexOf('nut') !== -1 || lower.indexOf('cashew') !== -1 || lower.indexOf('almond') !== -1) return 'PREMIUM QUALITY';
    if (lower.indexOf('salt') !== -1 || lower.indexOf('sugar') !== -1) return 'PURE & NATURAL';
    return '100% NATURAL';
  }

  /* ============================================================
     WEIGHT DETECTION — from the editor's weight field
     ============================================================ */
  function getWeight() {
    const el = document.getElementById('pWeight');
    if (!el) return '1 kg';
    const v = (el.value || '').trim();
    if (!v) return '1 kg';
    // Normalize: 1kg → 1 kg, 500g → 500 g
    return v.replace(/^(\d+)\s*(kg|g|gm|ml|l)$/i, '$1 $2');
  }

  /* ============================================================
     PROMPT BUILDER — uses user's template
     ============================================================ */
  function buildPrompt(productName) {
    const split = splitBrandAndProduct(productName);
    const brand = split.brand;
    const product = split.product;
    const productNoun = findProductNoun(product);
    const subtitle = pickSubtitle(product);
    const weight = getWeight();

    const prompt =
      'Professional studio product photography of a modern Indian grocery stand-up pouch packaging mockup, ' +
      'centered on a clean white surface with soft studio lighting. ' +

      'Packaging Design Details: ' +
      '- Type: Matte finish stand-up pouch bag with top zip-lock seal and blue side-edge accents. ' +
      '- Color Scheme: Cream/off-white main body, deep royal blue accents, and subtle gold border trim. ' +
      '- Front Window: A central rectangular transparent window framed by delicate gold traditional motifs, ' +
      'clearly displaying the product inside: ' + productNoun + '. ' +
      '- Illustration: Beneath the window, an elegant blue and gold line art illustration of rolling fields ' +
      'and mountain peaks with wheat stalks. ' +
      '- Details: Authentic green vegetarian dot-in-a-square logo printed neatly on the bottom right. ' +
      '- Typography: Clean, elegant serif and sans-serif typography in deep blue and gold. ' +

      'Text on pack: ' +
      '- Brand/Header: "' + brand + '" ' +
      '- Product Name: "' + product.toUpperCase() + '" ' +
      '- Subtitle: "' + subtitle + '" ' +
      '- Weight: "' + weight + '" ' +
      '- Bottom text: "PREMIUM QUALITY • HYGIENICALLY PACKED • NATURALLY SELECTED" ' +

      'High resolution, photorealistic, commercial FMCG retail product mockup, 8k.';

    return {
      prompt: prompt,
      brand: brand,
      product: product,
      productNoun: productNoun,
      subtitle: subtitle,
      weight: weight
    };
  }

  /* ============================================================
     POLLINATIONS CALL
     ============================================================ */
  async function generateViaPollinations(prompt, options) {
    const opts = options || {};
    const width = opts.width || 900;
    const height = opts.height || 900;
    const seed = opts.seed || Math.floor(Math.random() * 1e9);
    const model = opts.model || 'flux';

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

    console.log('[AI image] generating — URL length:', url.length);
    console.log('[AI image] model:', model, 'seed:', seed);

    const resp = await fetch(url, { mode: 'cors' });
    if (!resp.ok) throw new Error('Pollinations HTTP ' + resp.status);

    const blob = await resp.blob();
    if (!blob || !blob.size) throw new Error('Empty image');
    if (blob.type && blob.type.indexOf('image/') !== 0) {
      throw new Error('Not an image: ' + blob.type);
    }

    return blob;
  }

  async function generateViaProxy(prompt, options) {
    const opts = options || {};
    const width = opts.width || 900;
    const height = opts.height || 900;
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
    if (!resp.ok) throw new Error('Proxy HTTP ' + resp.status);

    return await resp.blob();
  }

  /* ============================================================
     UPLOAD
     ============================================================ */
  async function uploadBlob(blob) {
    if (!window.db) throw new Error('Supabase not available');

    if (window.MultiSizeUploader && typeof window.MultiSizeUploader.uploadAll === 'function') {
      const r = await window.MultiSizeUploader.uploadAll(blob, 'product-images', 'products');
      return r.url;
    }

    let compressed = blob;
    if (window.ImageCompressor) {
      compressed = await window.ImageCompressor.compressToWebP(blob, {
        maxSize: 900,
        quality: 0.82,
        targetBytes: 20000,
        minQuality: 0.5
      });
    }

    const fname = 'products/ai-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.webp';

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

    const built = buildPrompt(productName.trim());
    console.log('[AI image] brand:', built.brand);
    console.log('[AI image] product:', built.product);
    console.log('[AI image] noun:', built.productNoun);
    console.log('[AI image] subtitle:', built.subtitle);
    console.log('[AI image] weight:', built.weight);

    let blob = null;
    try {
      blob = await generateViaPollinations(built.prompt, options);
    } catch (err) {
      console.warn('[AI image] direct failed, trying proxy:', err.message);
      blob = await generateViaProxy(built.prompt, options);
    }

    if (!blob) throw new Error('AI generation failed');

    const url = await uploadBlob(blob);
    return {
      url: url,
      source: 'pollinations',
      prompt: built.prompt,
      meta: built
    };
  }

  /* ============================================================
     BUTTON HANDLER
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
    btn.innerHTML = '✨ Generating...';

    try {
      const result = await generateProductImage(query, {
        width: 900,
        height: 900,
        style: 'clean'
      });

      if (window.__productsState) window.__productsState.editorImageUrl = result.url;
      const preview = document.getElementById('uploadPreviewImg');
      const prevWrap = document.getElementById('uploadPreview');
      const zone = document.getElementById('uploadZone');
      if (preview) preview.src = result.url;
      if (prevWrap) prevWrap.classList.remove('hidden');
      if (zone) zone.classList.add('hidden');

      toast('Pack mockup generated ✓ (' + result.meta.brand + ')', 'success');
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
    buildPrompt: buildPrompt,
    splitBrandAndProduct: splitBrandAndProduct,
    findProductNoun: findProductNoun,
    pickSubtitle: pickSubtitle,
    KNOWN_BRANDS: KNOWN_BRANDS,
    PRODUCT_NOUNS: PRODUCT_NOUNS
  };
})();
