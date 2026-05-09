/* ═══════════════════════════════════════════════════════════
   MINI-HEDGE FUND TAB
   Embeds the fund's read-only dashboard (FastAPI on 8767).

   Local access (dashboard opened on host): http://127.0.0.1:8767/
   Remote access (dashboard via tunnel):    user-set public URL,
                                             persisted in localStorage.

   The standalone dashboard exposes status + bot health + positions
   + intents + escalations + risk events, plus PIN-gated
   /halt /resume /unlock buttons. Starting it:

       cd "Mini Hedge Fund" && python3 -m fund.api
═══════════════════════════════════════════════════════════ */
const FundTab = (() => {

  const LOCAL_URL  = 'http://127.0.0.1:8767/';
  const PUBLIC_FALLBACK = '';                        // No public default; user must set
  const LS_KEY = 'fund_remote_url';

  function _isLocal() {
    const h = window.location.hostname;
    return h === 'localhost' || h === '127.0.0.1' || h === '' || h === '0.0.0.0';
  }

  function _resolveUrl() {
    if (_isLocal()) return LOCAL_URL;
    const override = (localStorage.getItem(LS_KEY) || '').trim();
    return (override || PUBLIC_FALLBACK || LOCAL_URL).replace(/\/?$/, '/');
  }

  async function _serverAlive(baseUrl) {
    try {
      const r = await fetch(baseUrl + 'api/health', {
        method: 'GET', mode: 'cors', cache: 'no-store',
        signal: AbortSignal.timeout ? AbortSignal.timeout(4000) : undefined,
      });
      if (!r.ok) return null;
      return await r.json();
    } catch (_) {
      return null;
    }
  }

  function _offlineHTML(url) {
    const remote = !_isLocal();
    const currentOverride = localStorage.getItem(LS_KEY) || '';
    return `
      <div class="lw-offline">
        <div class="lw-offline-icon">🏦</div>
        <h2 class="lw-offline-title">Mini-Hedge Fund API server offline</h2>
        ${remote ? `
          <p class="lw-offline-sub">Couldn't reach the fund API at <code>${url}</code>.
          If you're tunnelling through Cloudflare, paste the public URL below.</p>

          <div class="lw-offline-cmd">
            <div class="lw-cmd-label">Public fund-API URL:</div>
            <div style="display:flex; gap:8px; align-items:center;">
              <input id="fundUrlInput" type="text" spellcheck="false" autocomplete="off"
                placeholder="https://xxx.trycloudflare.com"
                value="${currentOverride}"
                style="flex:1; padding:8px 10px; background:#0d1117; color:#fff; border:1px solid #30363d; border-radius:6px; font-family:'SF Mono',Menlo,monospace; font-size:12px;">
              <button class="btn-primary" id="fundSaveUrl">Save &amp; retry</button>
            </div>
            <div style="margin-top:6px; font-size:11px; opacity:.65;">Tip: leave blank to fall back to localhost.</div>
          </div>
        ` : `
          <p class="lw-offline-sub">The fund API at <code>localhost:8767</code> isn't responding.
          This tab embeds the dashboard served by <code>fund.api</code>. Start it from a terminal:</p>

          <div class="lw-offline-cmd">
            <div class="lw-cmd-label">Start it:</div>
            <pre><code>cd "_CLAUDE PROJECTS/Mini Hedge Fund"
python3 -m fund.api</code></pre>
          </div>

          <div class="lw-offline-cmd">
            <div class="lw-cmd-label">Or use the launcher script (starts API + 7 fund bots):</div>
            <pre><code>cd "_CLAUDE PROJECTS/Mini Hedge Fund/backtest_runs"
./fund_paper_trade.sh start</code></pre>
          </div>

          <div class="lw-offline-cmd">
            <div class="lw-cmd-label">Restart if it's stuck:</div>
            <pre><code>lsof -ti:8767 | xargs kill -9 \\
  && cd "_CLAUDE PROJECTS/Mini Hedge Fund" \\
  &amp;&amp; nohup python3 -m fund.api &gt; /tmp/fund-api.log 2&gt;&amp;1 &amp;</code></pre>
          </div>
        `}

        <div class="lw-offline-actions">
          <button class="btn-primary" id="fundRetry">Retry</button>
          <a class="btn-ghost" href="${url}" target="_blank" rel="noopener">Open in new tab</a>
        </div>
      </div>`;
  }

  function _liveHTML(url, health) {
    const ks = (health && health.kill_state && health.kill_state.state) || 'unknown';
    const nBots = (health && health.bots) ? health.bots.length : 0;
    const nHealthy = (health && health.bots)
      ? health.bots.filter(b => b.status === 'healthy').length : 0;
    const dotClass = ks === 'running' ? 'live' : 'warn';
    return `
      <div class="lw-header">
        <div class="lw-header-left">
          <span class="lw-dot ${dotClass}"></span>
          <span class="lw-status">kill_state = ${ks} · ${nHealthy}/${nBots} bots healthy</span>
        </div>
        <div class="lw-header-right">
          <a class="btn-ghost" href="${url}" target="_blank" rel="noopener" title="Open standalone in new browser tab">↗ Pop out</a>
        </div>
      </div>
      <iframe class="lw-frame" src="${url}"
        referrerpolicy="no-referrer"></iframe>`;
  }

  async function render() {
    const content = document.getElementById('content');
    if (!content) return;

    content.innerHTML = `<div class="lw-loading">Checking Mini-Hedge Fund API…</div>`;

    const url = _resolveUrl();
    const health = await _serverAlive(url);
    if (health) {
      content.innerHTML = _liveHTML(url, health);
    } else {
      content.innerHTML = _offlineHTML(url);
      const retry = document.getElementById('fundRetry');
      if (retry) retry.addEventListener('click', () => render());
      const save = document.getElementById('fundSaveUrl');
      if (save) save.addEventListener('click', () => {
        const input = document.getElementById('fundUrlInput');
        const v = (input?.value || '').trim();
        if (v) localStorage.setItem(LS_KEY, v);
        else localStorage.removeItem(LS_KEY);
        render();
      });
    }
  }

  return { render };
})();
