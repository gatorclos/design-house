const api = {
  async get(u) { const r = await fetch(u); if (!r.ok) throw await err(r); return r.json(); },
  async send(u, method, body) {
    const r = await fetch(u, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!r.ok) throw await err(r); return r.json();
  },
  async upload(u, file) {
    const fd = new FormData(); fd.append('image', file);
    const r = await fetch(u, { method: 'POST', body: fd });
    if (!r.ok) throw await err(r); return r.json();
  },
};
async function err(r) { try { return new Error((await r.json()).error || r.statusText); } catch { return new Error(r.statusText); } }

let project = null;
let activeId = null;
let busy = false;
let lookupResult = null; // last /api/lookup preview

const LISTING_VIEW = '__listing__';

const $ = (s) => document.querySelector(s);
const tabsEl = $('#tabs');
const panelEl = $('#panel');

function toast(msg, isErr) {
  const t = $('#toast');
  t.textContent = msg; t.className = 'toast show' + (isErr ? ' err' : '');
  clearTimeout(toast._t); toast._t = setTimeout(() => (t.className = 'toast'), 3200);
}

async function init() {
  try {
    const cfg = await api.get('/api/config');
    const b = $('#provider');
    b.textContent = cfg.provider === 'pixa' ? `pixa · ${cfg.model}` : 'mock mode';
    b.className = 'badge ' + cfg.provider;
    b.title = cfg.provider === 'pixa' ? `Pixa @ ${cfg.base}` : 'No PIXA_API_KEY set — placeholder images';
    window.__zillow = cfg.zillow?.provider || 'mock';
  } catch {}
  project = await api.get('/api/project');
  $('#address').value = project.address;
  $('#beds').value = project.beds;
  $('#baths').value = project.baths;
  activeId = project.rooms[0]?.id || null;
  renderTabs(); renderPanel();
}

// ── Tabs ─────────────────────────────────────────────────────────────────────
function renderTabs() {
  tabsEl.innerHTML = '';

  const listing = document.createElement('button');
  listing.className = 'tab listing-tab' + (activeId === LISTING_VIEW ? ' active' : '');
  const photoCount = project.listing?.photos?.length || 0;
  listing.innerHTML = `<span class="tab-name">🏠 Listing</span>${photoCount ? `<span class="pill">${photoCount}</span>` : ''}`;
  listing.onclick = () => { activeId = LISTING_VIEW; renderTabs(); renderPanel(); };
  tabsEl.appendChild(listing);

  for (const room of project.rooms) {
    const b = document.createElement('button');
    b.className = 'tab' + (room.id === activeId ? ' active' : '');
    b.innerHTML = `<span class="dot ${room.status}"></span><span class="tab-name"></span>`;
    b.querySelector('.tab-name').textContent = room.name;
    b.onclick = () => { activeId = room.id; renderTabs(); renderPanel(); };
    tabsEl.appendChild(b);
  }
  const add = document.createElement('div');
  add.className = 'add-room';
  add.innerHTML = `<input placeholder="Add room…" /><button class="ghost">+</button>`;
  const input = add.querySelector('input');
  const go = async () => {
    const name = input.value.trim(); if (!name) return;
    const room = await api.send('/api/rooms', 'POST', { name });
    project.rooms.push(room); activeId = room.id; renderTabs(); renderPanel();
  };
  add.querySelector('button').onclick = go;
  input.onkeydown = (e) => { if (e.key === 'Enter') go(); };
  tabsEl.appendChild(add);
}

function activeRoom() { return project.rooms.find((r) => r.id === activeId); }
function selectedGen(room) {
  return room.generations.find((g) => g.id === room.selectedGenerationId)
    || room.generations[room.generations.length - 1] || null;
}

// ── Panel ────────────────────────────────────────────────────────────────────
function renderPanel() {
  if (activeId === LISTING_VIEW) return renderListing();
  const room = activeRoom();
  if (!room) { panelEl.innerHTML = '<p>No rooms. Add one from the sidebar.</p>'; return; }
  const gen = selectedGen(room);
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
            ? `<img src="${gen.file}" alt="redesign" />`
            : `<div class="placeholder">No redesign yet.<br/>Upload a source photo, then Generate.</div>`}</div>
          <div class="actions">
            <button class="primary" data-act="generate" ${room.source ? '' : 'disabled'}>✦ Generate</button>
            <button data-act="regenerate" ${room.source ? '' : 'disabled'}>↻ Regenerate</button>
            <button data-act="download" ${gen ? '' : 'disabled'}>⭳ Download</button>
          </div>
          <div class="edit-row">
            <input data-edit placeholder="Describe a specific change (e.g. 'make the walls sage green, add brass fixtures')" ${gen ? '' : 'disabled'} />
            <button data-act="edit" ${gen ? '' : 'disabled'}>Apply change</button>
          </div>
          <div class="thumbs">${room.generations.map((g) =>
            `<img class="thumb ${g.id === (gen && gen.id) ? 'active' : ''}" data-gen="${g.id}" src="${g.file}" title="${escapeHtml(g.kind)} · ${new Date(g.createdAt).toLocaleString()}" />`
          ).join('')}</div>
        </div>

        <div class="stage" style="margin-top:18px">
          <h3>Source photo</h3>
          ${room.source
            ? `<img class="source-pic" src="${room.source.file}" alt="source" />`
            : `<div class="source-empty">No source uploaded yet</div>`}
          <div class="actions">
            <button data-act="upload">${room.source ? 'Replace photo' : '⭱ Upload photo'}</button>
          </div>
        </div>
      </div>

      <div class="spec">
        <h3>Design spec — for the build report</h3>
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
  const commit = async () => {
    const name = input.value.trim() || room.name;
    await api.send(`/api/rooms/${room.id}`, 'PATCH', { name });
    room.name = name; renderTabs(); renderPanel();
  };
  input.onblur = commit;
  input.onkeydown = (e) => { if (e.key === 'Enter') input.blur(); };
}

async function deleteRoom(room) {
  if (!confirm(`Delete "${room.name}"? This removes its photos and redesigns.`)) return;
  await api.send(`/api/rooms/${room.id}`, 'DELETE');
  project.rooms = project.rooms.filter((r) => r.id !== room.id);
  activeId = project.rooms[0]?.id || null;
  renderTabs(); renderPanel();
}

function selectGen(room, genId) {
  room.selectedGenerationId = genId;
  api.send(`/api/rooms/${room.id}`, 'PATCH', { selectedGenerationId: genId }).catch(() => {});
  renderPanel();
}

async function saveSpec(room) {
  const design = {};
  panelEl.querySelectorAll('[data-spec]').forEach((el) => (design[el.dataset.spec] = el.value));
  const updated = await api.send(`/api/rooms/${room.id}`, 'PATCH', { design });
  Object.assign(room, updated);
  toast('Spec saved');
}

// ── Listing (Zillow lookup) ───────────────────────────────────────────────────
function renderListing() {
  const l = project.listing;
  const fmtPrice = (p) => (p ? '$' + Number(p).toLocaleString() : '—');
  const fmtNum = (n) => (n ? Number(n).toLocaleString() : '—');

  const previewStats = lookupResult ? `
    <div class="stats">
      <span><b>${lookupResult.beds}</b> beds</span>
      <span><b>${lookupResult.baths}</b> baths</span>
      <span><b>${fmtNum(lookupResult.sqft)}</b> sqft</span>
      <span>built <b>${lookupResult.yearBuilt || '—'}</b></span>
      <span><b>${fmtPrice(lookupResult.price)}</b></span>
    </div>
    <div class="photo-grid">${lookupResult.photos.map((p) =>
      `<figure class="photo"><img src="${escapeAttr(p.url)}" alt="${escapeAttr(p.caption)}" /><figcaption>${escapeHtml(p.caption)}</figcaption></figure>`
    ).join('')}</div>
    <div class="actions">
      <label class="chk"><input type="checkbox" id="applyMeta" checked /> Apply address &amp; beds/baths to project</label>
      <button class="primary" data-import>⭳ Import ${lookupResult.photos.length} photos to project</button>
    </div>` : '';

  const roomOptions = project.rooms.map((r) => `<option value="${r.id}">${escapeHtml(r.name)}</option>`).join('');
  const imported = l && l.photos.length ? `
    <div class="stage" style="margin-top:18px">
      <h3>Imported listing photos · ${escapeHtml(l.provider)} · ${new Date(l.fetchedAt).toLocaleString()}</h3>
      <p class="hint">Send any photo into a room as its source, then redesign it.</p>
      <div class="photo-grid">${l.photos.map((p) =>
        `<figure class="photo"><img src="${escapeAttr(p.file)}" alt="${escapeAttr(p.caption)}" /><figcaption>${escapeHtml(p.caption)}</figcaption>
          <div class="use-row"><select data-room>${roomOptions}</select><button data-use="${p.id}">Use as source →</button></div>
        </figure>`
      ).join('')}</div>
    </div>` : (l ? '<p class="hint">No photos in the imported listing.</p>' : '');

  panelEl.innerHTML = `
    <div class="room-head"><h2>Listing lookup</h2></div>
    <div class="stage">
      <h3>Fetch house photos from Zillow</h3>
      <p class="hint">Enter an address to fetch listing photos. ${zillowBadge()}</p>
      <div class="edit-row">
        <input id="lookupAddr" placeholder="123 Main St, City, ST 00000" value="${escapeAttr(project.address || '')}" />
        <button class="primary" data-look>Look up</button>
      </div>
      ${previewStats}
    </div>
    ${imported}`;

  wireListing();
}

function zillowBadge() {
  return window.__zillow === 'rapidapi'
    ? 'Using live Zillow data.'
    : 'Running in <b>mock mode</b> — placeholder photos. Set <code>ZILLOW_RAPIDAPI_KEY</code> for real listings.';
}

function wireListing() {
  const lookBtn = panelEl.querySelector('[data-look]');
  if (lookBtn) lookBtn.onclick = () => doLookup();
  const addr = panelEl.querySelector('#lookupAddr');
  if (addr) addr.onkeydown = (e) => { if (e.key === 'Enter') doLookup(); };
  const importBtn = panelEl.querySelector('[data-import]');
  if (importBtn) importBtn.onclick = () => doImport(importBtn);
  panelEl.querySelectorAll('[data-use]').forEach((b) => (b.onclick = () => useAsSource(b)));
}

async function doLookup() {
  const address = panelEl.querySelector('#lookupAddr').value.trim();
  if (!address) return toast('Enter an address first', true);
  const btn = panelEl.querySelector('[data-look]');
  const original = btn.innerHTML;
  btn.innerHTML = '<span class="spinner"></span>Looking up…'; btn.disabled = true;
  try {
    lookupResult = await api.send('/api/lookup', 'POST', { address });
    renderListing();
    toast(`Found ${lookupResult.photos.length} photos`);
  } catch (e) {
    toast(e.message, true);
    btn.innerHTML = original; btn.disabled = false;
  }
}

async function doImport(btn) {
  const address = panelEl.querySelector('#lookupAddr').value.trim();
  const applyMeta = panelEl.querySelector('#applyMeta')?.checked;
  const original = btn.innerHTML;
  btn.innerHTML = '<span class="spinner"></span>Importing…'; btn.disabled = true;
  try {
    project = await api.send('/api/listing/import', 'POST', { address, applyMeta });
    if (applyMeta) { $('#address').value = project.address; $('#beds').value = project.beds; $('#baths').value = project.baths; }
    lookupResult = null;
    renderTabs(); renderListing();
    toast('Listing imported');
  } catch (e) {
    toast(e.message, true);
    btn.innerHTML = original; btn.disabled = false;
  }
}

async function useAsSource(btn) {
  const photoId = btn.dataset.use;
  const roomId = btn.closest('.photo').querySelector('[data-room]').value;
  btn.disabled = true;
  try {
    const updated = await api.send(`/api/rooms/${roomId}/source-from-listing`, 'POST', { photoId });
    const room = project.rooms.find((r) => r.id === roomId);
    if (room) Object.assign(room, updated);
    renderTabs();
    toast(`Set as source for ${updated.name}`);
  } catch (e) { toast(e.message, true); }
  finally { btn.disabled = false; }
}

// ── Actions ──────────────────────────────────────────────────────────────────
async function act(kind, room, btn) {
  if (kind === 'upload') return chooseFile(room);
  if (kind === 'download') return download(room);
  if (busy) return;

  let prompt = '';
  if (kind === 'edit') {
    prompt = panelEl.querySelector('[data-edit]').value.trim();
    if (!prompt) return toast('Type the change you want first', true);
  }
  busy = true;
  const original = btn.innerHTML;
  btn.innerHTML = `<span class="spinner"></span>${kind === 'edit' ? 'Applying…' : 'Generating…'}`;
  disableActions(true);
  try {
    const { room: updated } = await api.send(`/api/rooms/${room.id}/generate`, 'POST', { kind, prompt });
    Object.assign(room, updated);
    renderTabs(); renderPanel();
    toast(kind === 'edit' ? 'Change applied' : 'Redesign ready');
  } catch (e) {
    toast(e.message, true);
    btn.innerHTML = original; disableActions(false);
  } finally { busy = false; }
}

function disableActions(state) {
  panelEl.querySelectorAll('[data-act], [data-edit]').forEach((el) => (el.disabled = state));
}

function chooseFile(room) {
  const input = $('#fileInput');
  input.value = '';
  input.onchange = async () => {
    const file = input.files[0]; if (!file) return;
    try {
      const updated = await api.upload(`/api/rooms/${room.id}/source`, file);
      Object.assign(room, updated);
      renderTabs(); renderPanel(); toast('Source photo stored');
    } catch (e) { toast(e.message, true); }
  };
  input.click();
}

function download(room) {
  const gen = selectedGen(room); if (!gen) return;
  const a = document.createElement('a');
  a.href = gen.file;
  a.download = `${room.name.replace(/\s+/g, '-').toLowerCase()}-${gen.id}.${gen.file.split('.').pop()}`;
  document.body.appendChild(a); a.click(); a.remove();
}

// ── Top bar ──────────────────────────────────────────────────────────────────
$('#report').onclick = () => window.open('/api/report', '_blank');
$('#lookup').onclick = () => {
  activeId = LISTING_VIEW; renderTabs(); renderPanel();
  const addr = panelEl.querySelector('#lookupAddr');
  if (addr) { addr.value = $('#address').value; doLookup(); }
};
$('#rebuild').onclick = async () => {
  if (!confirm('Rebuild room tabs from the bed/bath counts? Rooms with uploads or redesigns are kept.')) return;
  project = await api.send('/api/project', 'PUT', {
    beds: Number($('#beds').value), baths: Number($('#baths').value),
    address: $('#address').value, regenerateRooms: true,
  });
  activeId = project.rooms.find((r) => r.id === activeId) ? activeId : project.rooms[0]?.id;
  renderTabs(); renderPanel(); toast('Rooms rebuilt');
};
for (const id of ['address', 'beds', 'baths']) {
  $('#' + id).onchange = () => api.send('/api/project', 'PUT', {
    address: $('#address').value, beds: Number($('#beds').value), baths: Number($('#baths').value),
  }).catch(() => {});
}

// ── utils ────────────────────────────────────────────────────────────────────
function escapeHtml(s) { return String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }
function escapeAttr(s) { return escapeHtml(s).replace(/"/g, '&quot;'); }

init().catch((e) => { panelEl.innerHTML = `<p style="color:#8a2c2c">Failed to load: ${e.message}</p>`; });
