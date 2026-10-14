/* ============================================================
   CENTRAL & STORES — HARD-MODE INDIAN BRAND SUGGESTIONS
   ------------------------------------------------------------
   Only these brands are allowed for Open Food Facts lookup.
   Sourced from Open Food Facts India top-coverage brands.

   PUBLIC API (window.IndianBrands)
     list()               → array of canonical brand names
     resolve(input)       → canonical brand name or null
     suggest(query)       → array of brand names matching query
     validate(productName)→ { valid, brand, message }

   DEPENDS ON: nothing
   USED BY: admin-products.js, admin-off-query.js
   ============================================================ */

(function () {
  'use strict';

  const VERIFIED_BRANDS = [
    // Top 10 by product count in OFF India
    { name: 'Britannia',    aliases: ['britannia', 'brit'] },
    { name: 'Amul',         aliases: ['amul'] },
    { name: 'Parle',        aliases: ['parle', 'parle-g', 'parle g'] },
    { name: 'Cadbury',      aliases: ['cadbury', 'dairy milk'] },
    { name: "Haldiram's",   aliases: ['haldiram', 'haldirams'] },
    { name: 'Sunfeast',     aliases: ['sunfeast', 'sun feast'] },
    { name: 'Good Life',    aliases: ['good life', 'reliance good life'] },
    { name: 'Maggi',        aliases: ['maggi', 'maggi noodles'] },
    { name: 'Dabur',        aliases: ['dabur'] },
    { name: 'Nestle',       aliases: ['nestle', 'nescafe'] },

    // Other confirmed brands
    { name: 'Aashirvaad',   aliases: ['aashirvaad', 'ashirwad', 'aashirwad'] },
    { name: 'Patanjali',    aliases: ['patanjali'] },
    { name: 'ITC',          aliases: ['itc'] },
    { name: 'Tata',         aliases: ['tata', 'tata salt', 'tata tea'] },
    { name: 'Everest',      aliases: ['everest'] },
    { name: 'MDH',          aliases: ['mdh'] },
    { name: 'Catch',        aliases: ['catch'] },
    { name: 'Fortune',      aliases: ['fortune'] },
    { name: 'Saffola',      aliases: ['saffola'] },
    { name: 'Mother Dairy', aliases: ['mother dairy'] },
    { name: 'Kissan',       aliases: ['kissan'] },
    { name: 'Bru',          aliases: ['bru'] },
    { name: 'Red Label',    aliases: ['red label', 'brooke bond'] },
    { name: 'Taj Mahal',    aliases: ['taj mahal'] },
    { name: 'Horlicks',     aliases: ['horlicks'] },
    { name: 'Bournvita',    aliases: ['bournvita'] },
    { name: 'Boost',        aliases: ['boost'] },
    { name: 'Complan',      aliases: ['complan'] },
    { name: 'Kelloggs',     aliases: ['kelloggs', "kellogg's"] }
  ];

  // Alias → canonical map
  const ALIAS_TO_BRAND = {};
  VERIFIED_BRANDS.forEach(function (b) {
    ALIAS_TO_BRAND[b.name.toLowerCase()] = b.name;
    b.aliases.forEach(function (a) {
      ALIAS_TO_BRAND[a.toLowerCase()] = b.name;
    });
  });

  function list() {
    return VERIFIED_BRANDS.map(function (b) { return b.name; });
  }

  function resolve(input) {
    if (!input) return null;
    const lower = String(input).toLowerCase().trim();

    if (ALIAS_TO_BRAND[lower]) return ALIAS_TO_BRAND[lower];

    for (const alias in ALIAS_TO_BRAND) {
      if (lower.startsWith(alias)) return ALIAS_TO_BRAND[alias];
    }

    return null;
  }

  function suggest(query) {
    if (!query || query.length < 2) return [];
    const lower = query.toLowerCase();
    const matches = [];

    VERIFIED_BRANDS.forEach(function (b) {
      const nameLower = b.name.toLowerCase();
      let matched = nameLower.indexOf(lower) !== -1;
      if (!matched) {
        matched = b.aliases.some(function (a) { return a.indexOf(lower) !== -1; });
      }
      if (matched) matches.push(b.name);
    });

    return matches.slice(0, 8);
  }

  function validate(productName) {
    const resolved = resolve(productName);
    return {
      valid: !!resolved,
      brand: resolved,
      message: resolved
        ? 'Verified brand: ' + resolved
        : 'Only verified Indian brands can be auto-generated. Use phone photo for this product.'
    };
  }

  window.IndianBrands = {
    list: list,
    resolve: resolve,
    suggest: suggest,
    validate: validate
  };
})();