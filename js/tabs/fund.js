/* ═══════════════════════════════════════════════════════════
   BOT FARM TAB
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

  function esc(s) {
    if (s === undefined || s === null) return '';
    return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  }
  function safeUrl(u) {
    if (!u || typeof u !== 'string') return LOCAL_URL;
    return /^https?:\/\//i.test(u) ? u : LOCAL_URL;
  }

  function _isLocal() {
    const h = window.location.hostname;
    return h === 'localhost' || h === '127.0.0.1' || h === '' || h === '0.0.0.0';
  }

  function _resolveUrl() {
    // Always prefer an explicit override the user has saved.
    // Otherwise fall back to localhost regardless of where the
    // dashboard itself is served from (github.io, tunnel, etc.).
    const override = (localStorage.getItem(LS_KEY) || '').trim();
    const candidate = override || LOCAL_URL;
    return safeUrl(candidate).replace(/\/?$/, '/');
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
    if (!remote) {
      // Local: just show a spinner — auto-retry kicks in, no user action needed
      return `
        <div class="lw-offline" style="text-align:center; padding:60px 20px;">
          <div class="lw-offline-icon">🏦</div>
          <h2 class="lw-offline-title" style="margin-bottom:12px;">Connecting to Bot Farm API…</h2>
          <p class="lw-offline-sub" style="opacity:.6;">Starting up at <code>localhost:8767</code> — will connect automatically.</p>
        </div>`;
    }
    // Remote: still show the URL override input for Cloudflare tunnels
    return `
      <div class="lw-offline">
        <div class="lw-offline-icon">🏦</div>
        <h2 class="lw-offline-title">Mini-Hedge Fund API server offline</h2>
        <p class="lw-offline-sub">Couldn't reach the fund API at <code>${esc(url)}</code>.
        If you're tunnelling through Cloudflare, paste the public URL below.</p>

        <div class="lw-offline-cmd">
          <div class="lw-cmd-label">PUBLIC FUND-API URL:</div>
          <div style="display:flex; gap:8px; align-items:center;">
            <input id="fundUrlInput" type="text" spellcheck="false" autocomplete="off"
              placeholder="https://xxx.trycloudflare.com"
              value="${esc(currentOverride)}"
              style="flex:1; padding:8px 10px; background:#0d1117; color:#fff; border:1px solid #30363d; border-radius:6px; font-family:'SF Mono',Menlo,monospace; font-size:12px;">
            <button class="btn-primary" id="fundSaveUrl">Save &amp; retry</button>
          </div>
          <div style="margin-top:6px; font-size:11px; opacity:.65;">Tip: leave blank to fall back to localhost.</div>
        </div>

        <div class="lw-offline-actions">
          <button class="btn-primary" id="fundRetry">Retry</button>
          <a class="btn-ghost" href="${esc(safeUrl(url))}" target="_blank" rel="noopener">Open in new tab</a>
        </div>
      </div>`;
  }

  function _liveHTML(url, health) {
    const safe = esc(safeUrl(url));
    const ks = (health && health.kill_state && health.kill_state.state) || 'unknown';
    const nBots = (health && health.bots) ? health.bots.length : 0;
    const nHealthy = (health && health.bots)
      ? health.bots.filter(b => b.status === 'healthy').length : 0;
    const dotClass = ks === 'running' ? 'live' : 'warn';
    return `
      <div class="lw-header">
        <div class="lw-header-left">
          <span class="lw-dot ${dotClass}"></span>
          <span class="lw-status">kill_state = ${esc(ks)} · ${nHealthy}/${nBots} bots healthy</span>
        </div>
        <div class="lw-header-right">
          <button class="btn-ghost" id="fundRunSensei" title="Trigger Sensei AI coach report (runs in ~2 min)">🧠 Run Sensei</button>
          <a class="btn-ghost" href="${safe}" target="_blank" rel="noopener" title="Open standalone in new browser tab">↗ Pop out</a>
        </div>
      </div>
      <iframe class="lw-frame" src="${safe}"
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
        referrerpolicy="no-referrer"></iframe>`;
  }

  let _retryTimer = null;

  async function render() {
    const content = document.getElementById('content');
    if (!content) return;

    // Cancel any pending auto-retry before starting a fresh render
    if (_retryTimer) { clearTimeout(_retryTimer); _retryTimer = null; }

    content.innerHTML = `<div class="lw-loading">Checking Bot Farm API…</div>`;

    // Step 1: always silently probe localhost first, regardless of
    // where the dashboard is hosted (github.io, tunnel, anywhere).
    let url = LOCAL_URL;
    let health = await _serverAlive(LOCAL_URL);

    // Step 2: if localhost didn't respond, try any saved override URL.
    if (!health) {
      const override = (localStorage.getItem(LS_KEY) || '').trim();
      if (override && override !== LOCAL_URL) {
        url = safeUrl(override).replace(/\/?$/, '/');
        health = await _serverAlive(url);
      }
    }

    if (health) {
      content.innerHTML = _liveHTML(url, health);
      // Wire "Run Sensei" button
      const senseiBtn = document.getElementById('fundRunSensei');
      if (senseiBtn) {
        senseiBtn.addEventListener('click', async () => {
          senseiBtn.disabled = true;
          senseiBtn.textContent = '⏳ Running…';
          try {
            const r = await fetch(url + 'api/coach/run_now', {
              method: 'POST', mode: 'cors', cache: 'no-store',
              signal: AbortSignal.timeout ? AbortSignal.timeout(10000) : undefined,
            });
            const d = await r.json().catch(() => ({}));
            if (r.ok) {
              senseiBtn.textContent = '✓ Queued';
              setTimeout(() => { senseiBtn.textContent = '🧠 Run Sensei'; senseiBtn.disabled = false; }, 4000);
            } else {
              senseiBtn.textContent = '✗ Error';
              setTimeout(() => { senseiBtn.textContent = '🧠 Run Sensei'; senseiBtn.disabled = false; }, 3000);
            }
          } catch (_) {
            senseiBtn.textContent = '✗ Offline';
            setTimeout(() => { senseiBtn.textContent = '🧠 Run Sensei'; senseiBtn.disabled = false; }, 3000);
          }
        });
      }
    } else {
      // Neither localhost nor override responded — auto-retry every 3s.
      // Only show the URL input form if the user has explicitly opened it.
      content.innerHTML = _offlineHTML(url);
      _retryTimer = setTimeout(() => render(), 3000);
      // Wire up the manual override form (shown only in remote offline HTML)
      const retry = document.getElementById('fundRetry');
      if (retry) retry.addEventListener('click', () => { clearTimeout(_retryTimer); render(); });
      const save = document.getElementById('fundSaveUrl');
      if (save) save.addEventListener('click', () => {
        const input = document.getElementById('fundUrlInput');
        const v = (input?.value || '').trim();
        if (v) {
          if (!/^https?:\/\//i.test(v)) { alert('URL must start with http:// or https://'); return; }
          localStorage.setItem(LS_KEY, v);
        } else {
          localStorage.removeItem(LS_KEY);
        }
        clearTimeout(_retryTimer);
        render();
      });
    }
  }

  return { render };
})();
