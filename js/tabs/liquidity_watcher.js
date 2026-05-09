/* ═══════════════════════════════════════════════════════════
   LIQUIDITY WATCHER TAB
   Embeds the standalone Crypto Liquidity Watcher dashboard
   (FastAPI + WS).

   Local access (dashboard opened on the host machine):
     uses http://127.0.0.1:8766/

   Remote access (dashboard opened via Cloudflare tunnel from
   another machine): uses the public LW tunnel URL. Default
   value below; user can override at runtime via the offline
   panel — value persists in localStorage('lw_remote_url').
════════════════════════════════════════════════════════════ */
const LiquidityWatcherTab = (() => {

  const LOCAL_URL  = 'http://127.0.0.1:8766/';
  // Cloudflare quick-tunnel URLs rotate per session, so no hardcoded fallback —
  // remote users paste the live URL into the offline panel; persists in localStorage.
  const PUBLIC_LW_FALLBACK = '';
  const LS_KEY = 'lw_remote_url';

  function _isLocal() {
    const h = window.location.hostname;
    return h === 'localhost' || h === '127.0.0.1' || h === '' || h === '0.0.0.0';
  }

  function _resolveUrl() {
    if (_isLocal()) return LOCAL_URL;
    const override = (localStorage.getItem(LS_KEY) || '').trim();
    // Empty override + empty fallback → show LOCAL_URL so the offline panel
    // displays a clear "you need a tunnel" indicator (same pattern as fund.js).
    return (override || PUBLIC_LW_FALLBACK || LOCAL_URL).replace(/\/?$/, '/');
  }

  async function _serverAlive(baseUrl) {
    try {
      const r = await fetch(baseUrl + 'api/health', { method: 'GET', mode: 'cors', cache: 'no-store',
        signal: AbortSignal.timeout ? AbortSignal.timeout(4000) : undefined });
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
        <div class="lw-offline-icon">🌊</div>
        <h2 class="lw-offline-title">Liquidity Watcher server offline</h2>
        ${remote ? `
          <p class="lw-offline-sub">Couldn't reach the Liquidity Watcher at <code>${url}</code>.
          Cloudflare quick-tunnel URLs rotate every time the tunnel restarts —
          paste the latest one below to reconnect.</p>

          <div class="lw-offline-cmd">
            <div class="lw-cmd-label">Public LW URL:</div>
            <div style="display:flex; gap:8px; align-items:center;">
              <input id="lwUrlInput" type="text" spellcheck="false" autocomplete="off"
                placeholder="https://xxx.trycloudflare.com"
                value="${currentOverride}"
                style="flex:1; padding:8px 10px; background:#0d1117; color:#fff; border:1px solid #30363d; border-radius:6px; font-family:'SF Mono',Menlo,monospace; font-size:12px;">
              <button class="btn-primary" id="lwSaveUrl">Save &amp; retry</button>
            </div>
            <div style="margin-top:6px; font-size:11px; opacity:.65;">Tip: leave blank to fall back to the bundled default.</div>
          </div>
        ` : `
          <p class="lw-offline-sub">The local FastAPI process at <code>localhost:8766</code> isn't responding.
          This tab embeds the standalone dashboard at
          <code>_CLAUDE PROJECTS/Crypto Liquidity Watcher/</code> — start it from a terminal to enable this tab.</p>

          <div class="lw-offline-cmd">
            <div class="lw-cmd-label">Start it:</div>
            <pre><code>cd "_CLAUDE PROJECTS/Crypto Liquidity Watcher"
python3 server.py</code></pre>
          </div>

          <div class="lw-offline-cmd">
            <div class="lw-cmd-label">Restart if it's stuck:</div>
            <pre><code>lsof -ti:8766 | xargs kill -9 \\
  && cd "_CLAUDE PROJECTS/Crypto Liquidity Watcher" \\
  && nohup python3 server.py &gt; /tmp/clw.log 2>&amp;1 &amp;</code></pre>
          </div>
        `}

        <div class="lw-offline-actions">
          <button class="btn-primary" id="lwRetry">Retry</button>
          <a class="btn-ghost" href="${url}" target="_blank" rel="noopener">Open in new tab</a>
        </div>
      </div>`;
  }

  function _liveHTML(url, health) {
    return `
      <div class="lw-header">
        <div class="lw-header-left">
          <span class="lw-dot live"></span>
          <span class="lw-status">connected · ${health.universe_size} assets · ${health.metrics_tracked} metrics tracked</span>
        </div>
        <div class="lw-header-right">
          <a class="btn-ghost" href="${url}" target="_blank" rel="noopener" title="Open standalone in new browser tab">↗ Pop out</a>
        </div>
      </div>
      <iframe class="lw-frame" src="${url}"
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
        loading="lazy" referrerpolicy="no-referrer"></iframe>`;
  }

  async function render() {
    const content = document.getElementById('content');
    if (!content) return;

    content.innerHTML = `<div class="lw-loading">Checking Liquidity Watcher server…</div>`;

    const url = _resolveUrl();
    const health = await _serverAlive(url);
    if (health) {
      content.innerHTML = _liveHTML(url, health);
    } else {
      content.innerHTML = _offlineHTML(url);
      const retry = document.getElementById('lwRetry');
      if (retry) retry.addEventListener('click', () => render());
      const save = document.getElementById('lwSaveUrl');
      if (save) save.addEventListener('click', () => {
        const input = document.getElementById('lwUrlInput');
        const v = (input?.value || '').trim();
        if (v) localStorage.setItem(LS_KEY, v);
        else localStorage.removeItem(LS_KEY);
        render();
      });
    }
  }

  return { render };
})();
