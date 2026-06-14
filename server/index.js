import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as store from './lib/store.js';
import { generateImage, providerInfo } from './lib/pixa.js';
import { lookupAddress, zillowInfo, fetchPhotoBuffer } from './lib/zillow.js';
import { buildReport } from './lib/report.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use('/data', express.static(store.DATA_DIR));

const wrap = (fn) => (req, res) => fn(req, res).catch((e) => {
  console.error(e);
  res.status(500).json({ error: e.message });
});

// Default redesign prompt for a room, blending the room's captured design spec.
function basePrompt(project, room, extra = '') {
  const d = room.design || {};
  const bits = [
    `Photorealistic interior redesign of the ${room.name.toLowerCase()} in a home.`,
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
  ].filter(Boolean);
  return bits.join(' ');
}

// ── Project / rooms ──────────────────────────────────────────────────────────
app.get('/api/config', (req, res) => res.json({ ...providerInfo(), zillow: zillowInfo() }));

app.get('/api/project', wrap(async (req, res) => {
  res.json(await store.load());
}));

// Update listing meta. If regenerateRooms, rebuild the tab set from bed/bath
// counts while keeping any rooms that already have work on them.
app.put('/api/project', wrap(async (req, res) => {
  const project = await store.load();
  const { address, beds, baths, regenerateRooms } = req.body;
  if (address != null) project.address = address;
  if (beds != null) project.beds = Number(beds);
  if (baths != null) project.baths = Number(baths);
  if (regenerateRooms) {
    const keep = project.rooms.filter((r) => r.source || r.generations.length);
    const fresh = store.buildDefaultRooms({ beds: project.beds, baths: project.baths });
    const have = new Set(keep.map((r) => r.name.toLowerCase()));
    project.rooms = [...keep, ...fresh.filter((r) => !have.has(r.name.toLowerCase()))];
  }
  await store.save(project);
  res.json(project);
}));

app.post('/api/rooms', wrap(async (req, res) => {
  const project = await store.load();
  const name = (req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'name required' });
  const room = store.buildDefaultRooms()[0];
  room.name = name;
  room.id = store.id();
  room.status = 'empty';
  room.source = null;
  room.generations = [];
  room.selectedGenerationId = null;
  project.rooms.push(room);
  await store.save(project);
  res.json(room);
}));

app.patch('/api/rooms/:id', wrap(async (req, res) => {
  const project = await store.load();
  const room = store.findRoom(project, req.params.id);
  if (!room) return res.status(404).json({ error: 'room not found' });
  if (typeof req.body.name === 'string' && req.body.name.trim()) room.name = req.body.name.trim();
  if (req.body.design && typeof req.body.design === 'object') {
    room.design = { ...room.design, ...req.body.design };
  }
  if (typeof req.body.selectedGenerationId === 'string') {
    room.selectedGenerationId = req.body.selectedGenerationId;
  }
  await store.save(project);
  res.json(room);
}));

app.delete('/api/rooms/:id', wrap(async (req, res) => {
  const project = await store.load();
  project.rooms = project.rooms.filter((r) => r.id !== req.params.id);
  await store.save(project);
  res.json({ ok: true });
}));

// ── Zillow listing lookup ─────────────────────────────────────────────────────
// Read-only preview: fetch house info + photo URLs without writing anything,
// so the user can review before committing.
app.post('/api/lookup', wrap(async (req, res) => {
  const address = (req.body.address || '').trim();
  if (!address) return res.status(400).json({ error: 'address required' });
  res.json(await lookupAddress(address));
}));

// Import: download the listing photos to disk and persist them on the project.
// If applyMeta, also adopt the looked-up address/beds/baths.
app.post('/api/listing/import', wrap(async (req, res) => {
  const address = (req.body.address || '').trim();
  if (!address) return res.status(400).json({ error: 'address required' });
  const result = await lookupAddress(address);

  const photos = [];
  for (const p of result.photos) {
    const photoId = store.id();
    const { buffer, ext } = await fetchPhotoBuffer(p.url);
    const file = await store.writeListingImage(`${photoId}.${ext}`, buffer);
    photos.push({ id: photoId, file, caption: p.caption || '' });
  }

  const project = await store.load();
  project.listing = {
    fetchedAt: new Date().toISOString(),
    provider: zillowInfo().provider,
    beds: result.beds, baths: result.baths, sqft: result.sqft,
    yearBuilt: result.yearBuilt, price: result.price,
    photos,
  };
  if (req.body.applyMeta) {
    project.address = result.address;
    if (result.beds) project.beds = result.beds;
    if (result.baths) project.baths = result.baths;
  }
  await store.save(project);
  res.json(project);
}));

// Push an imported listing photo into a room as its source photo — the bridge
// that replaces manual per-room uploads.
app.post('/api/rooms/:id/source-from-listing', wrap(async (req, res) => {
  const project = await store.load();
  const room = store.findRoom(project, req.params.id);
  if (!room) return res.status(404).json({ error: 'room not found' });
  const photo = project.listing?.photos?.find((p) => p.id === req.body.photoId);
  if (!photo) return res.status(404).json({ error: 'listing photo not found' });

  const filename = photo.file.split('/').pop();
  const ext = (filename.split('.').pop() || 'jpg').toLowerCase();
  const buffer = await store.readListingImage(filename);
  const file = await store.writeImage(room.id, `source.${ext}`, buffer);
  const contentType = ext === 'png' ? 'image/png' : ext === 'svg' ? 'image/svg+xml'
    : ext === 'webp' ? 'image/webp' : 'image/jpeg';
  room.source = { file, uploadedAt: new Date().toISOString(), contentType };
  if (room.status === 'empty') room.status = 'uploaded';
  await store.save(project);
  res.json(room);
}));

// ── Upload source photo ──────────────────────────────────────────────────────
app.post('/api/rooms/:id/source', upload.single('image'), wrap(async (req, res) => {
  const project = await store.load();
  const room = store.findRoom(project, req.params.id);
  if (!room) return res.status(404).json({ error: 'room not found' });
  if (!req.file) return res.status(400).json({ error: 'image file required' });
  const ext = (req.file.originalname.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
  const file = await store.writeImage(room.id, `source.${ext}`, req.file.buffer);
  room.source = { file, uploadedAt: new Date().toISOString(), contentType: req.file.mimetype };
  if (room.status === 'empty') room.status = 'uploaded';
  await store.save(project);
  res.json(room);
}));

// ── Generate / regenerate / edit ─────────────────────────────────────────────
// kind: "generate"  -> redesign from the uploaded source photo
//       "regenerate" -> same, a fresh variation from source
//       "edit"       -> apply a specific text change to an existing generation
app.post('/api/rooms/:id/generate', wrap(async (req, res) => {
  const project = await store.load();
  const room = store.findRoom(project, req.params.id);
  if (!room) return res.status(404).json({ error: 'room not found' });

  const kind = req.body.kind || 'generate';
  const changeText = (req.body.prompt || '').trim();

  let baseImage = null;
  let prompt;
  let parentId = null;

  if (kind === 'edit') {
    const parent = room.generations.find((g) => g.id === (req.body.parentId || room.selectedGenerationId))
      || room.generations[room.generations.length - 1];
    if (!parent) return res.status(400).json({ error: 'no generated image to edit yet' });
    parentId = parent.id;
    baseImage = await readGenAsBase(room.id, parent.file);
    prompt = `Edit this interior image. Apply this specific change: ${changeText || 'refine the design'}. `
      + 'Keep everything else identical — same room, layout, and perspective. Photorealistic.';
  } else {
    if (!room.source) return res.status(400).json({ error: 'upload a source photo first' });
    baseImage = await readGenAsBase(room.id, room.source.file, room.source.contentType);
    prompt = basePrompt(project, room, kind === 'generate' ? changeText : '');
  }

  const out = await generateImage({ prompt, baseImage });
  const genId = store.id();
  const file = await store.writeImage(room.id, `gen-${genId}.${out.ext}`, out.buffer);
  const gen = {
    id: genId, file, prompt, kind, parentId,
    model: providerInfo().model, createdAt: new Date().toISOString(),
  };
  room.generations.push(gen);
  room.selectedGenerationId = genId;
  room.status = 'generated';
  await store.save(project);
  res.json({ room, generation: gen });
}));

async function readGenAsBase(roomId, fileUrl, contentType) {
  const filename = fileUrl.split('/').pop();
  const buffer = await store.readImage(roomId, filename);
  const ext = filename.split('.').pop().toLowerCase();
  const ct = contentType
    || (ext === 'png' ? 'image/png' : ext === 'svg' ? 'image/svg+xml' : ext === 'webp' ? 'image/webp' : 'image/jpeg');
  return { buffer, contentType: ct };
}

// ── Report ───────────────────────────────────────────────────────────────────
app.get('/api/report', wrap(async (req, res) => {
  const project = await store.load();
  res.type('html').send(buildReport(project));
}));

// Export the app for serverless platforms (e.g. Vercel). Only bind a port when
// run directly as a normal Node process.
export default app;

if (!process.env.VERCEL) {
  const PORT = process.env.PORT || 4178;
  app.listen(PORT, () => {
    const info = providerInfo();
    console.log(`\n  Design House running →  http://localhost:${PORT}`);
    console.log(`  Image provider: ${info.provider}${info.provider === 'pixa' ? ` (${info.model} @ ${info.base})` : ' — set PIXA_API_KEY in .env for real generations'}`);
    const z = zillowInfo();
    console.log(`  Zillow lookup:  ${z.provider}${z.provider === 'rapidapi' ? ` (@ ${z.host})` : ' — set ZILLOW_RAPIDAPI_KEY in .env for real listings'}\n`);
  });
}
