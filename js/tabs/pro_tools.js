/* ═══════════════════════════════════════════════════════════
   PRO TOOLS — Position sizer · Trade replay · Correlation matrix
════════════════════════════════════════════════════════════ */
const ProToolsTab = (() => {

  const KEYS = {
    sizer: 'jb_pro_sizer',  // { account, riskPct }
    corrPairs: 'jb_pro_corr_pairs',
  };

  /* ── State ──────────────────────────────────────────── */
  let _sub        = localStorage.getItem('jb_pro_sub') || 'sizer';
  let _sizerCfg   = JSON.parse(localStorage.getItem(KEYS.sizer) || '{"account":10000,"riskPct":1}');
  let _corrPairs  = JSON.parse(localStorage.getItem(KEYS.corrPairs) || '["BTCUSDT","ETHUSDT","SOLUSDT","XRPUSDT","BNBUSDT","DOGEUSDT","ADAUSDT","AVAXUSDT"]');
  let _corrData   = null;
  let _replayChart= null;

  function saveSizer() { localStorage.setItem(KEYS.sizer, JSON.stringify(_sizerCfg)); }
  function saveCorr()  { localStorage.setItem(KEYS.corrPairs, JSON.stringify(_corrPairs)); }
  function saveSub(s)  { _sub = s; localStorage.setItem('jb_pro_sub', s); }

  /* ══════════════════════════════════════════════════════
     POSITION SIZER
  ══════════════════════════════════════════════════════ */
  function calcPosition(account, riskPct, entry, stop) {
    const riskUSD = account * (riskPct / 100);
    const distance = Math.abs(entry - stop);
    if (distance <= 0) return null;
    const distancePct = (distance / entry) * 100;
    const positionUSD = riskUSD / (distancePct / 100);
    const units = positionUSD / entry;
    const leverage = positionUSD / account;
    return { riskUSD, distance, distancePct, positionUSD, units, leverage };
  }

  function renderSizer() {
    return `<div class="pro-section">
      <h3 class="pro-hdr">📐 Position Sizing Calculator</h3>
      <div class="pro-grid pro-grid-3">
        <div class="form-group">
          <label>Account Size ($)</label>
          <input type="number" id="psAccount" value="${_sizerCfg.account}" step="any" />
        </div>
        <div class="form-group">
          <label>Risk per Trade (%)</label>
          <input type="number" id="psRisk" value="${_sizerCfg.riskPct}" step="0.1" min="0.1" max="10" />
        </div>
        <div class="form-group">
          <label>&nbsp;</label>
          <button class="btn-ghost" id="psSaveBtn">💾 Save defaults</button>
        </div>
      </div>
      <div class="pro-grid pro-grid-3" style="margin-top:10px">
        <div class="form-group">
          <label>Entry Price</label>
          <input type="number" id="psEntry" placeholder="e.g. 95000" step="any" />
        </div>
        <div class="form-group">
          <label>Stop Loss</label>
          <input type="number" id="psStop" placeholder="e.g. 94200" step="any" />
        </div>
        <div class="form-group">
          <label>Take Profit (optional)</label>
          <input type="number" id="psTP" placeholder="e.g. 96800" step="any" />
        </div>
      </div>
      <div id="psResult" style="margin-top:14px"></div>
      <div class="pro-tip">
        💡 Tip: 1% risk on a $10k account = max $100 loss per trade. With a 1% stop distance, that buys you a $10,000 position — 1x leverage. Tighter stops = bigger position size at the same risk.
      </div>
    </div>`;
  }

  function renderSizerResult() {
    const acct = parseFloat(document.getElementById('psAccount').value) || 0;
    const risk = parseFloat(document.getElementById('psRisk').value) || 0;
    const entry = parseFloat(document.getElementById('psEntry').value) || 0;
    const stop = parseFloat(document.getElementById('psStop').value) || 0;
    const tp = parseFloat(document.getElementById('psTP').value) || 0;
    const out = document.getElementById('psResult');
    if (!out) return;
    if (!entry || !stop) { out.innerHTML = ''; return; }
    const r = calcPosition(acct, risk, entry, stop);
    if (!r) { out.innerHTML = '<div class="text-dim">Entry must differ from stop</div>'; return; }
    const rr = tp ? Math.abs(tp - entry) / r.distance : null;
    const tpUSD = tp ? r.units * Math.abs(tp - entry) : null;
    const levColor = r.leverage > 5 ? 'var(--red)' : r.leverage > 2 ? 'var(--gold)' : 'var(--green)';
    out.innerHTML = `<div class="pro-result-grid">
      <div class="pro-result-card">
        <div class="pro-r-lbl">Position Size ($)</div>
        <div class="pro-r-val">$${r.positionUSD.toLocaleString('en-US',{maximumFractionDigits:0})}</div>
      </div>
      <div class="pro-result-card">
        <div class="pro-r-lbl">Position (units)</div>
        <div class="pro-r-val">${r.units.toFixed(r.units > 1 ? 4 : 6)}</div>
      </div>
      <div class="pro-result-card">
        <div class="pro-r-lbl">Risk ($)</div>
        <div class="pro-r-val" style="color:var(--red)">−$${r.riskUSD.toFixed(2)}</div>
        <div class="pro-r-sub">${r.distancePct.toFixed(2)}% stop distance</div>
      </div>
      <div class="pro-result-card">
        <div class="pro-r-lbl">Leverage</div>
        <div class="pro-r-val" style="color:${levColor}">${r.leverage.toFixed(2)}x</div>
      </div>
      ${tpUSD ? `<div class="pro-result-card">
        <div class="pro-r-lbl">Reward ($)</div>
        <div class="pro-r-val" style="color:var(--green)">+$${tpUSD.toFixed(2)}</div>
        <div class="pro-r-sub">${rr.toFixed(2)} : 1 R:R</div>
      </div>` : ''}
    </div>`;
  }

  /* ══════════════════════════════════════════════════════
     TRADE REPLAY
  ══════════════════════════════════════════════════════ */
  async function fetchReplayCandles(symbol, entryTime) {
    // Fetch ~50 candles centered around entry: 20 before + 30 after
    const tfMs = 60*60e3; // 1H
    const start = entryTime - 20 * tfMs;
    const end   = entryTime + 30 * tfMs;
    const url = `https://api.binance.com/api/v3/klines?symbol=${symbol.replace('/','')}&interval=1h&startTime=${start}&endTime=${end}&limit=100`;
    const r = await fetch(url);
    if (!r.ok) throw new Error('Binance ' + r.status);
    const raw = await r.json();
    return raw.map(k => ({ time: k[0], open: +k[1], high: +k[2], low: +k[3], close: +k[4] }));
  }

  function renderReplay() {
    const trades = (typeof DB !== 'undefined' && DB.getTrades) ? DB.getTrades().filter(t => t.entry && t.date).slice(-30).reverse() : [];
    return `<div class="pro-section">
      <h3 class="pro-hdr">▶ Trade Replay</h3>
      <p class="text-sub" style="font-size:.85rem;margin:0 0 10px">Pick a closed trade → see 20 hourly candles before your entry + 30 after, with entry/SL/TP markers.</p>
      ${trades.length ? `
        <div class="form-group">
          <label>Select Trade</label>
          <select id="rpTrade">
            <option value="">— pick a trade —</option>
            ${trades.map(t => `<option value="${t.id}">${t.date} · ${t.symbol} ${t.direction} @ ${t.entry}${t.rMultiple ? ` (${(+t.rMultiple).toFixed(1)}R)` : ''}</option>`).join('')}
          </select>
        </div>
        <div id="rpStatus" class="text-dim" style="font-size:.8rem;margin-top:6px"></div>
        <div class="pro-replay-wrap" style="margin-top:14px;display:none" id="rpWrap">
          <canvas id="rpChart" height="100"></canvas>
        </div>
      ` : `<div class="empty-state"><div class="empty-icon">📭</div><p>No trades to replay yet.</p></div>`}
    </div>`;
  }

  async function runReplay(tradeId) {
    const trade = DB.getTrades().find(t => t.id === tradeId);
    if (!trade) return;
    const status = document.getElementById('rpStatus');
    const wrap   = document.getElementById('rpWrap');
    status.textContent = 'Fetching candles…'; status.style.color = 'var(--gold)';
    try {
      const entryTime = new Date(trade.date + (trade.time ? 'T' + trade.time : 'T12:00')).getTime();
      const candles = await fetchReplayCandles(trade.symbol, entryTime);
      if (!candles.length) throw new Error('no candle data');
      wrap.style.display = 'block';
      const ctx = document.getElementById('rpChart');
      if (_replayChart) _replayChart.destroy();
      const labels = candles.map(c => new Date(c.time).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit' }));
      const closes = candles.map(c => c.close);
      const highs  = candles.map(c => c.high);
      const lows   = candles.map(c => c.low);
      const entryIdx = candles.findIndex(c => c.time >= entryTime);

      const dirColor = trade.direction === 'Long' ? '#00c896' : '#ff505a';
      _replayChart = new Chart(ctx, {
        type: 'line',
        data: {
          labels,
          datasets: [
            { label: 'High', data: highs,  borderColor: 'rgba(255,255,255,0.15)', borderWidth: 1, pointRadius: 0, fill: false },
            { label: 'Low',  data: lows,   borderColor: 'rgba(255,255,255,0.15)', borderWidth: 1, pointRadius: 0, fill: false },
            { label: 'Close',data: closes, borderColor: dirColor, borderWidth: 2, pointRadius: 0, fill: false, tension: 0.1 },
          ],
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: { mode: 'index', intersect: false },
            annotation: {},
          },
          scales: {
            x: { ticks: { color: '#8b949e', maxTicksLimit: 10 }, grid: { color: 'rgba(255,255,255,0.04)' } },
            y: { ticks: { color: '#8b949e' }, grid: { color: 'rgba(255,255,255,0.04)' } },
          },
        },
        plugins: [{
          id: 'tradeLines',
          afterDraw(chart) {
            const { ctx, chartArea: ca, scales: { x, y } } = chart;
            // Entry vertical line
            if (entryIdx >= 0) {
              const xPos = x.getPixelForValue(entryIdx);
              ctx.save();
              ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.setLineDash([4,4]);
              ctx.beginPath(); ctx.moveTo(xPos, ca.top); ctx.lineTo(xPos, ca.bottom); ctx.stroke();
              ctx.fillStyle = '#fff'; ctx.font = '10px sans-serif';
              ctx.fillText('ENTRY', xPos + 4, ca.top + 12);
              ctx.restore();
            }
            // Entry/SL/TP horizontal lines
            const drawHLine = (price, color, label) => {
              if (!price) return;
              const yPos = y.getPixelForValue(+price);
              ctx.save();
              ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.setLineDash([6,3]);
              ctx.beginPath(); ctx.moveTo(ca.left, yPos); ctx.lineTo(ca.right, yPos); ctx.stroke();
              ctx.fillStyle = color; ctx.font = 'bold 10px sans-serif';
              ctx.fillText(label + ' ' + price, ca.left + 4, yPos - 3);
              ctx.restore();
            };
            drawHLine(trade.entry,     dirColor,    'Entry');
            drawHLine(trade.sl,        '#ff505a',   'SL');
            drawHLine(trade.tp,        '#00c896',   'TP');
            drawHLine(trade.exitPrice, '#facc15',   'Exit');
          },
        }],
      });
      status.textContent = `${candles.length} hourly candles loaded · ${trade.symbol} ${trade.direction}`; status.style.color = 'var(--text-sub)';
    } catch (e) {
      status.textContent = '⚠ ' + e.message; status.style.color = 'var(--red)';
    }
  }

  /* ══════════════════════════════════════════════════════
     CORRELATION MATRIX
  ══════════════════════════════════════════════════════ */
  async function fetchDailyCloses(symbol, days) {
    const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=1d&limit=${days}`;
    const r = await fetch(url);
    if (!r.ok) throw new Error(symbol + ' ' + r.status);
    return (await r.json()).map(k => +k[4]);
  }

  function correlation(a, b) {
    const n = Math.min(a.length, b.length);
    if (n < 5) return null;
    // Convert to log returns
    const ra = []; const rb = [];
    for (let i = 1; i < n; i++) { ra.push(Math.log(a[i]/a[i-1])); rb.push(Math.log(b[i]/b[i-1])); }
    const ma = ra.reduce((a,b)=>a+b,0) / ra.length;
    const mb = rb.reduce((a,b)=>a+b,0) / rb.length;
    let cov = 0, va = 0, vb = 0;
    for (let i = 0; i < ra.length; i++) {
      cov += (ra[i]-ma) * (rb[i]-mb);
      va  += (ra[i]-ma) ** 2;
      vb  += (rb[i]-mb) ** 2;
    }
    if (va * vb === 0) return null;
    return cov / Math.sqrt(va * vb);
  }

  async function loadCorrData() {
    const out = document.getElementById('corrBody');
    if (out) out.innerHTML = '<div class="loading-state">Fetching 30d daily data for ' + _corrPairs.length + ' pairs…</div>';
    try {
      const closes = {};
      for (let i = 0; i < _corrPairs.length; i += 4) {
        const batch = _corrPairs.slice(i, i+4);
        const data = await Promise.all(batch.map(s => fetchDailyCloses(s, 30).catch(() => null)));
        batch.forEach((s, j) => { if (data[j]) closes[s] = data[j]; });
      }
      const matrix = {};
      for (const a of _corrPairs) {
        matrix[a] = {};
        for (const b of _corrPairs) {
          if (!closes[a] || !closes[b]) { matrix[a][b] = null; continue; }
          matrix[a][b] = a === b ? 1 : correlation(closes[a], closes[b]);
        }
      }
      _corrData = matrix;
      renderCorrTable();
    } catch (e) {
      if (out) out.innerHTML = '<div class="empty-state"><div class="empty-icon">⚠️</div><p>' + e.message + '</p></div>';
    }
  }

  function corrColor(c) {
    if (c == null) return 'var(--bg)';
    const v = Math.abs(c);
    // Red high (≥0.7), gold mid (0.4-0.7), green low (<0.4)
    if (v >= 0.7) return c > 0 ? 'rgba(255,80,90,0.7)' : 'rgba(139,92,246,0.6)';
    if (v >= 0.4) return c > 0 ? 'rgba(245,200,66,0.5)' : 'rgba(79,142,247,0.4)';
    return 'rgba(0,200,150,0.3)';
  }

  function renderCorrTable() {
    const out = document.getElementById('corrBody');
    if (!out) return;
    if (!_corrData) { out.innerHTML = ''; return; }
    const pairs = _corrPairs.filter(p => _corrData[p]);
    out.innerHTML = `<div class="corr-table-wrap"><table class="corr-table">
      <thead><tr><th></th>${pairs.map(p => `<th>${p.replace('USDT','')}</th>`).join('')}</tr></thead>
      <tbody>
        ${pairs.map(a => `<tr><th>${a.replace('USDT','')}</th>${pairs.map(b => {
          const v = _corrData[a]?.[b];
          return `<td style="background:${corrColor(v)}">${v == null ? '—' : v.toFixed(2)}</td>`;
        }).join('')}</tr>`).join('')}
      </tbody>
    </table></div>
    <div class="corr-legend">
      <span><span class="corr-sw" style="background:rgba(255,80,90,0.7)"></span> ≥ 0.7 high (avoid stacking)</span>
      <span><span class="corr-sw" style="background:rgba(245,200,66,0.5)"></span> 0.4-0.7 medium</span>
      <span><span class="corr-sw" style="background:rgba(0,200,150,0.3)"></span> &lt; 0.4 diversified</span>
    </div>`;
  }

  function renderCorrelation() {
    return `<div class="pro-section">
      <h3 class="pro-hdr">📊 Correlation Matrix (30d)</h3>
      <p class="text-sub" style="font-size:.85rem;margin:0 0 10px">High correlations mean stacking longs across these coins doesn't diversify your risk.</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px">
        <input type="text" id="corrAddInput" placeholder="add pair e.g. SOL or LINKUSDT" style="background:var(--bg);border:1px solid var(--border);color:var(--text);padding:5px 8px;border-radius:4px;font-size:.82rem" />
        <button class="btn-ghost btn-sm" id="corrAddBtn">＋ Add</button>
        <button class="btn-primary btn-sm" id="corrLoadBtn" style="margin-left:auto">↻ Refresh data</button>
      </div>
      <div class="pro-pair-chips">
        ${_corrPairs.map(p => `<span class="pro-pair-chip">${p.replace('USDT','')}<button onclick="ProToolsTab._removeCorrPair('${p}')">✕</button></span>`).join('')}
      </div>
      <div id="corrBody" style="margin-top:14px">
        ${_corrData ? '' : '<div class="empty-state"><div class="empty-icon">📊</div><p>Click <strong>↻ Refresh data</strong> to compute the matrix.</p></div>'}
      </div>
    </div>`;
  }

  /* ══════════════════════════════════════════════════════
     TELEGRAM SETTINGS — bot integration for phone alerts
  ══════════════════════════════════════════════════════ */
  function renderTelegram() {
    const token   = (typeof Telegram !== 'undefined') ? Telegram.getToken() : '';
    const chat    = (typeof Telegram !== 'undefined') ? Telegram.getChat() : '';
    const enabled = (typeof Telegram !== 'undefined') ? Telegram.getEnabled() : false;
    const log     = (typeof Telegram !== 'undefined') ? Telegram.getLog() : [];
    const masked  = token ? token.slice(0,8) + '••••' + token.slice(-4) : '';
    return `<div class="pro-section">
      <h3 class="pro-hdr">🔔 Telegram Bot — Dino Alerts</h3>
      <p class="text-sub" style="font-size:.85rem;margin:0 0 14px">Get pinged on your phone <strong>only</strong> when 🦖 dino fires in <strong>ICT Dojo</strong> or <strong>Scanner</strong>. Each alert includes entry, SL, TP, PD ratio, direction, and live market conditions.</p>

      <div class="tg-grid">
        <div class="form-group">
          <label>Bot Token <span class="text-xs text-sub">${token ? '· current: ' + masked : ''}</span></label>
          <input type="password" id="tgToken" value="${token}" placeholder="paste from @BotFather (e.g. 123:AAH...)" />
        </div>
        <div class="form-group">
          <label>Chat ID</label>
          <div style="display:flex;gap:6px">
            <input type="text" id="tgChat" value="${chat}" placeholder="auto-discover or paste manually" style="flex:1" />
            <button class="btn-ghost" id="tgDiscoverBtn" title="Auto-find from /getUpdates (DM your bot first)">🔍 Find</button>
          </div>
        </div>
        <div class="form-group">
          <label>Enabled</label>
          <label class="tg-switch">
            <input type="checkbox" id="tgEnabled"${enabled?' checked':''} />
            <span class="tg-slider"></span>
          </label>
        </div>
      </div>

      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:14px">
        <button class="btn-primary" id="tgSaveBtn">💾 Save</button>
        <button class="btn-ghost" id="tgTestBtn">📨 Send Test Message</button>
        <span id="tgStatus" class="text-dim" style="font-size:.82rem;align-self:center"></span>
      </div>

      <h4 class="pro-hdr" style="font-size:.88rem;margin-top:20px">📜 Recent sends (last ${log.length})</h4>
      ${log.length ? `<div class="tg-log">
        ${log.map(e => `<div class="tg-log-row">
          <span class="tg-log-icon">${e.ok ? '✅' : '⚠'}</span>
          <span class="tg-log-time text-dim">${new Date(e.time).toLocaleString()}</span>
          <span class="tg-log-text">${(e.text || '').slice(0,80).replace(/\n/g,' ')}${(e.text||'').length>80?'…':''}</span>
          ${!e.ok ? `<span style="color:var(--red);font-size:.75rem">${e.err||''}</span>` : ''}
        </div>`).join('')}
      </div>` : '<p class="text-dim" style="font-size:.85rem">No messages sent yet.</p>'}

      <div class="pro-tip" style="margin-top:14px">
        <strong>How alerts trigger:</strong> Scanner (every 60s) and ICT Dojo (every 60s) both check for dino conditions on each scan. When 3+ PD confluence aligns inside an active killzone with a confirming sweep, you get a single alert per pair (10-min throttle to prevent spam).
      </div>
    </div>`;
  }

  function wireTelegram() {
    document.getElementById('tgSaveBtn')?.addEventListener('click', () => {
      Telegram.setToken(document.getElementById('tgToken').value.trim());
      Telegram.setChat(document.getElementById('tgChat').value.trim());
      Telegram.setEnabled(document.getElementById('tgEnabled').checked);
      if (typeof toast === 'function') toast('Telegram settings saved', 'success');
      render();
    });
    document.getElementById('tgDiscoverBtn')?.addEventListener('click', async () => {
      const status = document.getElementById('tgStatus');
      const tokenInput = document.getElementById('tgToken').value.trim();
      if (!tokenInput) { status.textContent = '⚠ Paste token first'; status.style.color = 'var(--red)'; return; }
      Telegram.setToken(tokenInput);
      status.textContent = 'Looking…'; status.style.color = 'var(--gold)';
      try {
        const id = await Telegram.discoverChatId();
        document.getElementById('tgChat').value = id;
        status.textContent = '✅ Found: ' + id; status.style.color = 'var(--green)';
      } catch (e) { status.textContent = '⚠ ' + e.message; status.style.color = 'var(--red)'; }
    });
    document.getElementById('tgTestBtn')?.addEventListener('click', async () => {
      const status = document.getElementById('tgStatus');
      Telegram.setToken(document.getElementById('tgToken').value.trim());
      Telegram.setChat(document.getElementById('tgChat').value.trim());
      Telegram.setEnabled(true);
      status.textContent = 'Sending…'; status.style.color = 'var(--gold)';
      try {
        await Telegram.send(`🧪 *Test from AI Dashboard Pro*\n\nIf you see this on your phone, alerts are working ✅\n\n_Sent ${new Date().toLocaleString()}_`, { force: true });
        status.textContent = '✅ Message sent! Check your phone.'; status.style.color = 'var(--green)';
        setTimeout(render, 1500);
      } catch (e) { status.textContent = '⚠ ' + e.message; status.style.color = 'var(--red)'; }
    });
  }

  /* ── Tab nav ────────────────────────────────────────── */
  function render() {
    const content = document.getElementById('content');
    content.innerHTML = `<div class="pro-wrap">
      <div class="pro-subnav">
        <button class="pro-sub-btn${_sub==='sizer'?' active':''}" data-sub="sizer">📐 Position Sizer</button>
        <button class="pro-sub-btn${_sub==='qstats'?' active':''}" data-sub="qstats">📊 Quick Stats</button>
        <button class="pro-sub-btn${_sub==='replay'?' active':''}" data-sub="replay">▶ Trade Replay</button>
        <button class="pro-sub-btn${_sub==='corr'?' active':''}" data-sub="corr">📊 Correlation</button>
        <button class="pro-sub-btn${_sub==='telegram'?' active':''}" data-sub="telegram">🔔 Telegram</button>
      </div>
      <div id="proBody">${
        _sub === 'sizer'   ? renderSizer() :
        _sub === 'qstats'  ? `<div class="pro-section"><div class="qs-wrap" style="padding:0">${typeof QuickStatsTab !== 'undefined' ? QuickStatsTab._renderHTML() : '<div class="empty-state">QuickStatsTab not loaded</div>'}</div></div>` :
        _sub === 'replay'  ? renderReplay() :
        _sub === 'telegram'? renderTelegram() :
        renderCorrelation()
      }</div>
    </div>`;

    // Subnav wiring
    document.querySelectorAll('.pro-sub-btn').forEach(b => {
      b.addEventListener('click', () => { saveSub(b.dataset.sub); render(); });
    });

    // Sub-feature wiring
    if (_sub === 'sizer') {
      ['psAccount','psRisk','psEntry','psStop','psTP'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('input', renderSizerResult);
      });
      document.getElementById('psSaveBtn')?.addEventListener('click', () => {
        _sizerCfg.account = parseFloat(document.getElementById('psAccount').value) || 10000;
        _sizerCfg.riskPct = parseFloat(document.getElementById('psRisk').value) || 1;
        saveSizer();
        if (typeof toast === 'function') toast('Defaults saved', 'success');
      });
    } else if (_sub === 'qstats') {
      if (typeof QuickStatsTab !== 'undefined') QuickStatsTab._wireUp();
    } else if (_sub === 'telegram') {
      wireTelegram();
    } else if (_sub === 'replay') {
      document.getElementById('rpTrade')?.addEventListener('change', e => {
        if (e.target.value) runReplay(e.target.value);
      });
    } else if (_sub === 'corr') {
      document.getElementById('corrLoadBtn')?.addEventListener('click', loadCorrData);
      document.getElementById('corrAddBtn')?.addEventListener('click', () => {
        const v = document.getElementById('corrAddInput').value.trim().toUpperCase();
        if (!v) return;
        const sym = v.endsWith('USDT') ? v : v + 'USDT';
        if (!_corrPairs.includes(sym)) { _corrPairs.push(sym); saveCorr(); render(); }
      });
      if (_corrData) renderCorrTable();
    }
  }

  return {
    render,
    _removeCorrPair: sym => {
      _corrPairs = _corrPairs.filter(p => p !== sym);
      saveCorr();
      _corrData = null;
      render();
    },
  };
})();
