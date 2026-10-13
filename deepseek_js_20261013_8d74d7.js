/* ============================================================
   CENTRAL & STORES — BULK PRODUCT IMPORT
   ------------------------------------------------------------
   Paste CSV or upload a .csv file. Imports up to thousands of
   products. Auto-scrapes images for rows without an image_url.

   DEPENDS ON
     • admin-core.js
     • admin-image-scraper.js (optional — for auto image)
     • admin-image-compressor.js (optional — for compression)

   PUBLIC API
     window.openBulkImport()
   ============================================================ */

(function () {
  'use strict';

  const toast = window.AdminCore ? window.AdminCore.toast : function () {};
  const esc = window.AdminCore ? window.AdminCore.esc : (s) => String(s);

  const BATCH_SIZE = 50;
  const SCRAPE_DELAY_MS = 300; // polite delay between scrapes

  const state = {
    rows: [],
    validRows: [],
    invalidRows: [],
    importing: false,
    imported: 0,
    failed: 0,
    skipped: 0
  };

  /* ============================================================
     CSV PARSER (handles quotes, newlines, commas inside quotes)
     ============================================================ */
  function parseCSV(text) {
    const rows = [];
    let row = [];
    let field = '';
    let inQuotes = false;

    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      const next = text[i + 1];

      if (inQuotes) {
        if (c === '"' && next === '"') { field += '"'; i++; }
        else if (c === '"') { inQuotes = false; }
        else { field += c; }
      } else {
        if (c === '"') { inQuotes = true; }
        else if (c === ',') { row.push(field); field = ''; }
        else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
        else if (c === '\r') { /* skip */ }
        else { field += c; }
      }
    }
    if (field || row.length) { row.push(field); rows.push(row); }
    return rows;
  }

  /* ============================================================
     ROW → OBJECT
     ============================================================ */
  function rowsToObjects(rows) {
    if (!rows.length) return [];
    const headers = rows[0].map((h) => h.trim().toLowerCase().replace(/\s+/g, '_'));
    const data = [];
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      if (!r || !r.length || !r[0]) continue;
      const obj = {};
      headers.forEach((h, idx) => { obj[h] = (r[idx] || '').trim(); });
      obj._rowNumber = i + 1;
      data.push(obj);
    }
    return data;
  }

  /* ============================================================
     VALIDATION
     ============================================================ */
  function validateRow(row) {
    const errors = [];
    if (!row.name) errors.push('name is required');
    if (!row.category) errors.push('category is required');
    const price = parseFloat(row.price);
    if (isNaN(price) || price < 0) errors.push('price must be a positive number');
    return errors;
  }

  /* ============================================================
     OPEN MODAL
     ============================================================ */
  function openBulkImport() {
    // Prevent double-open
    if (document.getElementById('bulkImportModal')) return;

    const modal = document.createElement('div');
    modal.id = 'bulkImportModal';
    modal.className = 'modal-overlay open';
    modal.innerHTML =
      '<div class="modal modal-xl" role="dialog" aria-modal="true">' +
        '<h3>Bulk Import Products</h3>' +
        '<p>Paste CSV or upload a file. Rows without an image are auto-scraped.</p>' +

        '<div style="margin-bottom:16px">' +
          '<button class="btn btn-secondary btn-sm" id="biSampleBtn" style="margin-right:8px">Load Sample CSV</button>' +
          '<label class="btn btn-secondary btn-sm" style="cursor:pointer">' +
            '<input type="file" id="biFileInput" accept=".csv,text/csv" hidden style="display:none">' +
            '📁 Upload CSV' +
          '</label>' +
        '</div>' +

        '<div class="field">' +
          '<label for="biTextarea">Paste CSV here</label>' +
          '<textarea id="biTextarea" rows="8" ' +
            'placeholder="name,category,price,weight,description,image_url&#10;' +
            'Basmati Rice,Groceries,120,1 kg,Premium long grain,&#10;' +
            'Toor Dal,Pulses,145,1 kg,Fresh dal," +
          '"></textarea>' +
          '<div class="field-hint">Header row required. Columns: name, category, price, weight, description, image_url</div>' +
        '</div>' +

        '<div id="biPreview" style="margin-top:16px;display:none">' +
          '<div class="form-section-head" style="margin-top:0">Preview</div>' +
          '<div id="biPreviewStats" style="margin-bottom:12px;font-size:.875rem"></div>' +
          '<div id="biPreviewTable" style="max-height:280px;overflow:auto;border:1px solid var(--gray-200);border-radius:8px"></div>' +
        '</div>' +

        '<div id="biProgress" style="display:none;margin-top:16px">' +
          '<div class="form-section-head" style="margin-top:0">Progress</div>' +
          '<div style="background:var(--gray-100);height:12px;border-radius:8px;overflow:hidden;margin-bottom:10px">' +
            '<div id="biProgressBar" style="height:100%;width:0%;background:var(--gold);transition:width .3s"></div>' +
          '</div>' +
          '<div id="biLog" style="font-family:monospace;font-size:.75rem;background:var(--gray-50);padding:10px;border-radius:8px;max-height:180px;overflow:auto;white-space:pre-wrap"></div>' +
        '</div>' +

        '<div class="modal-actions" style="margin-top:20px">' +
          '<button class="btn btn-secondary" id="biCancelBtn" type="button">Cancel</button>' +
          '<button class="btn btn-primary" id="biParseBtn" type="button">Preview</button>' +
          '<button class="btn btn-gold" id="biImportBtn" type="button" style="display:none">Start Import</button>' +
        '</div>' +
      '</div>';

    document.body.appendChild(modal);
    document.body.style.overflow = 'hidden';

    const close = function () {
      if (state.importing) return;
      modal.remove();
      document.body.style.overflow = '';
      state.rows = []; state.validRows = []; state.invalidRows = [];
      state.imported = 0; state.failed = 0; state.skipped = 0;
    };

    document.getElementById('biCancelBtn').addEventListener('click', close);
    modal.addEventListener('click', function (e) { if (e.target === modal) close(); });

    // Sample CSV
    document.getElementById('biSampleBtn').addEventListener('click', function () {
      document.getElementById('biTextarea').value =
        'name,category,price,weight,description,image_url\n' +
        'Basmati Rice,Groceries,120,1 kg,Premium long grain,\n' +
        'Toor Dal,Pulses,145,1 kg,Fresh dal,\n' +
        'Aachi Sambar Powder,Masalas,85,100 g,Authentic taste,\n' +
        'Tata Salt,Groceries,28,1 kg,Iodized,\n' +
        'Amul Butter,Dairy,55,500 g,Creamy butter,';
    });

    // File upload
    document.getElementById('biFileInput').addEventListener('change', function (e) {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = function (evt) {
        document.getElementById('biTextarea').value = evt.target.result;
        toast('CSV loaded — click Preview');
      };
      reader.readAsText(file);
    });

    // Preview
    document.getElementById('biParseBtn').addEventListener('click', parseAndPreview);

    // Import
    document.getElementById('biImportBtn').addEventListener('click', runImport);
  }

  /* ============================================================
     PARSE + PREVIEW
     ============================================================ */
  function parseAndPreview() {
    const text = (document.getElementById('biTextarea').value || '').trim();
    if (!text) { toast('Paste or upload CSV first', 'error'); return; }

    const rows = parseCSV(text);
    if (rows.length < 2) { toast('CSV must have a header row + at least one data row', 'error'); return; }

    const objects = rowsToObjects(rows);
    state.rows = objects;
    state.validRows = [];
    state.invalidRows = [];

    objects.forEach(function (row) {
      const errors = validateRow(row);
      if (errors.length) {
        row._errors = errors;
        state.invalidRows.push(row);
      } else {
        state.validRows.push(row);
      }
    });

    // Show preview
    const preview = document.getElementById('biPreview');
    preview.style.display = '';

    const stats = document.getElementById('biPreviewStats');
    stats.innerHTML =
      '<strong style="color:var(--success)">' + state.validRows.length + ' valid</strong>' +
      (state.invalidRows.length ? ' · <strong style="color:var(--danger)">' + state.invalidRows.length + ' invalid</strong>' : '') +
      ' · <span class="text-muted">Total: ' + state.rows.length + '</span>';

    const allRows = state.validRows.concat(state.invalidRows);
    const html =
      '<table style="width:100%;border-collapse:collapse;font-size:.8125rem">' +
        '<thead><tr style="background:var(--gray-50);position:sticky;top:0">' +
          '<th style="padding:8px;text-align:left;border-bottom:1px solid var(--gray-200)">#</th>' +
          '<th style="padding:8px;text-align:left;border-bottom:1px solid var(--gray-200)">Name</th>' +
          '<th style="padding:8px;text-align:left;border-bottom:1px solid var(--gray-200)">Category</th>' +
          '<th style="padding:8px;text-align:right;border-bottom:1px solid var(--gray-200)">Price</th>' +
          '<th style="padding:8px;text-align:left;border-bottom:1px solid var(--gray-200)">Weight</th>' +
          '<th style="padding:8px;text-align:left;border-bottom:1px solid var(--gray-200)">Status</th>' +
        '</tr></thead>' +
        '<tbody>' +
          allRows.slice(0, 100).map(function (r) {
            const err = r._errors && r._errors.length;
            return '<tr style="' + (err ? 'background:#fdf6f6' : '') + '">' +
              '<td style="padding:6px 8px;border-bottom:1px solid var(--gray-100)">' + r._rowNumber + '</td>' +
              '<td style="padding:6px 8px;border-bottom:1px solid var(--gray-100)">' + esc(r.name || '—') + '</td>' +
              '<td style="padding:6px 8px;border-bottom:1px solid var(--gray-100)">' + esc(r.category || '—') + '</td>' +
              '<td style="padding:6px 8px;border-bottom:1px solid var(--gray-100);text-align:right">' + esc(r.price || '—') + '</td>' +
              '<td style="padding:6px 8px;border-bottom:1px solid var(--gray-100)">' + esc(r.weight || '') + '</td>' +
              '<td style="padding:6px 8px;border-bottom:1px solid var(--gray-100)">' +
                (err ? '<span class="badge badge-red">' + esc(r._errors.join(', ')) + '</span>'
                     : '<span class="badge badge-green">OK</span>') +
              '</td>' +
            '</tr>';
          }).join('') +
        '</tbody>' +
      '</table>' +
      (allRows.length > 100 ? '<div class="text-muted" style="padding:8px;text-align:center">Showing first 100 of ' + allRows.length + '</div>' : '');

    document.getElementById('biPreviewTable').innerHTML = html;

    if (state.validRows.length > 0) {
      document.getElementById('biImportBtn').style.display = '';
      document.getElementById('biImportBtn').textContent = 'Start Import (' + state.validRows.length + ')';
    } else {
      document.getElementById('biImportBtn').style.display = 'none';
    }
  }

  /* ============================================================
     IMPORT
     ============================================================ */
  async function runImport() {
    if (state.importing) return;
    if (!window.db) { toast('Not connected', 'error'); return; }
    if (state.validRows.length === 0) { toast('No valid rows', 'error'); return; }

    state.importing = true;
    state.imported = 0;
    state.failed = 0;
    state.skipped = 0;

    const importBtn = document.getElementById('biImportBtn');
    const cancelBtn = document.getElementById('biCancelBtn');
    importBtn.disabled = true;
    cancelBtn.disabled = true;

    document.getElementById('biProgress').style.display = '';
    const log = document.getElementById('biLog');
    const bar = document.getElementById('biProgressBar');
    log.textContent = '';

    const total = state.validRows.length;
    let processed = 0;

    function logLine(msg) {
      log.textContent += msg + '\n';
      log.scrollTop = log.scrollHeight;
    }

    function updateProgress() {
      bar.style.width = Math.round((processed / total) * 100) + '%';
    }

    logLine('Starting import of ' + total + ' products…');
    logLine('Fetching existing product names to skip duplicates…');

    // Fetch existing product names for duplicate detection
    let existingNames = new Set();
    try {
      const { data } = await window.db.from('products').select('name').is('deleted_at', null);
      (data || []).forEach(function (p) { existingNames.add((p.name || '').toLowerCase().trim()); });
      logLine('Found ' + existingNames.size + ' existing products.');
    } catch (e) {
      logLine('Warning: could not fetch existing products — duplicates may be created.');
    }

    // Process in batches
    for (let i = 0; i < total; i += BATCH_SIZE) {
      const batch = state.validRows.slice(i, i + BATCH_SIZE);

      for (const row of batch) {
        processed++;
        const lowerName = (row.name || '').toLowerCase().trim();

        if (existingNames.has(lowerName)) {
          state.skipped++;
          logLine('⏭ Skipped (duplicate): ' + row.name);
          updateProgress();
          continue;
        }

        try {
          let imageUrl = row.image_url || '';

          // Auto-scrape if no image provided
          if (!imageUrl && window.ImageScraper && typeof window.ImageScraper.findProductImage === 'function') {
            try {
              logLine('🔍 Scraping image for: ' + row.name);
              const scraped = await window.ImageScraper.findProductImage(row.name, { include_image: true });
              if (scraped && scraped.success) {
                // Download, compress, upload
                let blob;
                if (scraped.imageB64) {
                  const chars = atob(scraped.imageB64);
                  const bytes = new Uint8Array(chars.length);
                  for (let j = 0; j < chars.length; j++) bytes[j] = chars.charCodeAt(j);
                  blob = new Blob([bytes], { type: scraped.mime || 'image/jpeg' });
                } else if (scraped.imageUrl) {
                  const r = await fetch(scraped.imageUrl, { mode: 'cors' });
                  blob = await r.blob();
                }

                if (blob && window.ImageScraper.uploadBlob) {
                  imageUrl = await window.ImageScraper.uploadBlob(blob);
                } else if (scraped.imageUrl) {
                  imageUrl = scraped.imageUrl;
                }
              }
            } catch (scrapeErr) {
              logLine('  ⚠ Scrape failed — will import without image');
            }
            await new Promise((r) => setTimeout(r, SCRAPE_DELAY_MS));
          }

          const payload = {
            name: row.name,
            category: row.category,
            price: parseFloat(row.price),
            weight: row.weight || '',
            description: row.description || '',
            image_url: imageUrl || null,
            is_available: true,
            is_published: true,
            is_featured: false
          };

          const { error } = await window.db.from('products').insert(payload);

          if (error) {
            logLine('✗ Failed: ' + row.name + ' — ' + error.message);
            state.failed++;
          } else {
            logLine('✓ Imported: ' + row.name + (imageUrl ? ' [with image]' : ''));
            state.imported++;
            existingNames.add(lowerName);
          }
        } catch (err) {
          logLine('✗ Error: ' + row.name + ' — ' + (err.message || 'Unknown'));
          state.failed++;
        }

        updateProgress();
      }

      // Small delay between batches
      await new Promise((r) => setTimeout(r, 300));
    }

    logLine('');
    logLine('=== DONE ===');
    logLine('Imported: ' + state.imported);
    logLine('Skipped:  ' + state.skipped);
    logLine('Failed:   ' + state.failed);

    toast(
      'Import complete — ' + state.imported + ' imported, ' + state.skipped + ' skipped, ' + state.failed + ' failed',
      state.failed > 0 ? 'warning' : 'success'
    );

    state.importing = false;
    importBtn.disabled = false;
    cancelBtn.disabled = false;
    importBtn.textContent = 'Close';
    importBtn.onclick = function () {
      const m = document.getElementById('bulkImportModal');
      if (m) m.remove();
      document.body.style.overflow = '';
      if (typeof window.loadProducts === 'function') window.loadProducts();
    };
  }

  /* ============================================================
     WIRE BUTTON
     ============================================================ */
  function wire() {
    const btn = document.getElementById('bulkImportBtn');
    if (!btn || btn.dataset.wired === '1') return;
    btn.dataset.wired = '1';
    btn.addEventListener('click', openBulkImport);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wire, { once: true });
  } else {
    wire();
  }

  const observer = new MutationObserver(wire);
  if (document.body) observer.observe(document.body, { childList: true, subtree: true });

  window.openBulkImport = openBulkImport;
})();