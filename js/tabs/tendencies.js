/* ═══════════════════════════════════════════════════════════
   TENDENCIES — merged Mistakes + Strengths
   Same card UI as before, sub-nav switches between the two lists.
════════════════════════════════════════════════════════════ */
const TendenciesTab = (() => {

  let _sub = localStorage.getItem('jb_tend_sub') || 'mistakes';

  function saveSub(s) { _sub = s; localStorage.setItem('jb_tend_sub', s); }

  /* ── Card grid renderer (works for both kinds) ──────── */
  function renderGrid(kind) {
    const items = kind === 'mistakes' ? DB.getMistakes() : DB.getStrengths();
    const isMis = kind === 'mistakes';
    const accent = isMis ? 'var(--red)' : 'var(--green)';
    const accentBg = isMis ? 'rgba(255,80,90,.08)' : 'rgba(0,200,150,.08)';
    const addLabel = isMis ? '＋ Add Mistake' : '＋ Add Strength';
    if (!items.length) {
      return `<div class="empty-state"><div class="empty-icon">${isMis?'⚠️':'💪'}</div>
        <p>No ${isMis?'mistakes':'strengths'} logged yet.</p>
        <button class="btn-primary" onclick="TendenciesTab._add('${kind}')" style="margin-top:12px">${addLabel}</button>
      </div>`;
    }
    return `<div style="display:flex;justify-content:flex-end;margin-bottom:10px">
        <button class="btn-primary btn-sm" onclick="TendenciesTab._add('${kind}')">${addLabel}</button>
      </div>
      <div class="tend-grid">
        ${items.map(it => `<div class="tend-card" style="border-left:3px solid ${accent};background:${accentBg}">
          <div class="tend-card-hdr">
            <div class="tend-title" contenteditable="true" data-id="${it.id}" data-kind="${kind}" data-field="title" oninput="TendenciesTab._edit(event)">${it.title || '(untitled)'}</div>
            <div class="tend-card-actions">
              <span class="tend-counter" title="Times seen">×${it.seenCount || 0}</span>
              <button class="btn-ghost btn-sm" onclick="TendenciesTab._inc('${kind}','${it.id}')" title="+1 occurrence">＋</button>
              <button class="btn-ghost btn-sm" onclick="TendenciesTab._delete('${kind}','${it.id}')" title="Delete">✕</button>
            </div>
          </div>
          <div class="tend-desc" contenteditable="true" data-id="${it.id}" data-kind="${kind}" data-field="description" oninput="TendenciesTab._edit(event)">${it.description || ''}</div>
          <div class="tend-meta">
            <span class="text-dim">Last seen: ${it.lastSeen || '—'}</span>
            <span class="text-dim" style="margin-left:auto">Linked trades: ${(it.linkedTradeIds||[]).length}</span>
          </div>
        </div>`).join('')}
      </div>`;
  }

  /* ── Public render ──────────────────────────────────── */
  function render() {
    const content = document.getElementById('content');
    content.innerHTML = `<div class="tend-wrap">
      <div class="tend-subnav">
        <button class="tend-sub-btn${_sub==='mistakes' ?' active mistakes':''}" data-sub="mistakes">⚠️ Mistakes</button>
        <button class="tend-sub-btn${_sub==='strengths'?' active strengths':''}" data-sub="strengths">💪 Strengths</button>
      </div>
      <div id="tendBody">${renderGrid(_sub)}</div>
    </div>`;
    document.querySelectorAll('.tend-sub-btn').forEach(b => {
      b.addEventListener('click', () => { saveSub(b.dataset.sub); render(); });
    });
  }

  /* ── Edit / CRUD wiring ─────────────────────────────── */
  let _saveTimer = null;
  function _edit(e) {
    const el = e.target;
    const { id, kind, field } = el.dataset;
    clearTimeout(_saveTimer);
    _saveTimer = setTimeout(() => {
      const items = kind === 'mistakes' ? DB.getMistakes() : DB.getStrengths();
      const it = items.find(x => x.id === id);
      if (!it) return;
      it[field] = el.textContent.trim();
      if (kind === 'mistakes') DB.saveMistakes(items); else DB.saveStrengths(items);
    }, 400);
  }

  function _add(kind) {
    const title = prompt(`New ${kind === 'mistakes' ? 'mistake' : 'strength'} title:`);
    if (!title) return;
    const items = kind === 'mistakes' ? DB.getMistakes() : DB.getStrengths();
    const newItem = {
      id: 'tend_' + Date.now(),
      title: title.trim(),
      description: '',
      dateAdded: new Date().toISOString().slice(0,10),
      seenCount: 0,
      lastSeen: '',
      linkedTradeIds: [],
    };
    items.push(newItem);
    if (kind === 'mistakes') DB.saveMistakes(items); else DB.saveStrengths(items);
    render();
  }

  function _delete(kind, id) {
    if (!confirm('Delete this entry?')) return;
    let items = kind === 'mistakes' ? DB.getMistakes() : DB.getStrengths();
    items = items.filter(x => x.id !== id);
    if (kind === 'mistakes') DB.saveMistakes(items); else DB.saveStrengths(items);
    render();
  }

  function _inc(kind, id) {
    const items = kind === 'mistakes' ? DB.getMistakes() : DB.getStrengths();
    const it = items.find(x => x.id === id);
    if (!it) return;
    it.seenCount = (it.seenCount || 0) + 1;
    it.lastSeen = new Date().toISOString().slice(0,10);
    if (kind === 'mistakes') DB.saveMistakes(items); else DB.saveStrengths(items);
    render();
  }

  return { render, _edit, _add, _delete, _inc };
})();
