/* ═══════════════════════════════════════════════════════════
   AI COACH — Claude-powered trading coach
   Features:
     1. Pre-trade grader (A/B/C/D + reasoning)
     2. Screenshot auto-tag (vision → setup metadata)
     3. Daily journal prompt (evening reflection)
     4. Weekly auto-review (Monday HTML report)
   API: Anthropic Messages API direct from browser
        (anthropic-dangerous-direct-browser-access: true)
════════════════════════════════════════════════════════════ */
const AICoachTab = (() => {

  /* ── Settings & state ───────────────────────────────── */
  const KEYS = {
    apiKey:   'jb_ai_key',
    model:    'jb_ai_model',
    spend:    'jb_ai_spend',     // { month: 'YYYY-MM', inTok, outTok, calls }
    grades:   'jb_ai_grades',    // [ {time, prompt, grade, reasoning} ]
    prompts:  'jb_ai_prompts',   // { 'YYYY-MM-DD': { questions, answers } }
    reviews:  'jb_ai_reviews',   // [ {weekOf, html, summary} ]
  };

  const MODELS = {
    'claude-sonnet-4-5':   { label: 'Sonnet 4.5 (recommended)',   inP: 3,    outP: 15  },
    'claude-opus-4-5':     { label: 'Opus 4.5 (higher quality)',  inP: 15,   outP: 75  },
    'claude-haiku-4-5':    { label: 'Haiku 4.5 (cheapest)',       inP: 0.80, outP: 4   },
    'claude-sonnet-4-7':   { label: 'Sonnet 4.7 (newest)',        inP: 3,    outP: 15  },
    'claude-opus-4-7':     { label: 'Opus 4.7 (newest, premium)', inP: 15,   outP: 75  },
  };

  /* ── Helpers ────────────────────────────────────────── */
  const get  = k => localStorage.getItem(k);
  const getJ = (k, def) => { try { return JSON.parse(localStorage.getItem(k)) ?? def; } catch { return def; } };
  const setS = (k, v) => localStorage.setItem(k, v);
  const setJ = (k, v) => localStorage.setItem(k, JSON.stringify(v));

  function getKey()    { return get(KEYS.apiKey) || ''; }
  function getModel()  { return get(KEYS.model) || 'claude-sonnet-4-5'; }
  function getSpend()  {
    const month = new Date().toISOString().slice(0,7);
    const s = getJ(KEYS.spend, null);
    if (!s || s.month !== month) return { month, inTok: 0, outTok: 0, calls: 0 };
    return s;
  }
  function addSpend(inTok, outTok) {
    const s = getSpend();
    s.inTok  += inTok;
    s.outTok += outTok;
    s.calls  += 1;
    setJ(KEYS.spend, s);
  }
  function spendUSD(s, modelKey) {
    const m = MODELS[modelKey] || MODELS['claude-sonnet-4-5'];
    return (s.inTok / 1e6) * m.inP + (s.outTok / 1e6) * m.outP;
  }

  /* ── Claude API call ────────────────────────────────── */
  async function callClaude({ system, user, maxTokens = 1024, imageData = null }) {
    const apiKey = getKey();
    if (!apiKey) throw new Error('No API key set — open AI Coach tab → Settings');
    const model = getModel();

    const userContent = imageData
      ? [
          { type: 'image', source: { type: 'base64', media_type: imageData.mediaType, data: imageData.b64 } },
          { type: 'text',  text: user },
        ]
      : user;

    const body = {
      model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: userContent }],
    };

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify(body),
    });

    const json = await res.json();
    if (!res.ok) throw new Error(json.error?.message || `API ${res.status}`);

    const text = json.content?.map(b => b.type === 'text' ? b.text : '').join('') || '';
    const usage = json.usage || { input_tokens: 0, output_tokens: 0 };
    addSpend(usage.input_tokens, usage.output_tokens);

    return { text, usage };
  }

  /* ══════════════════════════════════════════════════════
     FEATURE 1 — PRE-TRADE GRADER
  ══════════════════════════════════════════════════════ */
  function buildGraderContext() {
    const trades  = (typeof DB !== 'undefined' && DB.getTrades) ? DB.getTrades().slice(-10) : [];
    const rules   = (typeof DB !== 'undefined' && DB.getRules)  ? DB.getRules() : null;
    const recent = trades.map(t => ({
      symbol: t.symbol, dir: t.direction, setup: (t.setupTypes || [t.setupType]).join('/'),
      session: t.session, preGrade: t.preGrade, postGrade: t.postGrade, r: t.rMultiple,
    }));
    return { recent, rules };
  }

  async function grade(planText) {
    const ctx = buildGraderContext();
    const system = `You are an ICT/SMC trading coach grading a trader's plan BEFORE they enter.
Grade scale:
  A — Textbook setup, all confluence aligned
  B — Solid setup, minor concerns
  C — Marginal, missing key confluence
  D — Forced trade, multiple red flags / break of rules

Use their recent trades and rules as context. Be direct and concise.

Respond in JSON only: { "grade": "A|B|C|D", "reasoning": "2-3 sentence explanation", "key_risks": ["risk 1", "risk 2"] }`;

    const user = `My plan: ${planText}

Recent trades (last 10):
${JSON.stringify(ctx.recent, null, 2)}

My rules:
${JSON.stringify(ctx.rules?.scalp?.slice(0,5) || [], null, 2)}`;

    const { text } = await callClaude({ system, user, maxTokens: 600 });
    let parsed;
    try { parsed = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] || text); }
    catch { parsed = { grade: '?', reasoning: text, key_risks: [] }; }

    // Save to history
    const hist = getJ(KEYS.grades, []);
    hist.push({ time: Date.now(), prompt: planText, ...parsed });
    setJ(KEYS.grades, hist.slice(-50));

    return parsed;
  }

  /* ══════════════════════════════════════════════════════
     FEATURE 2 — SCREENSHOT AUTO-TAG
  ══════════════════════════════════════════════════════ */
  async function autoTagImage(b64DataUrl) {
    // b64DataUrl is "data:image/jpeg;base64,XXXX"
    const m = b64DataUrl.match(/^data:(image\/[^;]+);base64,(.+)$/);
    if (!m) throw new Error('Bad image data');
    const mediaType = m[1];
    const b64       = m[2];

    const system = `You are an ICT/SMC chart analyst. Identify what's visible in this trading chart screenshot.
Return JSON only: {
  "setup_type": "FVG|OB|OTE|Sweep|BB|Other",
  "direction": "Long|Short",
  "session": "London|NY|Asian|Other",
  "key_features": ["feature 1", "feature 2"],
  "suggested_entry": "price level if visible, else null",
  "suggested_stop": "price level if visible, else null",
  "notes": "1 sentence read of the setup"
}`;
    const user = 'Analyze this chart.';
    const { text } = await callClaude({
      system, user, maxTokens: 600,
      imageData: { mediaType, b64 },
    });
    try { return JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] || text); }
    catch { return { notes: text, setup_type: '?', direction: '?', session: '?', key_features: [] }; }
  }

  /* ══════════════════════════════════════════════════════
     FEATURE 3 — DAILY JOURNAL PROMPT
  ══════════════════════════════════════════════════════ */
  async function generateDailyPrompt() {
    const today = new Date().toISOString().slice(0,10);
    const trades = (typeof DB !== 'undefined' && DB.getTrades)
      ? DB.getTrades().filter(t => t.date && t.date.startsWith(today))
      : [];

    const system = `You are a trading psychology coach. Generate 3-4 short reflective questions tailored to today's trading. Keep them specific to the trades, not generic.
Return JSON only: { "questions": ["Q1?", "Q2?", "Q3?"] }`;

    const user = `Today's trades (${today}):
${JSON.stringify(trades.map(t => ({
  symbol: t.symbol, dir: t.direction, setup: (t.setupTypes||[t.setupType]).join('/'),
  pre: t.preGrade, post: t.postGrade, r: t.rMultiple, notes: t.notes,
})), null, 2)}`;

    const { text } = await callClaude({ system, user, maxTokens: 400 });
    let parsed;
    try { parsed = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] || text); }
    catch { parsed = { questions: text.split('\n').filter(Boolean).slice(0,4) }; }

    const all = getJ(KEYS.prompts, {});
    all[today] = { questions: parsed.questions, answers: all[today]?.answers || [] };
    setJ(KEYS.prompts, all);
    return parsed;
  }

  function saveDailyAnswers(answers) {
    const today = new Date().toISOString().slice(0,10);
    const all = getJ(KEYS.prompts, {});
    if (!all[today]) all[today] = { questions: [], answers: [] };
    all[today].answers = answers;
    setJ(KEYS.prompts, all);
  }

  /* ══════════════════════════════════════════════════════
     FEATURE 4 — WEEKLY AUTO-REVIEW
  ══════════════════════════════════════════════════════ */
  function weekRange() {
    const now = new Date();
    const monday = new Date(now);
    const day = monday.getUTCDay() || 7;
    monday.setUTCDate(monday.getUTCDate() - day + 1 - 7); // last week's Monday
    const sunday = new Date(monday); sunday.setUTCDate(monday.getUTCDate() + 6);
    return { from: monday.toISOString().slice(0,10), to: sunday.toISOString().slice(0,10) };
  }

  async function generateWeeklyReview() {
    const { from, to } = weekRange();
    const trades = (typeof DB !== 'undefined' && DB.getTrades)
      ? DB.getTrades().filter(t => t.date >= from && t.date <= to)
      : [];

    if (!trades.length) throw new Error(`No trades found in ${from} → ${to}`);

    const system = `You are a structured trading coach. Generate a weekly performance review as clean HTML (no <html>/<body> tags, just inline content). Use sections:
1. <h3>📊 Summary</h3> — total trades, win rate, P&L, best/worst day
2. <h3>✅ Best setup</h3> — which setup performed best, why likely
3. <h3>⚠️ Worst setup / rule violations</h3> — what to avoid
4. <h3>🎯 3 focus areas for next week</h3> — concrete actions
Use <p>, <ul>, <li>, <strong>. Keep it punchy.`;

    const user = `Trades from ${from} to ${to}:
${JSON.stringify(trades.map(t => ({
  date: t.date, symbol: t.symbol, dir: t.direction,
  setup: (t.setupTypes||[t.setupType]).join('/'),
  session: t.session, htf: t.htfBias,
  pre: t.preGrade, post: t.postGrade, r: t.rMultiple, result: t.result,
})), null, 2)}`;

    const { text } = await callClaude({ system, user, maxTokens: 2000 });
    const all = getJ(KEYS.reviews, []);
    all.unshift({ weekOf: from, html: text, generated: Date.now() });
    setJ(KEYS.reviews, all.slice(0, 12));
    return { html: text, weekOf: from };
  }

  /* ══════════════════════════════════════════════════════
     RENDERING
  ══════════════════════════════════════════════════════ */
  function renderSettings() {
    const apiKey = getKey();
    const model = getModel();
    const spend = getSpend();
    const usd   = spendUSD(spend, model);
    const masked = apiKey ? apiKey.slice(0,8) + '••••' + apiKey.slice(-4) : '';
    return `<div class="ai-section">
      <h3 class="ai-section-hdr">⚙️ Settings</h3>
      <div class="ai-grid">
        <div class="form-group">
          <label>Anthropic API Key <span class="text-xs text-sub">(stored locally only)</span></label>
          <input type="password" id="aiKey" value="${apiKey}" placeholder="sk-ant-api03-..."${apiKey?` title="Currently: ${masked}"`:''} />
          <div class="text-xs text-sub" style="margin-top:4px">Get one at <a href="https://console.anthropic.com" target="_blank" style="color:var(--accent)">console.anthropic.com</a> · ~$5 starter credit</div>
        </div>
        <div class="form-group">
          <label>Model</label>
          <select id="aiModel">
            ${Object.entries(MODELS).map(([k,v]) => `<option value="${k}"${k===model?' selected':''}>${v.label}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label>This month's spend (estimated)</label>
          <div class="ai-spend">
            <div class="ai-spend-val">$${usd.toFixed(3)}</div>
            <div class="text-xs text-sub">${spend.calls} calls · ${(spend.inTok/1000).toFixed(1)}k in / ${(spend.outTok/1000).toFixed(1)}k out</div>
          </div>
        </div>
      </div>
      <button class="btn-primary" id="aiSaveBtn">💾 Save Settings</button>
    </div>`;
  }

  function renderGrader() {
    const hist = getJ(KEYS.grades, []).slice(-3).reverse();
    return `<div class="ai-section">
      <h3 class="ai-section-hdr">🅰️ Pre-Trade Grader</h3>
      <p class="text-sub" style="font-size:.85rem;margin:0 0 10px">Type your plan in plain English. Claude reads your last 10 trades + rules and grades it A/B/C/D.</p>
      <textarea id="aiGradeIn" rows="3" placeholder="e.g. Long BTC at 95k OTE, SL 94.2k, target 96.8k. London KZ, 4H bullish bias, sweep of Asian low..."></textarea>
      <div style="display:flex;gap:8px;margin-top:8px">
        <button class="btn-primary" id="aiGradeBtn">🧠 Grade my plan</button>
        <span id="aiGradeStatus" class="text-dim" style="font-size:.8rem;align-self:center"></span>
      </div>
      <div id="aiGradeOut" style="margin-top:14px"></div>
      ${hist.length ? `<details style="margin-top:14px"><summary class="text-sub" style="cursor:pointer;font-size:.82rem">Recent grades (${hist.length})</summary>
        <div style="margin-top:10px">${hist.map(h => `
          <div class="ai-hist-row">
            <span class="ai-grade-pill ai-grade-${h.grade}">${h.grade}</span>
            <span class="ai-hist-prompt">${(h.prompt||'').slice(0,80)}${h.prompt?.length>80?'…':''}</span>
            <span class="text-dim" style="font-size:.7rem">${new Date(h.time).toLocaleString()}</span>
          </div>
        `).join('')}</div>
      </details>` : ''}
    </div>`;
  }

  function renderDailyPrompt() {
    const today = new Date().toISOString().slice(0,10);
    const all = getJ(KEYS.prompts, {});
    const todays = all[today];
    return `<div class="ai-section">
      <h3 class="ai-section-hdr">📝 Daily Journal Prompt</h3>
      ${todays?.questions?.length ? `
        <p class="text-sub" style="font-size:.85rem;margin:0 0 10px">${today}'s reflection prompts:</p>
        <div class="ai-questions">
          ${todays.questions.map((q,i) => `
            <div class="ai-question">
              <div class="ai-q-text">${i+1}. ${q}</div>
              <textarea class="ai-q-input" data-i="${i}" rows="2" placeholder="Your answer…">${todays.answers?.[i] || ''}</textarea>
            </div>
          `).join('')}
        </div>
        <button class="btn-primary" id="aiSavePromptsBtn" style="margin-top:10px">💾 Save Answers</button>
        <button class="btn-ghost" id="aiNewPromptsBtn" style="margin-left:6px">🔄 Generate new questions</button>
      ` : `
        <p class="text-sub" style="font-size:.85rem">No prompts yet for today.</p>
        <button class="btn-primary" id="aiNewPromptsBtn">✨ Generate today's questions</button>
      `}
    </div>`;
  }

  function renderWeeklyReview() {
    const all = getJ(KEYS.reviews, []);
    const latest = all[0];
    return `<div class="ai-section">
      <h3 class="ai-section-hdr">📅 Weekly Review</h3>
      <button class="btn-primary" id="aiWeeklyBtn">🧠 Generate review for last week</button>
      <span id="aiWeeklyStatus" class="text-dim" style="font-size:.8rem;margin-left:10px"></span>
      ${latest ? `
        <div class="ai-review" style="margin-top:14px">
          <div class="text-sub" style="font-size:.78rem;margin-bottom:8px">Week of ${latest.weekOf} · generated ${new Date(latest.generated).toLocaleString()}</div>
          <div class="ai-review-body">${latest.html}</div>
        </div>
      ` : ''}
      ${all.length > 1 ? `<details style="margin-top:14px"><summary class="text-sub" style="cursor:pointer;font-size:.82rem">Past reviews (${all.length-1})</summary>
        <div style="margin-top:10px">${all.slice(1).map(r => `
          <div class="ai-hist-row" onclick="AICoachTab._showReview('${r.weekOf}')" style="cursor:pointer">
            <span class="text-sub">📅 Week of ${r.weekOf}</span>
            <span class="text-dim" style="font-size:.7rem;margin-left:auto">${new Date(r.generated).toLocaleDateString()}</span>
          </div>
        `).join('')}</div>
      </details>` : ''}
    </div>`;
  }

  function renderGradeResult(parsed) {
    const colors = { A: 'var(--green)', B: 'var(--accent)', C: 'var(--gold)', D: 'var(--red)' };
    return `<div class="ai-grade-result">
      <div class="ai-grade-big" style="background:${colors[parsed.grade]||'var(--text-sub)'}">${parsed.grade}</div>
      <div class="ai-grade-body">
        <div class="ai-grade-reasoning">${parsed.reasoning}</div>
        ${parsed.key_risks?.length ? `<div class="ai-grade-risks">
          <strong>⚠️ Key risks:</strong>
          <ul>${parsed.key_risks.map(r => `<li>${r}</li>`).join('')}</ul>
        </div>` : ''}
      </div>
    </div>`;
  }

  /* ── Public render ──────────────────────────────────── */
  function render() {
    const content = document.getElementById('content');
    const apiKey = getKey();
    content.innerHTML = `<div class="ai-wrap">
      ${!apiKey ? `<div class="ai-banner">🔑 Set your Anthropic API key below to start using AI features.</div>` : ''}
      ${renderSettings()}
      ${apiKey ? renderGrader() + renderDailyPrompt() + renderWeeklyReview() : ''}
    </div>`;

    // Wire settings
    const saveBtn = document.getElementById('aiSaveBtn');
    if (saveBtn) saveBtn.addEventListener('click', () => {
      const k = document.getElementById('aiKey').value.trim();
      const m = document.getElementById('aiModel').value;
      if (k) setS(KEYS.apiKey, k);
      setS(KEYS.model, m);
      if (typeof toast === 'function') toast('Settings saved', 'success');
      render();
    });

    if (!apiKey) return;

    // Wire grader
    document.getElementById('aiGradeBtn')?.addEventListener('click', async () => {
      const txt = document.getElementById('aiGradeIn').value.trim();
      if (!txt) return;
      const status = document.getElementById('aiGradeStatus');
      const out = document.getElementById('aiGradeOut');
      status.textContent = 'Thinking…'; status.style.color = 'var(--gold)';
      out.innerHTML = '';
      try {
        const result = await grade(txt);
        out.innerHTML = renderGradeResult(result);
        status.textContent = 'Done ✓'; status.style.color = 'var(--green)';
      } catch (e) {
        status.textContent = '⚠ ' + e.message; status.style.color = 'var(--red)';
      }
    });

    // Wire daily prompt
    document.getElementById('aiNewPromptsBtn')?.addEventListener('click', async () => {
      const btn = document.getElementById('aiNewPromptsBtn');
      btn.disabled = true; btn.textContent = 'Thinking…';
      try { await generateDailyPrompt(); render(); }
      catch (e) { btn.disabled = false; btn.textContent = '⚠ ' + e.message; }
    });
    document.getElementById('aiSavePromptsBtn')?.addEventListener('click', () => {
      const inputs = document.querySelectorAll('.ai-q-input');
      const answers = Array.from(inputs).map(i => i.value);
      saveDailyAnswers(answers);
      if (typeof toast === 'function') toast('Saved to journal', 'success');
    });

    // Wire weekly
    document.getElementById('aiWeeklyBtn')?.addEventListener('click', async () => {
      const btn = document.getElementById('aiWeeklyBtn');
      const status = document.getElementById('aiWeeklyStatus');
      btn.disabled = true; status.textContent = 'Generating (15-30s)…'; status.style.color = 'var(--gold)';
      try { await generateWeeklyReview(); render(); }
      catch (e) { status.textContent = '⚠ ' + e.message; status.style.color = 'var(--red)'; btn.disabled = false; }
    });
  }

  return {
    render,
    // Public API for use from other tabs (e.g. trade form auto-tag button)
    autoTagImage,
    grade,
    _showReview: (weekOf) => {
      const all = getJ(KEYS.reviews, []);
      const r = all.find(x => x.weekOf === weekOf);
      if (!r) return;
      const w = window.open('', '_blank');
      w.document.write(`<html><head><title>Review · Week of ${weekOf}</title><style>body{font-family:system-ui;max-width:720px;margin:30px auto;padding:0 20px;line-height:1.55;color:#222}h3{margin-top:24px;color:#0a3}</style></head><body>${r.html}</body></html>`);
      w.document.close();
    },
  };
})();
