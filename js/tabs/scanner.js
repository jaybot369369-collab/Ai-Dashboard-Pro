/* ═══════════════════════════════════════════════════════════
   SCANNER TAB — Multi-pair ICT setup radar
   Top 30 USDT pairs by 24h volume · 4H candles · 60s poll
   Surfaces only A-tier 🦖 dino fires + B-tier confluence
════════════════════════════════════════════════════════════ */
const ScannerTab = (() => {

  /* ── State ──────────────────────────────────────────── */
  let _results    = [];
  let _loading    = false;
  let _err        = null;
  let _lastFetch  = null;
  let _pollTimer  = null;
  let _filter     = localStorage.getItem('jb_scan_filter') || 'all'; // all | dino | A | B
  let _topN       = parseInt(localStorage.getItem('jb_scan_topn') || '30');

  /* ── Utils ──────────────────────────────────────────── */
  const dp     = s => s.startsWith('BTC') ? 2 : (s.startsWith('ETH') ? 2 : 4);
  const fmtP   = (n, sym) => '$' + parseFloat(n).toLocaleString('en-US', { minimumFractionDigits: dp(sym), maximumFractionDigits: dp(sym) });
  const ago    = ms => { const s = Math.round((Date.now()-ms)/1000); return s < 60 ? `${s}s ago` : `${Math.round(s/60)}m ago`; };
  const sleep  = ms => new Promise(r => setTimeout(r, ms));

  /* ── NY-aware killzone (lifted from Dojo) ───────────── */
  const KZS_NY = [
    { name: 'Asian',        sNY: 20, eNY: 24 },
    { name: 'London Open',  sNY: 2,  eNY: 5  },
    { name: 'NY Open',      sNY: 7,  eNY: 10 },
    { name: 'London Close', sNY: 10, eNY: 12 },
  ];
  function nyOffsetHours() {
    try {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/New_York', timeZoneName: 'longOffset'
      }).formatToParts(new Date());
      const tz = parts.find(p => p.type === 'timeZoneName').value;
      const m = tz.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
      if (!m) return -5;
      return (m[1] === '+' ? 1 : -1) * (parseInt(m[2]) + parseInt(m[3]||'0')/60);
    } catch { return -5; }
  }
  function activeKZName() {
    const off = nyOffsetHours();
    const now = new Date();
    const h = now.getUTCHours() + now.getUTCMinutes()/60;
    for (const kz of KZS_NY) {
      const s = ((kz.sNY - off) + 24) % 24;
      const e = ((kz.eNY - off) + 24) % 24;
      const inside = s > e ? (h >= s || h < e) : (h >= s && h < e);
      if (inside) return kz.name;
    }
    return null;
  }

  /* ── Lightweight detectors (ported from Dojo) ───────── */
  function detectTrend(c) {
    if (c.length < 50) return { label: '—', dir: 0 };
    const ema = (period) => {
      const k = 2/(period+1); let v = c[c.length-period].close;
      for (let i = c.length-period+1; i < c.length; i++) v = c[i].close*k + v*(1-k);
      return v;
    };
    const e21 = ema(21), e50 = ema(50);
    const px  = c[c.length-1].close;
    if (px > e21 && e21 > e50) return { label: 'Trending Up', dir: 1 };
    if (px < e21 && e21 < e50) return { label: 'Trending Down', dir: -1 };
    return { label: 'Ranging', dir: 0 };
  }

  function detectPremDisc(c) {
    if (c.length < 20) return { pct: 50, zone: '—' };
    const slice = c.slice(-20);
    const hi = Math.max(...slice.map(x=>x.high));
    const lo = Math.min(...slice.map(x=>x.low));
    const px = c[c.length-1].close;
    const pct = ((px - lo) / (hi - lo)) * 100;
    return {
      pct,
      zone: pct >= 70 ? 'Premium' : pct <= 30 ? 'Discount' : 'Equilibrium',
    };
  }

  // PD-array confluence count near current price (FVG, OB, BB simplified)
  function detectPDConfluence(c) {
    if (c.length < 30) return { bulls: 0, bears: 0 };
    const px = c[c.length-1].close;
    const range = (Math.max(...c.slice(-50).map(x=>x.high)) - Math.min(...c.slice(-50).map(x=>x.low))) || 1;
    const NEAR = range * 0.03; // within 3% of current price
    let bulls = 0, bears = 0;
    // FVG scan: 3-candle gap pattern
    for (let i = c.length-50; i < c.length-2; i++) {
      if (i < 1) continue;
      // Bullish FVG: c[i-1].high < c[i+1].low
      if (c[i-1].high < c[i+1].low) {
        const mid = (c[i-1].high + c[i+1].low) / 2;
        if (Math.abs(px - mid) < NEAR && px > mid) bulls++;
      }
      // Bearish FVG
      if (c[i-1].low > c[i+1].high) {
        const mid = (c[i-1].low + c[i+1].high) / 2;
        if (Math.abs(px - mid) < NEAR && px < mid) bears++;
      }
    }
    // Order blocks: last down candle before strong up move (and vice versa)
    for (let i = c.length-30; i < c.length-3; i++) {
      if (i < 0) continue;
      const move = (c[i+3].close - c[i].close) / c[i].close;
      if (move > 0.015 && c[i].close < c[i].open) {
        if (Math.abs(px - c[i].low) < NEAR) bulls++;
      }
      if (move < -0.015 && c[i].close > c[i].open) {
        if (Math.abs(px - c[i].high) < NEAR) bears++;
      }
    }
    return { bulls, bears };
  }

  // Liquidity sweep: wick that pierced recent swing high/low and closed back inside
  function detectSweep(c) {
    if (c.length < 25) return null;
    const last = c[c.length-1];
    const recent = c.slice(-25, -1);
    const swingHi = Math.max(...recent.map(x=>x.high));
    const swingLo = Math.min(...recent.map(x=>x.low));
    if (last.high > swingHi && last.close < swingHi) return { type: 'bear', label: 'Sell-side sweep' };
    if (last.low < swingLo  && last.close > swingLo) return { type: 'bull', label: 'Buy-side sweep' };
    return null;
  }

  /* ── Tier scoring ───────────────────────────────────── */
  function scoreSetup(pd, sweep, kzActive) {
    const dom = pd.bulls > pd.bears ? pd.bulls : pd.bears;
    const dir = pd.bulls > pd.bears ? 'bull' : pd.bears > pd.bulls ? 'bear' : null;
    let tier = null, reasons = [];
    // 🦖 DINO: 3+ confluence + active killzone + sweep aligned
    if (dom >= 3 && kzActive && sweep && sweep.type === dir) {
      tier = 'dino'; reasons = ['3+ PD confluence', `killzone: ${kzActive}`, 'aligned sweep'];
    } else if (dom >= 3 && kzActive) {
      tier = 'A'; reasons = ['3+ PD confluence', `killzone: ${kzActive}`];
    } else if (dom >= 2 && (kzActive || sweep)) {
      tier = 'B'; reasons = ['2+ PD confluence', kzActive ? `killzone: ${kzActive}` : 'active sweep'];
    } else if (dom >= 2) {
      tier = 'B'; reasons = ['2+ PD confluence'];
    }
    return { tier, dir, dominant: dom, reasons };
  }

  /* ── Data loading ───────────────────────────────────── */
  async function fetchTopPairs() {
    const r = await fetch('https://api.binance.com/api/v3/ticker/24hr');
    if (!r.ok) throw new Error('ticker fetch ' + r.status);
    const all = await r.json();
    return all
      .filter(t => t.symbol.endsWith('USDT') && !t.symbol.includes('UP') && !t.symbol.includes('DOWN') && !t.symbol.includes('BULL') && !t.symbol.includes('BEAR'))
      .sort((a,b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
      .slice(0, _topN);
  }

  async function fetchKlines(symbol, interval = '4h', limit = 100) {
    const r = await fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`);
    if (!r.ok) throw new Error(symbol + ' klines ' + r.status);
    const raw = await r.json();
    return raw.map(k => ({
      time: k[0], open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[5],
    }));
  }

  async function scanPair(t) {
    const sym = t.symbol;
    try {
      const c = await fetchKlines(sym, '4h', 100);
      const trend    = detectTrend(c);
      const premDisc = detectPremDisc(c);
      const pd       = detectPDConfluence(c);
      const sweep    = detectSweep(c);
      const kz       = activeKZName();
      const score    = scoreSetup(pd, sweep, kz);
      return {
        symbol: sym,
        price: parseFloat(t.lastPrice),
        change24h: parseFloat(t.priceChangePercent),
        volume: parseFloat(t.quoteVolume),
        trend, premDisc, pd, sweep,
        ...score,
      };
    } catch (e) {
      return { symbol: sym, error: e.message };
    }
  }

  async function loadData() {
    if (_loading) return;
    _loading = true; _err = null;
    updateStatus();
    try {
      const top = await fetchTopPairs();
      // Batch in groups of 10 to avoid overwhelming the API
      const all = [];
      for (let i = 0; i < top.length; i += 10) {
        const batch = top.slice(i, i+10);
        const out = await Promise.all(batch.map(scanPair));
        all.push(...out);
        if (i + 10 < top.length) await sleep(200);
      }
      _results = all.filter(r => !r.error);
      _lastFetch = Date.now();
    } catch (e) {
      _err = e.message;
      console.error('Scanner load error:', e);
    } finally {
      _loading = false;
      updateBody();
      updateStatus();
    }
  }

  /* ── Rendering ──────────────────────────────────────── */
  function tierBadge(t) {
    if (t === 'dino') return '<span class="scan-tier scan-dino">🦖 DINO</span>';
    if (t === 'A')    return '<span class="scan-tier scan-a">A-TIER</span>';
    if (t === 'B')    return '<span class="scan-tier scan-b">B-TIER</span>';
    return '<span class="scan-tier scan-none">—</span>';
  }
  function dirBadge(d) {
    if (d === 'bull') return '<span class="scan-dir scan-bull">▲ LONG</span>';
    if (d === 'bear') return '<span class="scan-dir scan-bear">▼ SHORT</span>';
    return '';
  }

  function renderCard(r) {
    const change = r.change24h;
    const changeColor = change >= 0 ? 'var(--green)' : 'var(--red)';
    const reasonHtml = r.reasons.length
      ? r.reasons.map(x => `<li>${x}</li>`).join('')
      : '<li class="text-dim">—</li>';
    return `<div class="scan-card scan-${r.tier}" onclick="ScannerTab._pickPair('${r.symbol}')">
      <div class="scan-card-hdr">
        <div>
          <div class="scan-sym">${r.symbol.replace('USDT','')}<span class="text-dim">/USDT</span></div>
          <div class="scan-px">${fmtP(r.price, r.symbol)} <span style="color:${changeColor};font-size:.78rem;margin-left:4px">${change>=0?'+':''}${change.toFixed(2)}%</span></div>
        </div>
        <div class="scan-card-tags">
          ${tierBadge(r.tier)}
          ${dirBadge(r.dir)}
        </div>
      </div>
      <div class="scan-card-meta">
        <span title="Trend">${r.trend.label}</span>
        <span title="Position in 20-bar range">${r.premDisc.zone} · ${r.premDisc.pct.toFixed(0)}%</span>
        <span title="PD array confluence">${r.pd.bulls}▲ / ${r.pd.bears}▼</span>
        ${r.sweep ? `<span style="color:${r.sweep.type==='bull'?'var(--green)':'var(--red)'}">⚡ ${r.sweep.label}</span>` : ''}
      </div>
      <ul class="scan-reasons">${reasonHtml}</ul>
      <div class="scan-card-footer">
        <span class="text-dim">tap to open in Dojo →</span>
      </div>
    </div>`;
  }

  function tierOrder(t) {
    return t === 'dino' ? 0 : t === 'A' ? 1 : t === 'B' ? 2 : 99;
  }

  function updateBody() {
    const el = document.getElementById('scanBody');
    if (!el) return;
    if (_err) { el.innerHTML = `<div class="empty-state"><div class="empty-icon">📡</div><p>Could not reach Binance: ${_err}</p></div>`; return; }
    if (!_results.length && _loading) { el.innerHTML = `<div class="loading-state">Scanning ${_topN} pairs… (this takes ~10–15s)</div>`; return; }
    if (!_results.length) { el.innerHTML = `<div class="empty-state"><div class="empty-icon">🔭</div><p>Click ↻ Scan to start</p></div>`; return; }

    const filtered = _results
      .filter(r => {
        if (_filter === 'all')  return r.tier !== null;
        if (_filter === 'dino') return r.tier === 'dino';
        if (_filter === 'A')    return r.tier === 'dino' || r.tier === 'A';
        if (_filter === 'B')    return r.tier === 'B';
        return true;
      })
      .sort((a,b) => tierOrder(a.tier) - tierOrder(b.tier) || b.dominant - a.dominant);

    const counts = {
      dino: _results.filter(r => r.tier === 'dino').length,
      A:    _results.filter(r => r.tier === 'A').length,
      B:    _results.filter(r => r.tier === 'B').length,
    };

    el.innerHTML = `
      <div class="scan-summary">
        <span>Scanned <strong>${_results.length}</strong> pairs</span>
        <span class="scan-pill scan-pill-dino">🦖 ${counts.dino}</span>
        <span class="scan-pill scan-pill-a">A: ${counts.A}</span>
        <span class="scan-pill scan-pill-b">B: ${counts.B}</span>
      </div>
      ${filtered.length
        ? `<div class="scan-grid">${filtered.map(renderCard).join('')}</div>`
        : `<div class="empty-state"><div class="empty-icon">😴</div><p>No setups matching <strong>${_filter}</strong> filter right now.</p><p class="text-dim" style="font-size:.85rem">Try a different filter or wait for the next scan.</p></div>`
      }
    `;
  }

  function updateStatus() {
    const el = document.getElementById('scanStatus');
    if (!el) return;
    if (_loading)    { el.textContent = 'Scanning…'; el.style.color = 'var(--gold)'; return; }
    if (_err)        { el.textContent = '⚠ ' + _err; el.style.color = 'var(--red)'; return; }
    if (_lastFetch)  { el.textContent = `Last scan ${ago(_lastFetch)}`; el.style.color = 'var(--text-sub)'; return; }
    el.textContent = 'Idle';
  }

  function startPoll() {
    if (_pollTimer) clearInterval(_pollTimer);
    _pollTimer = setInterval(() => loadData(), 60000); // 60s refresh
  }

  /* ── Public render ──────────────────────────────────── */
  function render() {
    if (_pollTimer) clearInterval(_pollTimer);
    const content = document.getElementById('content');
    content.innerHTML = `<div class="scan-wrap">
      <div class="scan-top-bar">
        <div class="scan-filters">
          ${['all','dino','A','B'].map(f => `<button class="btn-ghost btn-sm scan-fbtn${_filter===f?' active':''}" onclick="ScannerTab._setFilter('${f}')">${f === 'all' ? 'All' : f === 'dino' ? '🦖 Dino' : f}</button>`).join('')}
        </div>
        <div class="scan-controls">
          <label class="text-dim" style="font-size:.78rem">Top
            <select onchange="ScannerTab._setTopN(this.value)" style="background:var(--bg-card);border:1px solid var(--border);color:var(--text);padding:2px 6px;border-radius:4px;margin-left:4px">
              ${[15,30,50,100].map(n=>`<option value="${n}"${n===_topN?' selected':''}>${n}</option>`).join('')}
            </select>
          </label>
          <span id="scanStatus" class="text-dim" style="font-size:.78rem">Idle</span>
          <button class="btn-primary btn-sm" onclick="ScannerTab._refresh()">↻ Scan</button>
        </div>
      </div>

      <div id="scanBody" style="margin-top:14px">
        <div class="empty-state"><div class="empty-icon">🔭</div>
          <p>Multi-pair ICT setup radar</p>
          <p class="text-dim" style="font-size:.85rem">Scans top ${_topN} USDT pairs by 24h volume.<br>Surfaces 🦖 dino fires, A-tier (3+ PD confluence inside killzone), and B-tier (2+ PD confluence).</p>
          <button class="btn-primary" onclick="ScannerTab._refresh()" style="margin-top:14px">Start scanning →</button>
        </div>
      </div>
    </div>`;

    // Auto-load on first open
    if (!_lastFetch || (Date.now() - _lastFetch) > 60000) {
      loadData();
    } else {
      updateBody(); updateStatus();
    }
    startPoll();
  }

  return {
    render,
    _refresh:    () => loadData(),
    _setFilter:  f => { _filter = f; localStorage.setItem('jb_scan_filter', f); render(); },
    _setTopN:    n => { _topN = parseInt(n); localStorage.setItem('jb_scan_topn', _topN); loadData(); },
    _pickPair:   sym => {
      // Switch to Dojo tab with this pair selected
      if (typeof DojoTab !== 'undefined' && DojoTab._pair) {
        // Make sure pair exists in custom pairs list
        const stored = JSON.parse(localStorage.getItem('jb_dojo_pairs') || 'null') || ['BTCUSDT','ETHUSDT','XRPUSDT'];
        if (!stored.includes(sym)) {
          stored.push(sym);
          localStorage.setItem('jb_dojo_pairs', JSON.stringify(stored));
        }
        // Switch to dojo tab via App router
        if (typeof App !== 'undefined' && App._switchTab) {
          App._switchTab('dojo');
          setTimeout(() => DojoTab._pair(sym), 100);
        } else {
          DojoTab._pair(sym);
        }
      }
    },
  };
})();
