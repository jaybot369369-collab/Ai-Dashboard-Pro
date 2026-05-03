/* ═══════════════════════════════════════════════════════════
   DAILY REPORT TAB
   Reads js/data/daily_report.json (generated server-side by the
   /Daily_Report skill on Mon-Fri at midnight via launchd) and
   renders the same content as the daily PDF.
════════════════════════════════════════════════════════════ */
const DailyReportTab = (() => {

  let _data = null;
  let _err = null;
  let _loading = false;

  async function load() {
    _loading = true; _err = null;
    try {
      // Cache-bust via timestamp so we always get the freshest JSON
      const r = await fetch('js/data/daily_report.json?t=' + Date.now());
      if (!r.ok) throw new Error('report fetch ' + r.status);
      _data = await r.json();
    } catch (e) {
      _err = e.message;
    } finally {
      _loading = false;
    }
  }

  function fmtAge(iso) {
    if (!iso) return '—';
    const ms = Date.now() - new Date(iso).getTime();
    const m = Math.round(ms / 60000);
    if (m < 60)  return `${m}m ago`;
    const h = Math.round(m / 60);
    if (h < 48)  return `${h}h ago`;
    const d = Math.round(h / 24);
    return `${d}d ago`;
  }

  function biasBadge(b) {
    const cls = b === 'LONG' ? 'dr-bias-long' : b === 'SHORT' ? 'dr-bias-short' : 'dr-bias-neutral';
    return `<span class="dr-bias ${cls}">${b}</span>`;
  }
  function priorityPill(p) {
    const cls = p === 'HIGH' ? 'dr-pri-high' : p === 'MEDIUM' ? 'dr-pri-med' : 'dr-pri-low';
    return `<span class="dr-pri ${cls}">${p}</span>`;
  }
  function impactPill(i) {
    const cls = i === 'RED' ? 'dr-imp-red' : i === 'ORANGE' ? 'dr-imp-orange' : 'dr-imp-yellow';
    return `<span class="dr-imp ${cls}">${i}</span>`;
  }

  function renderTickerCard(t) {
    const isSpotRow = row => row[0].includes('Spot');
    const chgColor = c => c.startsWith('-') ? 'var(--red)' : 'var(--green)';
    return `<div class="dr-ticker">
      <div class="dr-ticker-hdr">
        <div class="dr-ticker-left">
          <h2 class="dr-sym">${t.sym}<span class="dr-sym-name">/USD</span></h2>
          <div class="dr-prices">
            <span class="dr-price">${t.price}</span>
            <span class="dr-chg" style="color:${chgColor(t.chg24)}">${t.chg24} 24h</span>
            <span class="dr-chg" style="color:${chgColor(t.chg7)}">${t.chg7} 7d</span>
          </div>
          <div class="dr-meta">Vol ${t.vol} · MCap ${t.mcap}</div>
        </div>
        <div class="dr-ticker-right">${biasBadge(t.bias)} ${priorityPill(t.priority)}</div>
      </div>

      <p class="dr-thesis">${t.thesis}</p>

      <div class="dr-section">
        <div class="dr-sec-hdr">📍 Key Levels</div>
        <table class="dr-levels">
          ${t.levels.map(l => `<tr class="${isSpotRow(l) ? 'dr-spot' : ''}">
            <td class="dr-lvl-label">${l[0]}</td>
            <td class="dr-lvl-price">${l[1]}</td>
            <td class="dr-lvl-note">${l[2]}</td>
          </tr>`).join('')}
        </table>
      </div>

      <div class="dr-setup">
        <div class="dr-sec-hdr">🎯 Trade Setup</div>
        <div class="dr-setup-row"><span class="dr-setup-lbl">Entry</span><span class="dr-setup-val">${t.setup.entry}</span></div>
        <div class="dr-setup-row"><span class="dr-setup-lbl">Stop</span><span class="dr-setup-val" style="color:var(--red)">${t.setup.stop}</span></div>
        <div class="dr-setup-row"><span class="dr-setup-lbl">TP1</span><span class="dr-setup-val" style="color:var(--green)">${t.setup.tp1}</span></div>
        <div class="dr-setup-row"><span class="dr-setup-lbl">TP2</span><span class="dr-setup-val" style="color:var(--green)">${t.setup.tp2}</span></div>
        <div class="dr-setup-row"><span class="dr-setup-lbl">⚠ Invalidation</span><span class="dr-setup-val">${t.setup.invalidation}</span></div>
      </div>

      <div class="dr-twocol">
        <div class="dr-section">
          <div class="dr-sec-hdr">📰 Catalysts</div>
          <ul class="dr-list">${t.catalysts.map(c => `<li>${c}</li>`).join('')}</ul>
        </div>

        <div class="dr-section">
          <div class="dr-sec-hdr">💧 Liquidity Map</div>
          <div class="dr-liq-block">
            <div class="dr-liq-hdr" style="color:var(--red)">▲ Above</div>
            ${t.liq_above.map(l => `<div class="dr-liq-row"><span class="dr-liq-tf">${l[0]}</span><span class="dr-liq-px">${l[1]}</span><span class="dr-liq-note">${l[2]}</span></div>`).join('')}
          </div>
          <div class="dr-liq-block">
            <div class="dr-liq-hdr" style="color:var(--green)">▼ Below</div>
            ${t.liq_below.map(l => `<div class="dr-liq-row"><span class="dr-liq-tf">${l[0]}</span><span class="dr-liq-px">${l[1]}</span><span class="dr-liq-note">${l[2]}</span></div>`).join('')}
          </div>
        </div>
      </div>
    </div>`;
  }

  function renderMacro(events) {
    if (!events || !events.length) return '';
    return `<div class="dr-section dr-macro">
      <div class="dr-sec-hdr">📅 This Week's Macro Events</div>
      <table class="dr-macro-table">
        <thead><tr><th>When</th><th>Event</th><th>Impact</th><th>Notes</th></tr></thead>
        <tbody>${events.map(e => `<tr>
          <td class="dr-macro-when">${e.date}</td>
          <td class="dr-macro-name">${e.name}</td>
          <td>${impactPill(e.impact)}</td>
          <td class="dr-macro-desc">${e.desc}</td>
        </tr>`).join('')}</tbody>
      </table>
    </div>`;
  }

  function renderInsights(insights) {
    if (!insights || !insights.length) return '';
    return `<div class="dr-section">
      <div class="dr-sec-hdr">💡 Analyst Insights</div>
      ${insights.map(i => `<div class="dr-insight">
        <div class="dr-insight-title">${i.title}</div>
        <div class="dr-insight-body">${i.body}</div>
      </div>`).join('')}
    </div>`;
  }

  async function render() {
    const content = document.getElementById('content');
    content.innerHTML = `<div class="dr-wrap"><div class="loading-state">Loading daily report…</div></div>`;
    if (!_data || (Date.now() - new Date(_data.generated).getTime()) > 60*60*1000) {
      await load();
    }
    if (_err) {
      content.innerHTML = `<div class="dr-wrap"><div class="empty-state"><div class="empty-icon">⚠️</div>
        <p>Could not load daily report: ${_err}</p>
        <p class="text-dim" style="font-size:.85rem">Run <code>/Daily_Report</code> in Claude Code to generate <code>js/data/daily_report.json</code>.</p>
      </div></div>`;
      return;
    }
    const d = _data;
    content.innerHTML = `<div class="dr-wrap">
      <div class="dr-hdr">
        <div>
          <h1 class="dr-title">📰 Daily Report</h1>
          <div class="dr-subtitle">${d.weekday} · ${d.date} · refreshed ${fmtAge(d.generated)}</div>
        </div>
        <button class="btn-ghost btn-sm" onclick="DailyReportTab._refresh()">↻ Refresh</button>
      </div>

      ${d.context ? `<div class="dr-context"><div class="dr-sec-hdr">🌐 Market Context</div><p>${d.context}</p></div>` : ''}

      <div class="dr-tickers">
        ${d.tickers.map(renderTickerCard).join('')}
      </div>

      ${renderMacro(d.macro_today)}
      ${renderInsights(d.insights)}

      <div class="dr-footer text-dim" style="font-size:.78rem;text-align:center;margin-top:24px">
        Generated by /Daily_Report skill · ${d.generated}<br>
        Auto-regenerates Mon–Fri at midnight via launchd
      </div>
    </div>`;
  }

  return {
    render,
    _refresh: async () => { await load(); render(); },
  };
})();
