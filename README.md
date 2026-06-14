# Design House — local room-by-room redesign studio

A local-only web app for redesigning a home one room at a time. Generate room
tabs from a listing, upload each room's photo, produce AI redesigns, refine them
with targeted text edits, then export a build report (paint colors, wood/flooring,
furniture, notes) you can hand to a contractor.

Built for **11505 Old Creedmoor Rd, Raleigh, NC 27613** but works for any home.

## Features
- **Room tabs** auto-generated from bed/bath counts (add / rename / delete freely).
- **Upload** a source photo per room — stored locally on disk under `./data/`.
- **Generate** a photorealistic redesign from the source photo.
- **Regenerate** for a fresh variation.
- **Apply change** — type a specific edit ("sage green walls, brass fixtures")
  to modify the current redesign; otherwise it regenerates from the source.
- **Download** any redesign.
- **Design spec** per room (style, wall/trim paint + hex, flooring, wood/millwork,
  furniture, notes).
- **Build report** — one printable page aggregating every room's redesign + spec.

## Run it

```bash
npm install
cp .env.example .env      # optional — see below
npm start
# open http://localhost:4178
```

## Image generation

The Generate / Regenerate / Apply-change buttons call an image provider:

- **Pixa (real images):** set `PIXA_API_KEY` in `.env`. Confirm `PIXA_API_BASE`
  and `PIXA_MODEL` against your Pixa dashboard's API tab. The adapter in
  `server/lib/pixa.js` does generate → poll → download and accepts several
  common response shapes; tweak it there if your account's API differs.
- **Mock (no key):** with no key set, the app runs in **mock mode** — every
  button works and returns a labeled placeholder image so you can click through
  the entire flow (tabs, upload, generate, edit, report) before wiring real
  credentials.

Recommended model: `seedream-v5-lite` (strong image editing, ~16 credits/image).
Alternatives: `nano-banana-2`, `seedream-v4-5`, `gpt-image-2`, `grok-imagine-image`.

## Where data lives

Everything is on your machine under `./data/` (git-ignored):
- `data/project.json` — rooms, specs, generation history
- `data/rooms/<roomId>/source.*` — uploaded photos
- `data/rooms/<roomId>/gen-*.{png,jpg,svg}` — redesigns

Delete `./data/` to start fresh.

## Note on the listing photos
Zillow blocks automated photo scraping (PerimeterX/CAPTCHA), so source photos are
uploaded manually per room rather than pulled from the listing URL.
