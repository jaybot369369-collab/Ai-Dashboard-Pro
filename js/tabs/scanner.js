/* ═══════════════════════════════════════════════════════════
   SCANNER TAB — Multi-pair ICT setup radar
   Top 30 USDT pairs by 24h volume · 4H candles · 60s poll
   Surfaces only A-tier 🦖 dino fires + B-tier confluence
════════════════════════════════════════════════════════════ */
const ScannerTab = (() => {

  /* ── State ──────────────────────────────────────────── */
  let _lastDinoSent = JSON.parse(localStorage.getItem('jb_scan_dinosent') || '{}'); // { symbol: timestamp }
  let _results    = [];
  let _loading    = false;
  let _err        = null;
  let _lastFetch  = null;
  let _pollTimer  = null;
  let _filter     = localStorage.getItem('jb_scan_filter') || 'all'; // all | dino | A | B
  let _topN       = parseInt(localStorage.getItem('jb_scan_topn') || '30');
  let _view       = localStorage.getItem('jb_scan_view') || 'grid'; // grid | list
  let _mode       = localStorage.getItem('jb_scan_mode') || 'top'; // top | custom | both
  let _customPairs= JSON.parse(localStorage.getItem('jb_scan_custom') || '[]');

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
    // 🦖 DINO: 3+ PD confluence + active killzone + aligned sweep — fires Telegram
    if (dom >= 3 && kzActive && sweep && sweep.type === dir) {
      tier = 'dino'; reasons = ['3+ PD confluence', `killzone: ${kzActive}`, 'aligned sweep'];
    }
    // A: 3+ PD confluence inside an active killzone
    else if (dom >= 3 && kzActive) {
      tier = 'A'; reasons = ['3+ PD confluence', `killzone: ${kzActive}`];
    }
    // B: 3+ PD confluence (off-killzone) — strong area, just bad timing
    else if (dom >= 3) {
      tier = 'B'; reasons = ['3+ PD confluence (off-killzone)'];
    }
    // C: 2+ PD confluence + (killzone OR active sweep) — worth watching
    else if (dom >= 2 && (kzActive || sweep)) {
      tier = 'C'; reasons = ['2+ PD confluence', kzActive ? `killzone: ${kzActive}` : 'active sweep'];
    }
    // D: 2+ PD confluence on its own — weak, low-priority
    else if (dom >= 2) {
      tier = 'D'; reasons = ['2+ PD confluence'];
    }
    // None: < 2 confluence — not surfaced
    return { tier, dir, dominant: dom, reasons };
  }

  /* ── Data loading ───────────────────────────────────── */
  async function fetchTopPairs() {
    const r = await fetch('https://api.binance.com/api/v3/ticker/24hr');
    if (!r.ok) throw new Error('ticker fetch ' + r.status);
    const all = await r.json();
    const byVol = all
      .filter(t => t.symbol.endsWith('USDT') && !t.symbol.includes('UP') && !t.symbol.includes('DOWN') && !t.symbol.includes('BULL') && !t.symbol.includes('BEAR'))
      .sort((a,b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume));

    // Custom-only mode: ONLY scan user-added tickers
    if (_mode === 'custom') {
      const map = Object.fromEntries(byVol.map(t => [t.symbol, t]));
      return _customPairs.map(sym => map[sym] || { symbol: sym, lastPrice: '0', priceChangePercent: '0', quoteVolume: '0' });
    }

    // Top-only mode
    const top = byVol.slice(0, _topN);
    if (_mode === 'top') return top;

    // Both: merge — top N + any custom that aren't already in top N
    const seen = new Set(top.map(t => t.symbol));
    const map = Object.fromEntries(byVol.map(t => [t.symbol, t]));
    const extras = _customPairs.filter(s => !seen.has(s)).map(sym => map[sym] || { symbol: sym, lastPrice: '0', priceChangePercent: '0', quoteVolume: '0' });
    return [...extras, ...top]; // custom first so they're prominent
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
      // Fire Telegram alerts for fresh dino + A-tier signals (10-min throttle per pair)
      maybeAlertNewSignals();
    } catch (e) {
      _err = e.message;
      console.error('Scanner load error:', e);
    } finally {
      _loading = false;
      updateBody();
      updateStatus();
    }
  }

  /* ── Telegram alerting on dino + A-tier signals ─────── */
  function maybeAlertNewSignals() {
    if (typeof Telegram === 'undefined' || !Telegram.isEnabled()) return;
    const eligible = _results.filter(r => r.tier === 'dino' || r.tier === 'A');
    const now = Date.now();
    const TEN_MIN = 10 * 60 * 1000;
    for (const r of eligible) {
      const last = _lastDinoSent[r.symbol] || 0;
      if (now - last < TEN_MIN) continue;
      _lastDinoSent[r.symbol] = now;
      sendSignalAlert(r);
    }
    localStorage.setItem('jb_scan_dinosent', JSON.stringify(_lastDinoSent));
  }

  function sendSignalAlert(r) {
    const isDino = r.tier === 'dino';
    const tierLabel = isDino ? '🦖 DINO FIRE' : '🅰 A-TIER ALERT';
    const dirWord = r.dir === 'bull' ? 'LONG' : r.dir === 'bear' ? 'SHORT' : 'UNCLEAR';
    // Suggest entry/SL/TP from price + sweep
    let entry = r.price, sl = null, tp = null;
    if (r.sweep && r.sweep.type === r.dir) {
      // Use sweep range as risk reference
      // Entry at current price; SL beyond sweep wick (~0.5%); TP at 2R
      const sweepBufferPct = 0.005;
      if (r.dir === 'bull') {
        sl = r.price * (1 - sweepBufferPct);
        tp = entry + (entry - sl) * 2;
      } else if (r.dir === 'bear') {
        sl = r.price * (1 + sweepBufferPct);
        tp = entry - (sl - entry) * 2;
      }
    } else {
      // Default: 1% stop, 2R target
      if (r.dir === 'bull') { sl = r.price * 0.99; tp = entry + (entry - sl) * 2; }
      else if (r.dir === 'bear') { sl = r.price * 1.01; tp = entry - (sl - entry) * 2; }
    }
    const fmt = n => n != null ? n.toLocaleString('en-US', { maximumFractionDigits: dp(r.symbol) }) : '?';
    const text = `${tierLabel} — *SCANNER*\n\n` +
      `*${r.symbol.replace('USDT','')}/USDT* — *${dirWord}* setup\n` +
      `Tier: *${isDino ? 'DINO 🦖' : 'A-TIER'}*\n` +
      `PD ratio: ${r.pd.bulls}▲ / ${r.pd.bears}▼\n` +
      `Reasons: ${(r.reasons||[]).join(', ')}\n` +
      `\n*Market conditions:*\n` +
      `• Price: ${fmt(r.price)} (${r.change24h>=0?'+':''}${r.change24h.toFixed(2)}% 24h)\n` +
      `• Trend: ${r.trend.label}\n` +
      `• Position: ${r.premDisc.zone} (${r.premDisc.pct.toFixed(0)}% of 20-bar range)\n` +
      (r.sweep ? `• Sweep: ${r.sweep.label}\n` : '') +
      `\n*Suggested levels:*\n` +
      `• Entry: \`${fmt(entry)}\`\n` +
      `• SL: \`${fmt(sl)}\`\n` +
      `• TP (2R): \`${fmt(tp)}\`\n` +
      `\n_Open dashboard → Scanner → click ${r.symbol.replace('USDT','')} for ICT Dojo_`;
    Telegram.send(text).catch(e => console.warn('TG send failed:', e.message));
  }

  /* ── Rendering ──────────────────────────────────────── */
  function tierBadge(t) {
    if (t === 'dino') return '<span class="scan-tier scan-dino">🦖 DINO</span>';
    if (t === 'A')    return '<span class="scan-tier scan-a">A-TIER</span>';
    if (t === 'B')    return '<span class="scan-tier scan-b">B-TIER</span>';
    if (t === 'C')    return '<span class="scan-tier scan-c">C-TIER</span>';
    if (t === 'D')    return '<span class="scan-tier scan-d">D-TIER</span>';
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
    return t === 'dino' ? 0 : t === 'A' ? 1 : t === 'B' ? 2 : t === 'C' ? 3 : t === 'D' ? 4 : 99;
  }

  function renderListRow(r) {
    const change = r.change24h;
    const changeColor = change >= 0 ? 'var(--green)' : 'var(--red)';
    const isCustom = _customPairs.includes(r.symbol);
    return `<tr class="scan-list-row" onclick="ScannerTab._pickPair('${r.symbol}')">
      <td>${tierBadge(r.tier)}</td>
      <td><strong>${r.symbol.replace('USDT','')}</strong>${isCustom ? ' <span style="color:#8b5cf6;font-size:.7rem">★</span>' : ''}</td>
      <td>${dirBadge(r.dir) || '<span class="text-dim">—</span>'}</td>
      <td style="font-family:var(--mono)">${fmtP(r.price, r.symbol)}</td>
      <td style="color:${changeColor};font-family:var(--mono)">${change>=0?'+':''}${change.toFixed(2)}%</td>
      <td>${r.trend.label}</td>
      <td>${r.premDisc.zone} <span class="text-dim">${r.premDisc.pct.toFixed(0)}%</span></td>
      <td><span style="color:var(--green)">${r.pd.bulls}▲</span> / <span style="color:var(--red)">${r.pd.bears}▼</span></td>
      <td>${r.sweep ? `<span style="color:${r.sweep.type==='bull'?'var(--green)':'var(--red)'}">⚡ ${r.sweep.label}</span>` : '<span class="text-dim">—</span>'}</td>
    </tr>`;
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
        if (_filter === 'C')    return r.tier === 'C';
        if (_filter === 'D')    return r.tier === 'D';
        return true;
      })
      .sort((a,b) => tierOrder(a.tier) - tierOrder(b.tier) || b.dominant - a.dominant);

    const counts = {
      dino: _results.filter(r => r.tier === 'dino').length,
      A:    _results.filter(r => r.tier === 'A').length,
      B:    _results.filter(r => r.tier === 'B').length,
      C:    _results.filter(r => r.tier === 'C').length,
      D:    _results.filter(r => r.tier === 'D').length,
    };

    let body = '';
    if (filtered.length) {
      if (_view === 'list') {
        body = `<div class="scan-list-wrap"><table class="scan-list">
          <thead><tr>
            <th>Tier</th><th>Pair</th><th>Bias</th><th>Price</th><th>24h</th><th>Trend</th><th>Position</th><th>PD</th><th>Sweep</th>
          </tr></thead>
          <tbody>${filtered.map(renderListRow).join('')}</tbody>
        </table></div>`;
      } else {
        body = `<div class="scan-grid">${filtered.map(renderCard).join('')}</div>`;
      }
    } else {
      body = `<div class="empty-state"><div class="empty-icon">😴</div><p>No setups matching <strong>${_filter}</strong> filter right now.</p><p class="text-dim" style="font-size:.85rem">Try a different filter or wait for the next scan.</p></div>`;
    }

    el.innerHTML = `
      <div class="scan-summary">
        <span>Scanned <strong>${_results.length}</strong> pairs</span>
        <span class="scan-pill scan-pill-dino">🦖 ${counts.dino}</span>
        <span class="scan-pill scan-pill-a">A: ${counts.A}</span>
        <span class="scan-pill scan-pill-b">B: ${counts.B}</span>
        <span class="scan-pill scan-pill-c">C: ${counts.C}</span>
        <span class="scan-pill scan-pill-d">D: ${counts.D}</span>
      </div>
      ${body}
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
          ${['all','dino','A','B','C','D'].map(f => `<button class="btn-ghost btn-sm scan-fbtn${_filter===f?' active':''}" onclick="ScannerTab._setFilter('${f}')">${f === 'all' ? 'All' : f === 'dino' ? '🦖 Dino' : f}</button>`).join('')}
        </div>
        <div class="scan-controls">
          <div class="scan-view-toggle">
            <button class="scan-vbtn${_view==='grid'?' active':''}" onclick="ScannerTab._setView('grid')" title="Grid view">▦</button>
            <button class="scan-vbtn${_view==='list'?' active':''}" onclick="ScannerTab._setView('list')" title="List view">☰</button>
          </div>
          <label class="text-dim" style="font-size:.78rem">Mode
            <select onchange="ScannerTab._setMode(this.value)" style="background:var(--bg-card);border:1px solid var(--border);color:var(--text);padding:2px 6px;border-radius:4px;margin-left:4px">
              <option value="top"${_mode==='top'?' selected':''}>Top by volume</option>
              <option value="custom"${_mode==='custom'?' selected':''}>Custom only</option>
              <option value="both"${_mode==='both'?' selected':''}>Both</option>
            </select>
          </label>
          <label class="text-dim" style="font-size:.78rem"${_mode==='custom'?' style="display:none"':''}>Top
            <select onchange="ScannerTab._setTopN(this.value)" style="background:var(--bg-card);border:1px solid var(--border);color:var(--text);padding:2px 6px;border-radius:4px;margin-left:4px"${_mode==='custom'?' disabled':''}>
              ${[15,30,50,100,200].map(n=>`<option value="${n}"${n===_topN?' selected':''}>${n}</option>`).join('')}
            </select>
          </label>
          <span id="scanStatus" class="text-dim" style="font-size:.78rem">Idle</span>
          <button class="btn-primary btn-sm" onclick="ScannerTab._refresh()">↻ Scan</button>
        </div>
      </div>

      <div class="scan-custom-bar">
        <div class="scan-custom-input">
          <input type="text" id="scanAddInput" placeholder="add ticker — e.g. SOL, LINKUSDT, PEPE" />
          <button class="btn-primary btn-sm" onclick="ScannerTab._addPair()">＋ Add</button>
        </div>
        <div class="scan-custom-chips">
          ${_customPairs.length
            ? _customPairs.map(p => `<span class="scan-custom-chip">${p.replace('USDT','')}<button onclick="ScannerTab._removePair('${p}')">✕</button></span>`).join('')
            : `<span class="text-dim" style="font-size:.78rem">No custom pairs added yet — add any USDT ticker above to track it</span>`
          }
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

    // Wire Enter key on custom-pair input
    const addInput = document.getElementById('scanAddInput');
    if (addInput) addInput.addEventListener('keypress', e => { if (e.key === 'Enter') { e.preventDefault(); ScannerTab._addPair(); } });

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
    _setView:    v => { _view = v; localStorage.setItem('jb_scan_view', v); render(); },
    _setMode:    m => { _mode = m; localStorage.setItem('jb_scan_mode', m); render(); loadData(); },
    _addPair:    () => {
      const input = document.getElementById('scanAddInput');
      const raw = (input?.value || '').trim().toUpperCase().replace('/', '');
      if (!raw) return;
      const sym = raw.endsWith('USDT') ? raw : raw + 'USDT';
      if (!_customPairs.includes(sym)) {
        _customPairs.push(sym);
        localStorage.setItem('jb_scan_custom', JSON.stringify(_customPairs));
      }
      if (input) input.value = '';
      render();
      loadData();
    },
    _removePair: sym => {
      _customPairs = _customPairs.filter(p => p !== sym);
      localStorage.setItem('jb_scan_custom', JSON.stringify(_customPairs));
      render();
      if (_mode !== 'top') loadData();
    },
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
