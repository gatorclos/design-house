# Design House — room-by-room redesign studio

A web app for redesigning a home one room at a time. Enter an address to pull
real public-record house facts, build a room list, add an optional "before" photo
of each room (kept on your device), generate photorealistic AI redesigns, refine
them with text edits, and print a build report (paint, wood/flooring, furniture,
notes) for a contractor.

Deployed on Vercel; state lives in your browser.

## Architecture

- **Client-owned state.** Your project (address, beds/baths, rooms, design specs)
  is stored in the browser's `localStorage` — nothing is stored on a server.
- **Source photos are local-only.** You pick a local image; it stays in the
  browser and is only sent *transiently* to the image-gen API when you Generate.
  It is never uploaded for storage.
- **Thin server.** Two stateless functions hold the secret API keys: the house
  lookup (`/api/lookup`) and the Pixa generation proxy (`/api/generate` +
  `/api/asset/:id`). The generate→poll split keeps each call within serverless
  time limits.

## Features
- **Fetch facts** — enter an address → real beds/baths/sqft/year from public
  records (RentCast) → auto-builds the room list.
- **Room tabs** (add / rename / delete freely).
- **Choose local photo** per room — guides the redesign, never leaves your device
  except transiently at generation time.
- **Generate / Regenerate / Apply change** — real redesigns via Pixa.
- **Download** any redesign.
- **Design spec** per room (style, wall/trim paint + hex, flooring, wood, furniture, notes).
- **Print report** — one page aggregating every room's redesign + spec.

## Run it locally

```bash
npm install
cp .env.example .env     # fill in the two keys below
npm start
# open http://localhost:4178
```

## Required keys

There is **no mock fallback** — real lookups and real generation need keys:

| Variable | Purpose | Where to get it |
|----------|---------|-----------------|
| `RENTCAST_API_KEY` | House facts by address (RentCast) | Free tier (~50/mo) — https://app.rentcast.io |
| `PIXA_API_KEY` | Image generation | Your Pixa dashboard |

`PROPERTY_API_KEY` is accepted as a fallback name for the RentCast key. Optional:
`RENTCAST_API_HOST` (default `api.rentcast.io`), `PIXA_API_BASE`,
`PIXA_MODEL` (default `nano-banana`), `PIXA_RESOLUTION`, `PIXA_ASPECT_RATIO`.

## Deploying (Vercel)

The repo is set up for Vercel (`api/index.js` + `vercel.json`). Pushes to the
production branch auto-deploy. After importing the project, add `PROPERTY_API_KEY`
and `PIXA_API_KEY` under **Project → Settings → Environment Variables**, then
redeploy. The deployed serverless functions reach the external APIs (lookups and
generation), while your browser holds all project state.
