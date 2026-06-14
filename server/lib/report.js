// Builds a printable build-out report from the project: per-room redesign
// image plus the concrete spec (paint colors, wood/flooring, furniture, notes)
// so the work can actually be constructed.

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function swatch(hex) {
  if (!hex) return '';
  const safe = /^#?[0-9a-fA-F]{3,8}$/.test(hex) ? (hex.startsWith('#') ? hex : `#${hex}`) : '';
  if (!safe) return '';
  return `<span class="swatch" style="background:${safe}"></span>`;
}

function roomImage(room) {
  const gen = room.generations.find((g) => g.id === room.selectedGenerationId)
    || room.generations[room.generations.length - 1];
  if (gen) return gen.file;
  if (room.source) return room.source.file;
  return null;
}

function specRow(label, value, extra = '') {
  if (!value && !extra) return '';
  return `<tr><th>${esc(label)}</th><td>${extra}${esc(value)}</td></tr>`;
}

export function buildReport(project) {
  const done = project.rooms.filter((r) => r.selectedGenerationId || r.generations.length);
  const rooms = project.rooms
    .map((room) => {
      const img = roomImage(room);
      const d = room.design || {};
      const imgHtml = img
        ? `<img class="shot" src="${esc(img)}" alt="${esc(room.name)} redesign"/>`
        : `<div class="shot empty">No design generated yet</div>`;
      const spec = [
        specRow('Style', d.style),
        specRow('Wall paint', d.wallPaint, swatch(d.wallPaintHex)),
        specRow('Trim / ceiling', d.trimPaint),
        specRow('Flooring', d.flooring),
        specRow('Wood / millwork', d.woodNotes),
        specRow('Key furniture', d.furniture),
        specRow('Notes', d.notes),
      ].join('');
      return `
      <section class="room">
        <h2>${esc(room.name)}</h2>
        <div class="room-body">
          ${imgHtml}
          <table class="spec">${spec || '<tr><td class="muted">No spec captured.</td></tr>'}</table>
        </div>
      </section>`;
    })
    .join('\n');

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/>
<title>Design House — Build Report — ${esc(project.address)}</title>
<style>
  :root { color-scheme: light; }
  body { font-family: -apple-system, Helvetica, Arial, sans-serif; color:#1c1c1c; margin:0; background:#fff; }
  header { padding:48px 56px 24px; border-bottom:3px solid #1c1c1c; }
  h1 { margin:0 0 6px; font-family:Georgia,serif; font-size:30px; }
  .sub { color:#555; font-size:15px; }
  main { padding:24px 56px 80px; }
  .room { padding:28px 0; border-bottom:1px solid #e6e6e6; page-break-inside:avoid; }
  .room h2 { font-family:Georgia,serif; font-size:22px; margin:0 0 14px; }
  .room-body { display:grid; grid-template-columns: 1.1fr 1fr; gap:28px; align-items:start; }
  .shot { width:100%; border-radius:10px; border:1px solid #ddd; }
  .shot.empty { display:flex; align-items:center; justify-content:center; aspect-ratio:4/3; color:#999; background:#f6f6f6; }
  table.spec { width:100%; border-collapse:collapse; font-size:14px; }
  table.spec th { text-align:left; width:140px; color:#666; font-weight:600; padding:7px 10px 7px 0; vertical-align:top; }
  table.spec td { padding:7px 0; border-bottom:1px solid #f0f0f0; }
  .swatch { display:inline-block; width:14px; height:14px; border-radius:3px; border:1px solid rgba(0,0,0,.2); margin-right:8px; vertical-align:middle; }
  .muted { color:#999; }
  @media print { header, main { padding-left:24px; padding-right:24px; } }
</style></head>
<body>
  <header>
    <h1>Build Report</h1>
    <div class="sub">${esc(project.address)} &middot; ${esc(project.beds)} bed / ${esc(project.baths)} bath &middot; ${done.length} of ${project.rooms.length} rooms designed</div>
  </header>
  <main>${rooms}</main>
</body></html>`;
}
