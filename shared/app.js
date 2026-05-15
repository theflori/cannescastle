// deploy-marker 1778406072
// Shared utilities — all wrapped in IIFE to prevent global pollution.
// Only `window.ChateauApp` is exposed.

(function() {
  async function injectSidebar(activePage) {
    try {
      const res = await fetch('/shared/sidebar.html');
      if (!res.ok) throw new Error('Sidebar fetch failed');
      const html = await res.text();
      document.body.insertAdjacentHTML('afterbegin', html);
      document.querySelectorAll('.sidebar-link').forEach(link => {
        if (link.dataset.page === activePage) link.classList.add('active');
      });
      const logoutBtn = document.getElementById('logoutBtn');
      if (logoutBtn) {
        logoutBtn.addEventListener('click', async () => {
          try { await fetch('/api/logout', { method: 'POST' }); } catch {}
          window.location.href = '/login';
        });
      }
      const mobileBtn = document.getElementById('mobileMenuBtn');
      if (mobileBtn) {
        mobileBtn.addEventListener('click', () => {
          document.getElementById('sidebar').classList.toggle('open');
        });
      }
      document.addEventListener('click', e => {
        const sidebar = document.getElementById('sidebar');
        const btn = document.getElementById('mobileMenuBtn');
        if (sidebar && sidebar.classList.contains('open') &&
            !sidebar.contains(e.target) && !(btn && btn.contains(e.target))) {
          sidebar.classList.remove('open');
        }
      });
    } catch (err) {
      console.error('Sidebar inject failed', err);
    }
  }

  function showToast(msg, type) {
    let t = document.getElementById('toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'toast';
      t.className = 'toast';
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.className = 'toast show ' + (type || '');
    clearTimeout(window._toastTimer);
    window._toastTimer = setTimeout(() => t.classList.remove('show'), 3500);
  }

  async function authFetch(url, opts) {
    const res = await fetch(url, opts || {});
    if (res.status === 401) {
      window.location.href = '/login';
      throw new Error('Unauthorized');
    }
    return res;
  }

  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function escapeAttr(str) { return escapeHtml(str); }

  function formatNumber(n) {
    if (n === null || n === undefined) return '—';
    if (n >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
    if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
    return n.toString();
  }

  function formatDate(iso) {
    try {
      const d = new Date(iso);
      const now = new Date();
      const diff = now - d;
      const days = Math.floor(diff / (1000 * 60 * 60 * 24));
      if (days === 0) return 'Today';
      if (days === 1) return 'Yesterday';
      if (days < 7) return days + 'd ago';
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    } catch { return ''; }
  }


  // ============== FIT INDICATOR ==============
  // 4-dot bar showing how good a fit a guest is for the event.
  // Start: 4 dots. Penalties:
  //   - Followers < 6K: -1
  //   - Followers < 1K: extra -1
  //   - Private IG account: -1
  //   - No IG handle: -2
  // Colors: 4/4 + 3/4 = green, 2/4 = orange, 1/4 or lower = yellow.
  function computeFitScore(guest) {
    let score = 4;
    const reasons = [];
    const followers = (guest.igFollowers !== null && guest.igFollowers !== undefined) ? guest.igFollowers : null;
    const isPrivate = guest.igIsPrivate === true;
    const hasHandle = !!(guest.instagram && guest.instagram.trim());

    if (!hasHandle) {
      score -= 2;
      reasons.push('No IG handle');
    } else {
      if (followers === null) {
        score -= 1;
        reasons.push('Followers unknown');
      } else {
        if (followers < 6000) {
          score -= 1;
          reasons.push('Followers < 6K');
        }
        if (followers < 1000) {
          score -= 1;
          reasons.push('Followers < 1K');
        }
      }
      if (isPrivate) {
        score -= 1;
        reasons.push('Private account');
      }
    }
    if (score < 0) score = 0;
    return { score, reasons };
  }

  function fitTier(score) {
    if (score >= 3) return 'good';   // 4/4 or 3/4
    if (score === 2) return 'medium';
    return 'weak';                    // 1/4 or 0/4
  }

  function fitLabel(score) {
    if (score === 4) return 'Top fit';
    if (score === 3) return 'Good fit';
    if (score === 2) return 'Mid';
    if (score === 1) return 'Weak';
    return 'Poor';
  }

  function renderFitIndicator(guest) {
    const { score, reasons } = computeFitScore(guest);
    const tier = fitTier(score);
    let tip = 'Fit: ' + fitLabel(score) + ' (' + score + '/4)';
    if (reasons.length) tip += ' — ' + reasons.join(', ');

    const dots = [];
    for (let i = 0; i < 4; i++) {
      const active = i < score;
      dots.push('<span class="fit-dot ' + (active ? 'active tier-' + tier : '') + '"></span>');
    }
    return '<span class="fit-indicator" title="' + tip.replace(/"/g, '&quot;') + '" data-fit-tier="' + tier + '">' + dots.join('') + '</span>';
  }

  // ============== CSV EXPORT ==============
  // exportToCsv(rows, columns, filename)
  //   rows:     array of objects (each row)
  //   columns:  array of { key, label } — `key` indexes the row object,
  //             `label` is the column header text in the CSV
  //   filename: e.g. 'guests-2026-05-15.csv'
  //
  // Cells are CSV-escaped (RFC 4180): quotes doubled, comma/newline/quote → wrapped.
  // Excel-friendly: prepends BOM so umlauts/emoji aren't garbled in Excel on Windows.
  function exportToCsv(rows, columns, filename) {
    const esc = (val) => {
      if (val == null) return '';
      const s = Array.isArray(val) ? val.join('; ') : String(val);
      // Always quote — safest and handles all special chars
      return '"' + s.replace(/"/g, '""') + '"';
    };

    const header = columns.map(c => esc(c.label)).join(',');
    const body = rows.map(row =>
      columns.map(c => {
        const v = typeof c.format === 'function' ? c.format(row[c.key], row) : row[c.key];
        return esc(v);
      }).join(',')
    ).join('\r\n');

    const csv = '\uFEFF' + header + '\r\n' + body;
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  window.ChateauApp = {
    injectSidebar: injectSidebar,
    showToast: showToast,
    authFetch: authFetch,
    escapeHtml: escapeHtml,
    escapeAttr: escapeAttr,
    formatNumber: formatNumber,
    formatDate: formatDate,
    computeFitScore: computeFitScore,
    renderFitIndicator: renderFitIndicator,
    fitLabel: fitLabel,
    fitTier: fitTier,
    exportToCsv: exportToCsv
  };
})();

// ============== REJECT CONFIRMATION MODAL ==============
// Promise-based modal for confirming destructive reject action.
// Usage: const ok = await showRejectModal({ name, status });
function showRejectModal({ name, status }) {
  return new Promise((resolve) => {
    // Build modal if not present
    let modal = document.getElementById('rejectConfirmModal');
    if (modal) modal.remove();

    modal = document.createElement('div');
    modal.id = 'rejectConfirmModal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(15,12,9,0.65);z-index:10000;display:flex;align-items:center;justify-content:center;padding:24px;animation:fadeIn 0.15s ease';
    modal.innerHTML = `
      <div style="background:#fff;width:100%;max-width:480px;border-radius:8px;box-shadow:0 24px 64px rgba(0,0,0,0.4);overflow:hidden;animation:slideUp 0.2s ease">
        <div style="padding:24px 28px 20px;border-bottom:1px solid #eaeae0;display:flex;align-items:flex-start;gap:14px">
          <div style="flex-shrink:0;width:38px;height:38px;border-radius:50%;background:rgba(196,84,74,0.12);display:flex;align-items:center;justify-content:center">
            <svg viewBox="0 0 24 24" fill="none" stroke="#c4544a" stroke-width="2" style="width:20px;height:20px"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          </div>
          <div>
            <h2 style="margin:0 0 4px;font-family:'Inter',sans-serif;font-size:17px;font-weight:600;color:#1a1814">Reject ${escapeHtmlSafe(name)}?</h2>
            <p style="margin:0;font-size:13px;color:#6b6b66;line-height:1.5">Currently: <strong style="color:#1a1814">${escapeHtmlSafe(status || 'unknown')}</strong></p>
          </div>
        </div>

        <div style="padding:20px 28px 8px;font-size:13px;line-height:1.6;color:#1a1814">
          <p style="margin:0 0 12px">This action will:</p>
          <ul style="margin:0 0 16px;padding-left:18px;color:#4a4843">
            <li style="margin-bottom:4px">Send an <strong>apology email</strong> (capacity-based wording)</li>
            <li style="margin-bottom:4px">Send an <strong>apology SMS</strong> (DE numbers only)</li>
            <li>Set their status to <strong>Declined</strong></li>
          </ul>
          <div style="padding:10px 12px;background:rgba(196,84,74,0.08);border-left:3px solid #c4544a;font-size:12px;color:#8a3f33;line-height:1.5;margin-bottom:8px">
            <strong>This cannot be auto-reversed.</strong> They will receive a message immediately.
          </div>
        </div>

        <div style="padding:16px 28px 22px;display:flex;align-items:center;justify-content:flex-end;gap:8px;background:#fafaf7;border-top:1px solid #eaeae0">
          <button id="rejectCancelBtn" style="padding:9px 18px;border:1px solid #1a1814;background:#fff;color:#1a1814;font-size:13px;border-radius:4px;cursor:pointer;font-family:Inter,sans-serif">Cancel</button>
          <button id="rejectConfirmBtn" style="padding:9px 18px;border:1px solid #c4544a;background:#c4544a;color:#fff;font-size:13px;border-radius:4px;cursor:pointer;font-family:Inter,sans-serif;font-weight:500">Yes, reject ${escapeHtmlSafe((name || '').split(' ')[0] || 'guest')}</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    // Make sure animations exist
    if (!document.getElementById('rejectModalKeyframes')) {
      const style = document.createElement('style');
      style.id = 'rejectModalKeyframes';
      style.textContent = '@keyframes fadeIn{from{opacity:0}to{opacity:1}}@keyframes slideUp{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}';
      document.head.appendChild(style);
    }

    function close(result) {
      modal.remove();
      resolve(result);
    }

    document.getElementById('rejectCancelBtn').addEventListener('click', () => close(false));
    document.getElementById('rejectConfirmBtn').addEventListener('click', () => close(true));
    modal.addEventListener('click', (e) => { if (e.target === modal) close(false); });

    // Esc closes
    function onKey(e) {
      if (e.key === 'Escape') {
        document.removeEventListener('keydown', onKey);
        close(false);
      }
    }
    document.addEventListener('keydown', onKey);
  });
}

// Safe escape used by the modal — falls back if escapeHtml isn't loaded
function escapeHtmlSafe(s) {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// ============== A-LIST ALLOWANCE CHIP ==============
// Renders a small chip (+1 / +2 / +3 / OPEN) next to name for A-List guests with allowance > 0.
function renderAllowanceChip(guest) {
  if (!guest || !guest.plusOneAllowance) return '';
  const val = String(guest.plusOneAllowance).toLowerCase();
  if (val === '0' || val === '') return '';
  if (val === 'unlimited') {
    return '<span class="alist-allowance-chip open" title="Open invite — anyone they bring is in">OPEN</span>';
  }
  return '<span class="alist-allowance-chip" title="May bring up to ' + val + ' plus-one' + (val !== '1' ? 's' : '') + '">+' + escapeHtmlSafe(val) + '</span>';
}

// ============== A-LIST DETECTION ==============
// Returns true if guest is A-List. Checks Tags field (if used) OR Source = 'Manual A-List'.
// This dual check makes A-List work even if the Airtable Tags field doesn't exist.
function isAListGuest(g) {
  if (!g) return false;
  if (Array.isArray(g.tags) && g.tags.includes('A-List')) return true;
  if (g.source === 'Manual A-List') return true;
  return false;
}

// ============== IMPORTANCE PILL STYLES ==============
// Returns inline CSS string for an importance pill background/border.
// Used in: scan.html, guests.html, messaging.html.
function importancePillStyle(val) {
  if (val === 'VIP/Car') return 'background:#B8965A;color:#1a1a1a;border:1px solid #a47f3f';
  if (val === 'Tier 1')  return 'background:#e8e8e8;color:#1a1a1a;border:1px solid #bbb';
  if (val === 'Tier 2')  return 'background:#bbb;color:#1a1a1a;border:1px solid #888';
  if (val === 'Tier 3')  return 'background:#555;color:#fff;border:1px solid #333';
  return 'background:transparent;color:#888;border:1px solid #ccc';
}

// ============== BULK SEND MODAL ==============
// Promise-based modal that handles the full lifecycle of a chunked bulk send:
// 1. CONFIRM phase: shows title + body + Cancel/Send buttons
// 2. PROGRESS phase: shows live progress bar with "Batch N of M, sent X of Y"
// 3. DONE phase: shows summary stats + Close button
//
// Usage:
//   const ok = await runBulkSendModal({
//     title: 'Confirm 25 guests?',
//     body: '<p>Each guest will get a confirmation email + SMS.</p>',
//     confirmLabel: 'Send to 25 guests',
//     totalCount: 25,
//     chunkSize: 20,
//     chunkDelayMs: 2000,
//     run: async (slice) => {
//       const res = await authFetch('/api/messaging/confirm', {...});
//       return await res.json(); // { confirmed, emailSent, smsSent, failed: [], skipped: [] }
//     },
//     ids: [...],
//     summaryKeys: [
//       { key: 'confirmed', label: 'confirmed' },
//       { key: 'emailSent', label: 'emails sent' },
//       { key: 'smsSent',   label: 'SMS sent' }
//     ]
//   });
//
// Returns true if user confirmed and run completed (with or without errors),
// false if user cancelled. The caller is responsible for refreshing the UI.

function runBulkSendModal(opts) {
  return new Promise(function(resolve) {
    var existing = document.getElementById('bulkSendModal');
    if (existing) existing.remove();

    var modal = document.createElement('div');
    modal.id = 'bulkSendModal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(15,12,9,0.65);z-index:10000;display:flex;align-items:center;justify-content:center;padding:24px';

    modal.innerHTML =
      '<div style="background:#fff;width:100%;max-width:520px;border-radius:8px;box-shadow:0 24px 64px rgba(0,0,0,0.4);overflow:hidden">' +
        '<div style="padding:24px 28px 18px;border-bottom:1px solid #eaeae0">' +
          '<h2 id="bsmTitle" style="margin:0 0 4px;font-family:Inter,sans-serif;font-size:17px;font-weight:600;color:#1a1814">' + escapeHtmlSafe(opts.title || 'Confirm') + '</h2>' +
          '<p id="bsmSubtitle" style="margin:0;font-size:13px;color:#6b6b66;line-height:1.5"></p>' +
        '</div>' +
        '<div id="bsmBody" style="padding:20px 28px;font-size:13px;line-height:1.6;color:#1a1814;min-height:80px">' +
          (opts.body || '') +
        '</div>' +
        '<div id="bsmFooter" style="padding:16px 28px 22px;display:flex;align-items:center;justify-content:flex-end;gap:8px;background:#fafaf7;border-top:1px solid #eaeae0">' +
          '<button id="bsmCancelBtn" style="padding:9px 18px;border:1px solid #1a1814;background:#fff;color:#1a1814;font-size:13px;border-radius:4px;cursor:pointer;font-family:Inter,sans-serif">Cancel</button>' +
          '<button id="bsmConfirmBtn" style="padding:9px 18px;border:1px solid #1f7a3c;background:#1f7a3c;color:#fff;font-size:13px;border-radius:4px;cursor:pointer;font-family:Inter,sans-serif;font-weight:500">' + escapeHtmlSafe(opts.confirmLabel || 'Send') + '</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(modal);

    var bodyEl     = document.getElementById('bsmBody');
    var subtitleEl = document.getElementById('bsmSubtitle');
    var footerEl   = document.getElementById('bsmFooter');
    var cancelBtn  = document.getElementById('bsmCancelBtn');
    var confirmBtn = document.getElementById('bsmConfirmBtn');

    function close(result) {
      modal.remove();
      resolve(result);
    }

    cancelBtn.addEventListener('click', function() { close(false); });

    // Allow background-click / Esc only during confirm phase
    var allowOutsideClose = true;
    modal.addEventListener('click', function(e) {
      if (allowOutsideClose && e.target === modal) close(false);
    });
    function onKey(e) {
      if (e.key === 'Escape' && allowOutsideClose) {
        document.removeEventListener('keydown', onKey);
        close(false);
      }
    }
    document.addEventListener('keydown', onKey);

    confirmBtn.addEventListener('click', async function() {
      // Switch into progress phase
      allowOutsideClose = false;
      cancelBtn.style.display = 'none';
      confirmBtn.disabled = true;
      confirmBtn.textContent = 'Sending…';
      confirmBtn.style.opacity = '0.6';
      confirmBtn.style.cursor = 'default';

      var total      = opts.totalCount || (opts.ids ? opts.ids.length : 0);
      var chunkSize  = opts.chunkSize || 20;
      var chunkDelay = (typeof opts.chunkDelayMs === 'number') ? opts.chunkDelayMs : 2000;

      subtitleEl.textContent = 'Sending in batches of ' + chunkSize + '…';

      bodyEl.innerHTML =
        '<div id="bsmProgressLabel" style="margin-bottom:10px;font-size:13px;color:#1a1814">Starting…</div>' +
        '<div style="width:100%;height:8px;background:#eaeae0;border-radius:100px;overflow:hidden">' +
          '<div id="bsmProgressBar" style="width:0%;height:100%;background:#1f7a3c;transition:width 0.3s ease"></div>' +
        '</div>' +
        '<div id="bsmRunningStats" style="margin-top:14px;font-size:12px;color:#6b6b66;line-height:1.6"></div>';

      var progressLabel  = document.getElementById('bsmProgressLabel');
      var progressBar    = document.getElementById('bsmProgressBar');
      var runningStatsEl = document.getElementById('bsmRunningStats');

      // Run chunks
      var agg = {};
      var summaryKeys = opts.summaryKeys || [];
      for (var k = 0; k < summaryKeys.length; k++) agg[summaryKeys[k].key] = 0;
      agg._failed = 0;
      agg._skipped = 0;
      agg._chunkErrors = 0;

      var ids = opts.ids || [];

      for (var i = 0; i < ids.length; i += chunkSize) {
        var slice = ids.slice(i, i + chunkSize);
        var from = i + 1;
        var to   = Math.min(i + chunkSize, ids.length);
        progressLabel.textContent = 'Batch ' + (Math.floor(i / chunkSize) + 1) + ' — sending ' + from + '–' + to + ' of ' + ids.length;

        try {
          var data = await opts.run(slice);
          for (var j = 0; j < summaryKeys.length; j++) {
            var sk = summaryKeys[j].key;
            if (typeof data[sk] === 'number') agg[sk] += data[sk];
          }
          if (Array.isArray(data.failed))  agg._failed  += data.failed.length;
          if (Array.isArray(data.skipped)) agg._skipped += data.skipped.length;
        } catch (err) {
          agg._chunkErrors++;
          console.error('Batch failed:', err);
        }

        // Update progress
        var pctDone = Math.min(100, Math.round(((i + chunkSize) / ids.length) * 100));
        progressBar.style.width = pctDone + '%';

        // Running stats line
        var rsParts = [];
        for (var p = 0; p < summaryKeys.length; p++) {
          var key = summaryKeys[p].key;
          if (agg[key] > 0) rsParts.push(agg[key] + ' ' + summaryKeys[p].label);
        }
        if (agg._skipped > 0)     rsParts.push(agg._skipped + ' skipped');
        if (agg._failed > 0)      rsParts.push(agg._failed + ' failed');
        if (agg._chunkErrors > 0) rsParts.push(agg._chunkErrors + ' batch error' + (agg._chunkErrors !== 1 ? 's' : ''));
        runningStatsEl.textContent = rsParts.join(' · ');

        if (i + chunkSize < ids.length) {
          await new Promise(function(r) { setTimeout(r, chunkDelay); });
        }
      }

      // Done phase
      progressLabel.textContent = '✓ Done';
      progressBar.style.background = '#1f7a3c';
      progressBar.style.width = '100%';
      subtitleEl.textContent = 'Completed ' + Math.ceil(ids.length / chunkSize) + ' batch' + (Math.ceil(ids.length / chunkSize) !== 1 ? 'es' : '');

      // Replace confirm button with Close
      footerEl.innerHTML = '<button id="bsmDoneBtn" style="padding:9px 18px;border:1px solid #1a1814;background:#1a1814;color:#fff;font-size:13px;border-radius:4px;cursor:pointer;font-family:Inter,sans-serif;font-weight:500">Close</button>';
      document.getElementById('bsmDoneBtn').addEventListener('click', function() { close(true); });

      // Build a final toast string too
      var toastParts = [];
      for (var t = 0; t < summaryKeys.length; t++) {
        var tk = summaryKeys[t].key;
        if (agg[tk] > 0) toastParts.push(agg[tk] + ' ' + summaryKeys[t].label);
      }
      if (agg._skipped > 0) toastParts.push(agg._skipped + ' skipped');
      if (agg._failed > 0) toastParts.push(agg._failed + ' failed');
      if (agg._chunkErrors > 0) toastParts.push(agg._chunkErrors + ' batch error' + (agg._chunkErrors !== 1 ? 's' : ''));
      var hasErrors = agg._failed > 0 || agg._chunkErrors > 0;
      if (typeof showToast === 'function') {
        showToast(toastParts.length > 0 ? toastParts.join(' · ') : 'Done', hasErrors ? 'error' : 'success');
      }
    });
  });
}
