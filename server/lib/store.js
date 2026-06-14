// Local-disk persistence. Everything lives under ./data so the app is fully
// self-contained on your machine — no database, no cloud.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const PROJECT_FILE = path.join(DATA_DIR, 'project.json');
export const ROOMS_DIR = path.join(DATA_DIR, 'rooms');

export const id = () => crypto.randomBytes(6).toString('hex');

async function ensureDirs() {
  await fs.mkdir(ROOMS_DIR, { recursive: true });
}

// A sensible default room set for a single-family home. Bedrooms/baths are
// expanded from the bed/bath counts the user enters for the listing.
function roomFromName(name) {
  return {
    id: id(),
    name,
    status: 'empty', // empty -> uploaded -> generated
    source: null, // { file, uploadedAt }
    generations: [], // { id, file, prompt, model, kind, parentId, createdAt }
    selectedGenerationId: null,
    design: {
      style: '',
      wallPaint: '',
      wallPaintHex: '',
      trimPaint: '',
      flooring: '',
      woodNotes: '',
      furniture: '',
      notes: '',
    },
  };
}

export function buildDefaultRooms({ beds = 3, baths = 2 } = {}) {
  const core = ['Kitchen', 'Living Room', 'Dining Room', 'Entry / Foyer'];
  const bedrooms = [];
  for (let i = 1; i <= beds; i++) {
    bedrooms.push(i === 1 ? 'Primary Bedroom' : `Bedroom ${i}`);
  }
  const bathrooms = [];
  const wholeBaths = Math.floor(baths);
  for (let i = 1; i <= wholeBaths; i++) {
    bathrooms.push(i === 1 ? 'Primary Bath' : `Bathroom ${i}`);
  }
  if (baths % 1 !== 0) bathrooms.push('Powder Room');
  const extra = ['Home Office', 'Laundry Room', 'Exterior / Curb Appeal'];
  return [...core, ...bedrooms, ...bathrooms, ...extra].map(roomFromName);
}

const DEFAULT_PROJECT = () => ({
  address: '11505 Old Creedmoor Rd, Raleigh, NC 27613',
  beds: 4,
  baths: 3,
  rooms: buildDefaultRooms({ beds: 4, baths: 3 }),
});

export async function load() {
  await ensureDirs();
  try {
    const raw = await fs.readFile(PROJECT_FILE, 'utf8');
    return JSON.parse(raw);
  } catch {
    const fresh = DEFAULT_PROJECT();
    await save(fresh);
    return fresh;
  }
}

export async function save(project) {
  await ensureDirs();
  await fs.writeFile(PROJECT_FILE, JSON.stringify(project, null, 2));
  return project;
}

export function findRoom(project, roomId) {
  return project.rooms.find((r) => r.id === roomId);
}

export async function roomDir(roomId) {
  const dir = path.join(ROOMS_DIR, roomId);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

export async function writeImage(roomId, filename, buffer) {
  const dir = await roomDir(roomId);
  await fs.writeFile(path.join(dir, filename), buffer);
  return `/data/rooms/${roomId}/${filename}`;
}

export async function readImage(roomId, filename) {
  return fs.readFile(path.join(ROOMS_DIR, roomId, filename));
}
