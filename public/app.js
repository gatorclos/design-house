// Design House — client-owned SPA.
//
// All project state lives in the browser (localStorage). Source photos are
// chosen locally and never uploaded for storage — they're only sent transiently
// to the server's Pixa proxy when you Generate. Real house facts come from
// /api/lookup; real redesigns come from /api/generate + /api/asset polling.

const api = {
  async get(u) { const r = await fetch(u); if (!r.ok) throw await err(r); return r.json(); },
  async send(u, method, body) {
    const r = await fetch(u, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!r.ok) throw await err(r); return r.json();
  },
};
async function err(r) { try { return new Error((await r.json()).error || r.statusText); } catch { return new Error(r.statusText); } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const STORE_KEY = 'design-house:project';
const $ = (s) => document.querySelector(s);
const tabsEl = $('#tabs');
const panelEl = $('#panel');

// Persisted state (small): address, beds, baths, rooms + design specs.
let project = loadProject();
// Session-only state (in-memory): before-photos + generations, keyed by room id.
const session = {};
let activeId = project.rooms[0]?.id || null;
let busy = false;
let cfg = { image: { provider: 'none' }, property: { hasKey: false } };

function blankProject() { return { address: '', beds: 0, baths: 0, rooms: [] }; }
function loadProject() {
  try { const p = JSON.parse(localStorage.getItem(STORE_KEY)); if (p && Array.isArray(p.rooms)) return p; } catch {}
  return blankProject();
}
function saveProject() { try { localStorage.setItem(STORE_KEY, JSON.stringify(project)); } catch {} }
function sess(id) { return (session[id] ||= { before: null, generations: [], selectedGenId: null }); }
function uid() { return Math.random().toString(16).slice(2, 10); }

function toast(msg, isErr) {
  const t = $('#toast');
  t.textContent = msg; t.className = 'toast show' + (isErr ? ' err' : '');
  clearTimeout(toast._t); toast._t = setTimeout(() => (t.className = 'toast'), 3600);
}

// ── Rooms ──────────────────────────────────────────────────────────────────—
function roomFromName(name) {
  return { id: uid(), name, design: { style: '', wallPaint: '', wallPaintHex: '', trimPaint: '', flooring: '', woodNotes: '', furniture: '', notes: '' } };
}
function buildDefaultRooms(beds = 3, baths = 2) {
  const core = ['Kitchen', 'Living Room', 'Dining Room', 'Entry / Foyer'];
  const bedrooms = [];
  for (let i = 1; i <= beds; i++) bedrooms.push(i === 1 ? 'Primary Bedroom' : `Bedroom ${i}`);
  const bathrooms = [];
  const whole = Math.floor(baths);
  for (let i = 1; i <= whole; i++) bathrooms.push(i === 1 ? 'Primary Bath' : `Bathroom ${i}`);
  if (baths % 1 !== 0) bathrooms.push('Powder Room');
  const extra = ['Home Office', 'Laundry Room', 'Exterior / Curb Appeal'];
  return [...core, ...bedrooms, ...bathrooms, ...extra].map(roomFromName);
}

async function init() {
  try {
    cfg = await api.get('/api/config');
  } catch {}
  renderBadge();
  $('#address').value = project.address || '';
  $('#beds').value = project.beds || '';
  $('#baths').value = project.baths || '';
  renderTabs(); renderPanel();
}

function renderBadge() {
  const b = $('#provider');
  const img = cfg.image || {};
  const ok = img.provider === 'pixa' && cfg.property?.hasKey;
  b.textContent = ok ? `pixa · ${img.model}` : 'keys needed';
  b.className = 'badge ' + (ok ? 'pixa' : 'mock');
  b.title = `Image gen: ${img.provider === 'pixa' ? `pixa (${img.model})` : 'set PIXA_API_KEY'}\n`
    + `House lookup: ${cfg.property?.hasKey ? cfg.property.provider : 'set PROPERTY_API_KEY'}`;
}

// ── Tabs ─────────────────────────────────────────────────────────────────────
function renderTabs() {
  tabsEl.innerHTML = '';
  for (const room of project.rooms) {
    const s = sess(room.id);
    const status = s.generations.length ? 'generated' : s.before ? 'uploaded' : 'empty';
    const b = document.createElement('button');
    b.className = 'tab' + (room.id === activeId ? ' active' : '');
    b.innerHTML = `<span class="dot ${status}"></span><span class="tab-name"></span>`;
    b.querySelector('.tab-name').textContent = room.name;
    b.onclick = () => { activeId = room.id; renderTabs(); renderPanel(); };
    tabsEl.appendChild(b);
  }
  const add = document.createElement('div');
  add.className = 'add-room';
  add.innerHTML = `<input placeholder="Add room…" /><button class="ghost">+</button>`;
  const input = add.querySelector('input');
  const go = () => {
    const name = input.value.trim(); if (!name) return;
    const room = roomFromName(name);
    project.rooms.push(room); saveProject();
    activeId = room.id; renderTabs(); renderPanel();
  };
  add.querySelector('button').onclick = go;
  input.onkeydown = (e) => { if (e.key === 'Enter') go(); };
  tabsEl.appendChild(add);
}

function activeRoom() { return project.rooms.find((r) => r.id === activeId); }
function selectedGen(s) {
  return s.generations.find((g) => g.id === s.selectedGenId) || s.generations[s.generations.length - 1] || null;
}

// ── Panel ────────────────────────────────────────────────────────────────────
function renderPanel() {
  const room = activeRoom();
  if (!room) {
    panelEl.innerHTML = `<div class="empty-state">
      <h2>Start with an address</h2>
      <p>Enter a property address above and click <b>⌕ Fetch facts</b> to pull beds/baths from public records and build your room list — or add a room from the sidebar.</p>
    </div>`;
    return;
  }
  const s = sess(room.id);
  const gen = selectedGen(s);
  const d = room.design || {};

  panelEl.innerHTML = `
    <div class="room-head">
      <h2 data-rename title="Click to rename">${escapeHtml(room.name)}</h2>
      <button class="ghost" data-del>Delete room</button>
    </div>
    <div class="grid">
      <div>
        <div class="stage">
          <h3>Redesign</h3>
          <div class="viewer">${gen
            ? `<img src="${gen.dataUrl}" alt="redesign" />`
            : `<div class="placeholder">No redesign yet.<br/>Add a photo of this room (optional), set the design spec, then Generate.</div>`}</div>
          <div class="actions">
            <button class="primary" data-act="generate">✦ Generate</button>
            <button data-act="regenerate" ${gen ? '' : 'disabled'}>↻ Regenerate</button>
            <button data-act="download" ${gen ? '' : 'disabled'}>⭳ Download</button>
          </div>
          <div class="edit-row">
            <input data-edit placeholder="Describe a change (e.g. 'sage green walls, brass fixtures')" ${gen ? '' : 'disabled'} />
            <button data-act="edit" ${gen ? '' : 'disabled'}>Apply change</button>
          </div>
          <div class="thumbs">${s.generations.map((g) =>
            `<img class="thumb ${g.id === (gen && gen.id) ? 'active' : ''}" data-gen="${g.id}" src="${g.dataUrl}" title="${escapeHtml(g.kind)} · ${new Date(g.createdAt).toLocaleTimeString()}" />`
          ).join('')}</div>
        </div>

        <div class="stage" style="margin-top:18px">
          <h3>Your photo (the “before”) — stays on your device</h3>
          ${s.before
            ? `<img class="source-pic" src="${s.before}" alt="before" />`
            : `<div class="source-empty">No photo selected. Optional — pick a local image to guide the redesign.</div>`}
          <div class="actions">
            <button data-act="upload">${s.before ? 'Replace photo' : '⭱ Choose local photo'}</button>
            ${s.before ? '<button data-act="clearphoto" class="ghost">Remove</button>' : ''}
          </div>
        </div>
      </div>

      <div class="spec">
        <h3>Design spec — for the report</h3>
        ${field('Style', 'style', d.style, 'e.g. warm modern farmhouse')}
        <div class="field paint">
          <div>${labelInput('Wall paint', 'wallPaint', d.wallPaint, 'e.g. Benjamin Moore Pale Oak')}</div>
          <div>${labelInput('Hex', 'wallPaintHex', d.wallPaintHex, '#e8e3d9')}</div>
        </div>
        ${field('Trim / ceiling', 'trimPaint', d.trimPaint, 'e.g. Chantilly Lace, semi-gloss')}
        ${field('Flooring', 'flooring', d.flooring, 'e.g. white oak 7" engineered, matte')}
        ${field('Wood / millwork', 'woodNotes', d.woodNotes, 'e.g. walnut shaker cabinets, new crown molding')}
        ${field('Key furniture', 'furniture', d.furniture, 'e.g. linen sectional, brass floor lamp')}
        ${textarea('Notes', 'notes', d.notes, 'lighting, fixtures, demolition, budget notes…')}
        <div class="spec-actions"><button class="primary" data-save>Save spec</button></div>
      </div>
    </div>`;

  wirePanel(room);
}

function field(label, key, val, ph) { return `<div class="field">${labelInput(label, key, val, ph)}</div>`; }
function labelInput(label, key, val, ph) {
  return `<label>${label}</label><input data-spec="${key}" value="${escapeAttr(val)}" placeholder="${escapeAttr(ph)}" />`;
}
function textarea(label, key, val, ph) {
  return `<div class="field"><label>${label}</label><textarea data-spec="${key}" rows="3" placeholder="${escapeAttr(ph)}">${escapeHtml(val || '')}</textarea></div>`;
}

function wirePanel(room) {
  panelEl.querySelector('[data-rename]').onclick = (e) => beginRename(e.target, room);
  panelEl.querySelector('[data-del]').onclick = () => deleteRoom(room);
  panelEl.querySelectorAll('[data-act]').forEach((b) => (b.onclick = () => act(b.dataset.act, room, b)));
  panelEl.querySelectorAll('[data-gen]').forEach((t) => (t.onclick = () => selectGen(room, t.dataset.gen)));
  panelEl.querySelector('[data-save]').onclick = () => saveSpec(room);
}

function beginRename(h2, room) {
  const input = document.createElement('input');
  input.className = 'rename'; input.value = room.name;
  h2.replaceWith(input); input.focus();
  const commit = () => {
    room.name = input.value.trim() || room.name; saveProject();
    renderTabs(); renderPanel();
  };
  input.onblur = commit;
  input.onkeydown = (e) => { if (e.key === 'Enter') input.blur(); };
}

function deleteRoom(room) {
  if (!confirm(`Delete "${room.name}"? This removes its photo and redesigns.`)) return;
  project.rooms = project.rooms.filter((r) => r.id !== room.id); saveProject();
  delete session[room.id];
  activeId = project.rooms[0]?.id || null;
  renderTabs(); renderPanel();
}

function selectGen(room, genId) { sess(room.id).selectedGenId = genId; renderPanel(); }

function saveSpec(room) {
  const design = {};
  panelEl.querySelectorAll('[data-spec]').forEach((el) => (design[el.dataset.spec] = el.value));
  room.design = design; saveProject();
  toast('Spec saved');
}

// ── Actions ──────────────────────────────────────────────────────────────────
async function act(kind, room, btn) {
  if (kind === 'upload') return choosePhoto(room);
  if (kind === 'clearphoto') { sess(room.id).before = null; renderTabs(); renderPanel(); return; }
  if (kind === 'download') return download(room);
  if (busy) return;

  const s = sess(room.id);
  let prompt = buildPrompt(room);
  let image = s.before ? await downscale(s.before) : null;

  if (kind === 'edit') {
    const change = panelEl.querySelector('[data-edit]').value.trim();
    if (!change) return toast('Type the change you want first', true);
    const base = selectedGen(s);
    prompt = buildPrompt(room, `Apply this specific change: ${change}.`);
    if (base) image = await downscale(base.dataUrl); // edit the current redesign
  }

  busy = true;
  const original = btn.innerHTML;
  btn.innerHTML = `<span class="spinner"></span>${kind === 'edit' ? 'Applying…' : 'Generating…'}`;
  disableActions(true);
  try {
    const dataUrl = await runGeneration({ prompt, image });
    s.generations.push({ id: uid(), dataUrl, prompt, kind, createdAt: new Date().toISOString() });
    s.selectedGenId = s.generations[s.generations.length - 1].id;
    renderTabs(); renderPanel();
    toast(kind === 'edit' ? 'Change applied' : 'Redesign ready');
  } catch (e) {
    toast(e.message, true);
    btn.innerHTML = original; disableActions(false);
  } finally { busy = false; }
}

async function runGeneration({ prompt, image }) {
  const start = await api.send('/api/generate', 'POST', { prompt, image });
  if (start.status === 'ready') return start.dataUrl;
  if (start.status === 'pending') return pollAsset(start.assetId);
  throw new Error('generation failed to start');
}
async function pollAsset(id) {
  for (let i = 0; i < 90; i++) {
    await sleep(2000);
    let a; try { a = await api.get(`/api/asset/${id}`); } catch { continue; }
    if (a.status === 'ready') return a.dataUrl;
    if (a.status === 'failed') throw new Error(a.error || 'generation failed');
  }
  throw new Error('generation timed out');
}

function disableActions(state) {
  panelEl.querySelectorAll('[data-act], [data-edit]').forEach((el) => (el.disabled = state));
}

function buildPrompt(room, extra = '') {
  const d = room.design || {};
  return [
    `Photorealistic interior redesign of the ${room.name.toLowerCase()}.`,
    'Keep the room architecture, windows, and camera angle; restyle the space.',
    d.style && `Design style: ${d.style}.`,
    d.wallPaint && `Wall paint: ${d.wallPaint}${d.wallPaintHex ? ` (${d.wallPaintHex})` : ''}.`,
    d.trimPaint && `Trim/ceiling: ${d.trimPaint}.`,
    d.flooring && `Flooring: ${d.flooring}.`,
    d.woodNotes && `Wood / millwork: ${d.woodNotes}.`,
    d.furniture && `Furniture: ${d.furniture}.`,
    d.notes && `Notes: ${d.notes}.`,
    extra && extra.trim(),
    'High-end real-estate photography, natural light, sharp, realistic.',
  ].filter(Boolean).join(' ');
}

// Shrink a data URL to keep the request under serverless body limits.
function downscale(dataUrl, max = 1024, quality = 0.85) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      let { width: w, height: h } = img;
      if (w > max || h > max) { const sc = max / Math.max(w, h); w = Math.round(w * sc); h = Math.round(h * sc); }
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      resolve(c.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => reject(new Error('could not read image'));
    img.src = dataUrl;
  });
}

function choosePhoto(room) {
  const input = $('#fileInput');
  input.value = '';
  input.onchange = () => {
    const file = input.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = () => { sess(room.id).before = reader.result; renderTabs(); renderPanel(); toast('Photo loaded (kept on your device)'); };
    reader.onerror = () => toast('Could not read that file', true);
    reader.readAsDataURL(file);
  };
  input.click();
}

function download(room) {
  const gen = selectedGen(sess(room.id)); if (!gen) return;
  const a = document.createElement('a');
  a.href = gen.dataUrl;
  a.download = `${room.name.replace(/\s+/g, '-').toLowerCase()}-${gen.id}.png`;
  document.body.appendChild(a); a.click(); a.remove();
}

// ── Top bar ──────────────────────────────────────────────────────────────────
$('#lookup').onclick = () => doLookup();
$('#address').onkeydown = (e) => { if (e.key === 'Enter') doLookup(); };

async function doLookup() {
  const address = $('#address').value.trim();
  if (!address) return toast('Enter an address first', true);
  const btn = $('#lookup');
  const original = btn.innerHTML;
  btn.innerHTML = '<span class="spinner"></span>Looking up…'; btn.disabled = true;
  try {
    const r = await api.send('/api/lookup', 'POST', { address });
    project.address = r.address; project.beds = r.beds; project.baths = r.baths;
    $('#address').value = r.address; $('#beds').value = r.beds; $('#baths').value = r.baths;
    if (!project.rooms.length) { project.rooms = buildDefaultRooms(r.beds, r.baths); activeId = project.rooms[0]?.id; }
    saveProject(); renderTabs(); renderPanel();
    toast(`${r.beds} bd · ${r.baths} ba${r.sqft ? ` · ${r.sqft.toLocaleString()} sqft` : ''}${r.yearBuilt ? ` · built ${r.yearBuilt}` : ''}`);
  } catch (e) {
    toast(e.message, true);
  } finally { btn.innerHTML = original; btn.disabled = false; }
}

$('#rebuild').onclick = () => {
  const beds = Number($('#beds').value) || 0, baths = Number($('#baths').value) || 0;
  const keep = project.rooms.filter((r) => sess(r.id).before || sess(r.id).generations.length || hasSpec(r));
  const fresh = buildDefaultRooms(beds, baths);
  const have = new Set(keep.map((r) => r.name.toLowerCase()));
  project.rooms = [...keep, ...fresh.filter((r) => !have.has(r.name.toLowerCase()))];
  project.beds = beds; project.baths = baths;
  activeId = project.rooms.find((r) => r.id === activeId) ? activeId : project.rooms[0]?.id || null;
  saveProject(); renderTabs(); renderPanel(); toast('Rooms built');
};
function hasSpec(r) { return Object.values(r.design || {}).some((v) => v && String(v).trim()); }

for (const id of ['address', 'beds', 'baths']) {
  $('#' + id).onchange = () => {
    project.address = $('#address').value;
    project.beds = Number($('#beds').value) || 0;
    project.baths = Number($('#baths').value) || 0;
    saveProject();
  };
}

$('#report').onclick = () => openReport();
function openReport() {
  const rows = project.rooms.map((room) => {
    const gen = selectedGen(sess(room.id));
    const d = room.design || {};
    const specs = [
      ['Style', d.style], ['Wall paint', d.wallPaint && `${d.wallPaint}${d.wallPaintHex ? ` (${d.wallPaintHex})` : ''}`],
      ['Trim / ceiling', d.trimPaint], ['Flooring', d.flooring], ['Wood / millwork', d.woodNotes],
      ['Furniture', d.furniture], ['Notes', d.notes],
    ].filter(([, v]) => v).map(([k, v]) => `<tr><th>${k}</th><td>${escapeHtml(v)}</td></tr>`).join('');
    return `<section class="r"><h2>${escapeHtml(room.name)}</h2>
      ${gen ? `<img src="${gen.dataUrl}"/>` : '<div class="noimg">No redesign generated</div>'}
      <table>${specs || '<tr><td>No spec captured</td></tr>'}</table></section>`;
  }).join('');
  const html = `<!doctype html><html><head><meta charset="utf-8"/><title>Design House — ${escapeHtml(project.address || 'Report')}</title>
    <style>body{font-family:-apple-system,Helvetica,Arial,sans-serif;margin:40px;color:#1d1c1a}
    h1{font-family:Georgia,serif} .r{page-break-inside:avoid;margin:0 0 28px;border-top:2px solid #e3ded6;padding-top:16px}
    .r img{max-width:520px;width:100%;border-radius:10px;border:1px solid #e3ded6}
    table{border-collapse:collapse;margin-top:10px} th{text-align:left;color:#7a756e;padding:3px 14px 3px 0;vertical-align:top;font-weight:600}
    td{padding:3px 0} .noimg{color:#7a756e;font-style:italic}</style></head>
    <body><h1>Design House</h1><p>${escapeHtml(project.address || '')} · ${project.beds || 0} bd / ${project.baths || 0} ba</p>
    ${rows || '<p>No rooms yet.</p>'}<script>onload=()=>print()<\/script></body></html>`;
  const w = window.open('', '_blank');
  if (w) { w.document.write(html); w.document.close(); } else { toast('Allow pop-ups to print the report', true); }
}

// ── utils ────────────────────────────────────────────────────────────────────
function escapeHtml(s) { return String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }
function escapeAttr(s) { return escapeHtml(s).replace(/"/g, '&quot;'); }

init().catch((e) => { panelEl.innerHTML = `<p style="color:#8a2c2c">Failed to load: ${e.message}</p>`; });
