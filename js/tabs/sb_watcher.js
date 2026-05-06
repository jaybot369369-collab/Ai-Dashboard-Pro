/* ═══════════════════════════════════════════════════════════
   SB WATCHER TAB
   Live ICT Silver Bullet setup viewer.
   Reads js/data/sb_watcher.json (auto-updated every 5min by the
   ict-watchlist GitHub Actions cron running sb_live_watcher.py).
════════════════════════════════════════════════════════════ */
const SBWatcherTab = (() => {

  let _data = null;
  let _err = null;
  let _loading = false;
  let _autoTimer = null;

  // Watcher writes JSON every 5min when something changes; refresh
  // the view aggressively so 🟢 TRIGGER alerts feel near-real-time.
  const REFRESH_MS = 60 * 1000;   // 1 min
  const CHECK_MS   = 60 * 1000;   // re-check every 1 min while tab open

  async function load() {
    _loading = true; _err = null;
    try {
      const r = await fetch('js/data/sb_watcher.json?t=' + Date.now());
      if (!r.ok) throw new Error('sb_watcher fetch ' + r.status);
      _data = await r.json();
    } catch (e) {
      _err = e.message;
    } finally {
      _loading = false;
    }
  }

  /* ── Helpers ──────────────────────────────────────────── */

  const TIER_META = {
    BREWING: { icon: '🟡', label: 'BREWING',  color: '#d4af37',
               desc: 'FVG forming, awaiting retrace into mid' },
    ARMED:   { icon: '🟠', label: 'ARMED',    color: '#e0883a',
               desc: 'Touched FVG mid, awaiting confirmation close' },
    TRIGGER: { icon: '🟢', label: 'TRIGGER',  color: '#3aa260',
               desc: '✓ Confirmation closed — paper trader would enter' },
  };

  const AMD_META = {
    bullish:    { icon: '🟢', label: 'BULL DAY',  cls: 'sbw-amd-bull' },
    bearish:    { icon: '🔴', label: 'BEAR DAY',  cls: 'sbw-amd-bear' },
    two_sided:  { icon: '⚪', label: 'TWO-SIDED', cls: 'sbw-amd-neutral' },
    null:       { icon: '⚫', label: 'NO BIAS',   cls: 'sbw-amd-none' },
  };

  // Multi-strategy badge styling (Phase 4a + 4d)
  const STRATEGY_META = {
    silver_bullet: { label: 'SB',    color: '#5a9fd4',
                     desc: 'Silver Bullet — FVG-in-window + sweep' },
    judas_swing:   { label: 'JUDAS', color: '#a07ad4',
                     desc: 'Judas Swing — Asian sweep → midnight cross' },
    ote:           { label: 'OTE',   color: '#d4a55a',
                     desc: 'OTE — broken-structure + Fib retrace' },
    smr:           { label: 'SMR',   color: '#5ad48a',
                     desc: 'Smart Money Reversal — sweep + MSS + FVG retest' },
    sb_1m:         { label: 'SB-1m', color: '#7ab8d4',
                     desc: 'Silver Bullet — 1m FVG entry refinement' },
    ifvg:          { label: 'iFVG',  color: '#d45a8a',
                     desc: 'Inversion FVG — failed gap flip retest' },
    smr_1m:        { label: 'SMR-1m',color: '#7ad4a8',
                     desc: 'Smart Money Reversal on 1m bars' },
  };

  /* ── Custom-tickers state ─────────────────────────────────
   * Persists in localStorage; mirrors to dashboard repo via
   * RepoWriter when user clicks Save.
   */
  const CUSTOM_KEY = 'jb_custom_symbols';
  const CUSTOM_PATH = 'js/data/custom_symbols.json';

  function loadCustomSymbols() {
    const raw = localStorage.getItem(CUSTOM_KEY);
    if (raw) {
      try { return JSON.parse(raw); } catch (_) { /* fall through */ }
    }
    return ['SUIUSDT'];
  }

  function saveCustomLocal(list) {
    localStorage.setItem(CUSTOM_KEY, JSON.stringify(list));
  }

  async function pushCustomToRepo(list) {
    if (!window.RepoWriter || !RepoWriter.hasPat()) {
      throw new Error('No GitHub PAT set. Click "Save PAT" in the section header.');
    }
    const writer = RepoWriter.create({
      owner: 'jaybot369369-collab',
      repo:  'Ai-Dashboard-Pro',
      branch: 'main',
    });
    const payload = {
      symbols: list,
      updated: new Date().toISOString(),
      note: 'Custom watchlist symbols added via dashboard SB Watcher tab.',
    };
    return writer.writeFile(CUSTOM_PATH,
                             JSON.stringify(payload, null, 2),
                             `Custom symbols updated: ${list.join(', ')}`);
  }

  function renderCustomTickersSection() {
    const list = loadCustomSymbols();
    const hasPat = (window.RepoWriter && RepoWriter.hasPat());
    const status = hasPat
      ? `<span style="color:#3aa260">● PAT set — changes auto-sync to repo</span>`
      : `<span style="color:#d4a55a">● No PAT — local-only. <a href="javascript:SBWatcherTab._setPat()">Save PAT</a></span>`;

    const rows = list.map(sym => `
      <span class="sbw-pill" style="margin-right:6px;display:inline-flex;align-items:center;gap:6px">
        <code>${sym}</code>
        <button class="btn-ghost btn-sm" onclick="SBWatcherTab._removeSymbol('${sym}')" style="padding:0 6px;font-size:.75rem">✕</button>
      </span>
    `).join('');

    return `
      <div class="sbw-section">
        <div class="sbw-sec-hdr">
          ➕ Custom Tickers
          <span class="sbw-count">${list.length}</span>
        </div>
        <div style="padding:10px 14px;border:1px solid var(--border, #2a2a2a);border-radius:8px;background:var(--bg-soft, rgba(255,255,255,.02))">
          <div style="margin-bottom:8px">${status}</div>
          <div style="display:flex;gap:8px;align-items:center;margin-bottom:10px">
            <input id="sbw-new-symbol" placeholder="e.g. SUIUSDT" style="padding:6px 10px;border:1px solid var(--border, #2a2a2a);background:var(--bg, #0b0f17);color:inherit;border-radius:4px;flex:1;text-transform:uppercase">
            <button class="btn-ghost btn-sm" onclick="SBWatcherTab._addSymbol()">Add</button>
          </div>
          <div>${rows || '<span style="opacity:.6">No custom tickers yet.</span>'}</div>
          <div style="margin-top:10px;font-size:.78rem;opacity:.6">
            Tickers added here are scanned by the watcher in addition to BTC/ETH/XRP/SOL.
            They must be available on Bybit testnet (linear perpetual) and Kraken.
            Lot specs auto-fetched from Bybit on first execution.
          </div>
        </div>
      </div>
    `;
  }

  function fmtAge(iso) {
    if (!iso) return '—';
    const ms = Date.now() - new Date(iso).getTime();
    const m = Math.round(ms / 60000);
    if (m < 1)   return 'just now';
    if (m < 60)  return `${m}m ago`;
    const h = Math.round(m / 60);
    if (h < 48)  return `${h}h ago`;
    const d = Math.round(h / 24);
    return `${d}d ago`;
  }

  function fmtPrice(n) {
    if (n == null) return '—';
    if (n >= 1000) return n.toLocaleString(undefined, {maximumFractionDigits: 2});
    if (n >= 10)   return n.toFixed(3);
    return n.toFixed(5);
  }

  function fmtMinutes(m) {
    if (m == null) return '—';
    if (m === 0)   return 'OPEN now';
    if (m < 60)    return `${m}m`;
    const h = Math.floor(m / 60), mm = m % 60;
    return mm ? `${h}h ${mm}m` : `${h}h`;
  }

  /* ── Renderers ────────────────────────────────────────── */

  function renderSymbolHeader(sym, info) {
    const ddir = info.amd?.dist_direction;
    const meta = AMD_META[ddir] || AMD_META[null];
    const nw = info.next_window || {};
    const nwLabel = nw.name ? `${nw.name} in ${fmtMinutes(nw.minutes_until)}` : '—';
    const setupCount = (info.active_setups || []).length;
    return `<div class="sbw-sym-card">
      <div class="sbw-sym-hdr">
        <span class="sbw-sym-name">${info.display || sym}</span>
        <span class="sbw-sym-price">$${fmtPrice(info.price)}</span>
      </div>
      <div class="sbw-sym-row">
        <span class="sbw-amd ${meta.cls}">${meta.icon} ${meta.label}</span>
        <span class="sbw-next-win" title="Next Silver Bullet window">⏱ ${nwLabel}</span>
      </div>
      <div class="sbw-sym-row">
        <span class="sbw-setup-count ${setupCount ? 'sbw-active' : ''}">
          ${setupCount} active setup${setupCount === 1 ? '' : 's'}
        </span>
      </div>
    </div>`;
  }

  function renderSetupCard(sym, display, s) {
    const t = TIER_META[s.tier] || TIER_META.ARMED;
    const strat = STRATEGY_META[s.strategy] || STRATEGY_META.silver_bullet;
    const arrow = s.direction === 'bull' ? '📈' : '📉';
    const dirLabel = (s.direction || '').toUpperCase();
    return `<div class="sbw-setup" style="border-left:4px solid ${t.color}">
      <div class="sbw-setup-hdr">
        <span class="sbw-strat" style="background:${strat.color}22;color:${strat.color};border:1px solid ${strat.color}55"
              title="${strat.desc}">${strat.label}</span>
        <span class="sbw-tier">${t.icon} ${t.label}</span>
        <span class="sbw-setup-sym">${display || sym}</span>
        <span class="sbw-arrow">${arrow} ${dirLabel}</span>
      </div>
      <div class="sbw-setup-meta">
        <span class="sbw-pill">${s.window || '—'}</span>
        ${s.fvg_grade ? `<span class="sbw-pill">FVG ${s.fvg_grade}</span>` : ''}
        ${s.score != null ? `<span class="sbw-pill">conf ${s.score}/5</span>` : ''}
        ${s.stop_anchor ? `<span class="sbw-pill">${s.stop_anchor}</span>` : ''}
      </div>
      <table class="sbw-setup-tbl">
        <tr><td>Entry</td><td>${fmtPrice(s.entry)}</td></tr>
        <tr><td>Stop</td><td style="color:#c44">${fmtPrice(s.stop)}</td></tr>
        <tr><td>TP1</td><td style="color:#3aa260">${fmtPrice(s.tp1)}</td></tr>
        <tr><td>R:R</td><td><b>${(s.rr || 0).toFixed(2)}</b></td></tr>
      </table>
      ${s.b2_date ? `<div class="sbw-setup-foot">b2: ${s.b2_date} ${s.b2_ts_ny || ''} NY</div>` : ''}
      <div class="sbw-setup-desc">${t.desc}</div>
    </div>`;
  }

  function renderRecentAlerts(alerts) {
    if (!alerts || !alerts.length) {
      return `<div class="sbw-alerts-empty">No alerts logged yet.</div>`;
    }
    const rows = alerts.slice().reverse().map(a => {
      const t = TIER_META[a.tier] || {};
      const strat = STRATEGY_META[a.strategy] || STRATEGY_META.silver_bullet;
      const ts = a.ts ? new Date(a.ts).toLocaleString(undefined,
        {month:'short', day:'numeric', hour:'2-digit', minute:'2-digit'}) : '—';
      return `<tr>
        <td class="sbw-al-ts">${ts}</td>
        <td class="sbw-al-sym">${a.symbol || '—'}</td>
        <td><span class="sbw-strat-sm" style="background:${strat.color}22;color:${strat.color}">${strat.label}</span></td>
        <td class="sbw-al-tier">${t.icon || ''} ${a.tier || ''}</td>
        <td>${a.score ?? '—'}/5</td>
        <td>R:R ${(a.rr || 0).toFixed(2)}</td>
      </tr>`;
    }).join('');
    return `<table class="sbw-alerts-tbl">
      <thead><tr><th>When</th><th>Sym</th><th>Strategy</th><th>Tier</th><th>Conf</th><th>R:R</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
  }

  /* ── Main render ──────────────────────────────────────── */

  async function render() {
    const content = document.getElementById('content');
    content.innerHTML = `<div class="sbw-wrap"><div class="loading-state">Loading SB watcher…</div></div>`;

    if (!_data || (Date.now() - new Date(_data.generated || 0).getTime()) > REFRESH_MS) {
      await load();
    }
    startAutoRefresh();

    if (_err) {
      content.innerHTML = `<div class="sbw-wrap"><div class="empty-state">
        <div class="empty-icon">⚠️</div>
        <p>Could not load SB watcher: ${_err}</p>
        <p class="text-dim" style="font-size:.85rem">
          The watcher writes <code>js/data/sb_watcher.json</code> every 5 minutes via GitHub Actions.
          If this is the first deploy, wait one cron cycle.
        </p>
      </div></div>`;
      return;
    }

    const d = _data || {};
    const symbols = d.symbols || {};
    const allSetups = [];
    Object.keys(symbols).forEach(sym => {
      (symbols[sym].active_setups || []).forEach(s => {
        allSetups.push({ sym, display: symbols[sym].display, ...s });
      });
    });
    // Sort: TRIGGER → ARMED → BREWING
    const tierOrder = { TRIGGER: 0, ARMED: 1, BREWING: 2 };
    allSetups.sort((a, b) => (tierOrder[a.tier] ?? 99) - (tierOrder[b.tier] ?? 99));

    content.innerHTML = `<div class="sbw-wrap">
      <div class="sbw-hdr">
        <div>
          <h1 class="sbw-title">👀 ICT Multi-Strategy Watcher</h1>
          <div class="sbw-subtitle">
            <span style="color:#5a9fd4">SB</span> ·
            <span style="color:#a07ad4">JUDAS</span> ·
            <span style="color:#d4a55a">OTE</span>
            · 5m · ${(d.config?.symbols || []).join(' · ')}
            · refreshed ${fmtAge(d.generated)}
          </div>
        </div>
        <button class="btn-ghost btn-sm" onclick="SBWatcherTab._refresh()">↻ Refresh</button>
      </div>

      <div class="sbw-symbols">
        ${Object.keys(symbols).map(s => renderSymbolHeader(s, symbols[s])).join('')}
      </div>

      ${renderCustomTickersSection()}

      <div class="sbw-section">
        <div class="sbw-sec-hdr">
          🎯 Active Setups
          <span class="sbw-count">${allSetups.length}</span>
        </div>
        ${allSetups.length === 0
          ? `<div class="sbw-empty">No live SB setups right now. Watcher is scanning every 5 min.</div>`
          : `<div class="sbw-setups">${allSetups.map(s => renderSetupCard(s.sym, s.display, s)).join('')}</div>`}
      </div>

      <div class="sbw-section">
        <div class="sbw-sec-hdr">📜 Recent Alerts <span class="sbw-count">${(d.recent_alerts || []).length}</span></div>
        ${renderRecentAlerts(d.recent_alerts)}
      </div>

      <div class="sbw-footer text-dim" style="font-size:.78rem;text-align:center;margin-top:24px">
        Live watcher · Phase-2 LIVE_CONFIG · sweep-only stops · AMD-aligned · R:R ≤ ${d.config?.max_rr ?? '—'}<br>
        Auto-updates every 5 min via GitHub Actions cron · Telegram alerts run in parallel
      </div>
    </div>

    <style>
      .sbw-wrap { padding: 16px 20px; }
      .sbw-hdr { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px; }
      .sbw-title { margin: 0 0 4px 0; font-size: 1.4rem; }
      .sbw-subtitle { color: var(--text-dim, #888); font-size: .85rem; }

      .sbw-symbols { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 10px; margin-bottom: 20px; }
      .sbw-sym-card { background: var(--card, #1a1d24); border: 1px solid var(--border, #2a2d35); border-radius: 8px; padding: 10px 12px; }
      .sbw-sym-hdr { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 6px; }
      .sbw-sym-name { font-weight: 600; font-size: 1rem; }
      .sbw-sym-price { font-family: monospace; font-size: .9rem; color: var(--text, #ddd); }
      .sbw-sym-row { display: flex; justify-content: space-between; gap: 8px; font-size: .8rem; margin-top: 4px; color: var(--text-dim, #aaa); }
      .sbw-amd { padding: 1px 6px; border-radius: 4px; font-size: .75rem; font-weight: 500; }
      .sbw-amd-bull { background: rgba(58,162,96,.18); color: #4ec27a; }
      .sbw-amd-bear { background: rgba(196,68,68,.18); color: #d76b6b; }
      .sbw-amd-neutral { background: rgba(255,255,255,.08); color: #ccc; }
      .sbw-amd-none { background: rgba(255,255,255,.05); color: #888; }
      .sbw-next-win { color: var(--text-dim, #aaa); }
      .sbw-setup-count { font-size: .8rem; color: var(--text-dim, #888); }
      .sbw-setup-count.sbw-active { color: #d4af37; font-weight: 500; }

      .sbw-section { margin-bottom: 20px; }
      .sbw-sec-hdr { font-weight: 600; font-size: 1rem; margin-bottom: 8px; display: flex; align-items: center; gap: 8px; }
      .sbw-count { background: rgba(255,255,255,.08); padding: 1px 8px; border-radius: 10px; font-size: .75rem; font-weight: 500; }

      .sbw-empty { color: var(--text-dim, #888); padding: 16px; background: var(--card, #1a1d24); border-radius: 8px; text-align: center; font-style: italic; }

      .sbw-setups { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 10px; }
      .sbw-setup { background: var(--card, #1a1d24); border: 1px solid var(--border, #2a2d35); border-radius: 8px; padding: 10px 12px; }
      .sbw-setup-hdr { display: flex; justify-content: space-between; gap: 8px; align-items: center; margin-bottom: 6px; flex-wrap: wrap; }
      .sbw-strat { font-weight: 700; font-size: .7rem; padding: 2px 7px; border-radius: 4px; letter-spacing: .5px; }
      .sbw-strat-sm { font-weight: 600; font-size: .68rem; padding: 1px 6px; border-radius: 3px; }
      .sbw-tier { font-weight: 600; font-size: .9rem; }
      .sbw-setup-sym { font-weight: 500; }
      .sbw-arrow { font-size: .85rem; color: var(--text-dim, #aaa); }
      .sbw-setup-meta { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 8px; }
      .sbw-pill { background: rgba(255,255,255,.06); padding: 1px 6px; border-radius: 4px; font-size: .72rem; color: #bbb; }
      .sbw-setup-tbl { width: 100%; font-family: monospace; font-size: .85rem; border-collapse: collapse; }
      .sbw-setup-tbl td { padding: 2px 0; }
      .sbw-setup-tbl td:first-child { color: var(--text-dim, #888); width: 35%; }
      .sbw-setup-foot { font-size: .72rem; color: var(--text-dim, #888); margin-top: 6px; }
      .sbw-setup-desc { font-size: .72rem; color: var(--text-dim, #777); font-style: italic; margin-top: 4px; }

      .sbw-alerts-tbl { width: 100%; border-collapse: collapse; font-size: .82rem; }
      .sbw-alerts-tbl th { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--border, #2a2d35); color: var(--text-dim, #888); font-weight: 500; }
      .sbw-alerts-tbl td { padding: 6px 8px; border-bottom: 1px solid var(--border, #20232a); }
      .sbw-al-ts { color: var(--text-dim, #888); white-space: nowrap; }
      .sbw-al-sym { font-weight: 500; }
      .sbw-alerts-empty { color: var(--text-dim, #888); padding: 12px; font-style: italic; }
    </style>`;
  }

  function startAutoRefresh() {
    if (_autoTimer) return;
    _autoTimer = setInterval(async () => {
      const onTab = document.querySelector('.nav-item.active')?.dataset.tab === 'sbwatcher';
      if (!onTab) return;
      const age = _data ? Date.now() - new Date(_data.generated).getTime() : Infinity;
      if (age > REFRESH_MS) {
        await load();
        render();
      }
    }, CHECK_MS);
  }

  /* ── Custom-tickers public API ───────────────────────── */

  async function _addSymbol() {
    const input = document.getElementById('sbw-new-symbol');
    if (!input) return;
    let sym = (input.value || '').trim().toUpperCase();
    if (!sym) return;
    if (!/^[A-Z0-9]+USDT?$/.test(sym)) {
      alert('Symbol must end in USDT or USD (e.g. SUIUSDT)');
      return;
    }
    const list = loadCustomSymbols();
    if (list.includes(sym)) {
      alert(`${sym} already in list.`);
      return;
    }
    list.push(sym);
    saveCustomLocal(list);
    if (window.RepoWriter && RepoWriter.hasPat()) {
      try {
        await pushCustomToRepo(list);
        alert(`✅ Added ${sym} and synced to repo. Watcher picks it up next cron tick (≤5 min).`);
      } catch (e) {
        alert(`Saved locally but repo sync failed: ${e.message}`);
      }
    } else {
      alert(`Saved ${sym} locally. Set a GitHub PAT to sync to the watcher.`);
    }
    input.value = '';
    render();
  }

  async function _removeSymbol(sym) {
    if (!confirm(`Remove ${sym} from custom watchlist?`)) return;
    let list = loadCustomSymbols().filter(s => s !== sym);
    saveCustomLocal(list);
    if (window.RepoWriter && RepoWriter.hasPat()) {
      try {
        await pushCustomToRepo(list);
      } catch (e) {
        alert(`Removed locally but repo sync failed: ${e.message}`);
      }
    }
    render();
  }

  function _setPat() {
    const cur = (window.RepoWriter && RepoWriter.hasPat()) ? '(set)' : '(none)';
    const pat = prompt(
      `Paste your GitHub fine-grained PAT.\n\nNeeds Contents:write on jaybot369369-collab/Ai-Dashboard-Pro.\nCurrent: ${cur}`
    );
    if (!pat) return;
    RepoWriter.setPat(pat.trim());
    alert('PAT saved to localStorage. Add/remove tickers will now sync to the repo.');
    render();
  }

  return {
    render,
    _refresh: async () => { await load(); render(); },
    _addSymbol,
    _removeSymbol,
    _setPat,
  };
})();
