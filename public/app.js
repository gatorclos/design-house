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
