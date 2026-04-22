# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

AutoQ — a solo Quiddler word game. Vite + React 18 standalone app that builds to a static `dist/` and ships as a static embed inside sipnstrut.com's gameroom (`base: "./"` in `vite.config.js` makes the build path-independent).

## Commands

```bash
npm install         # first time only
npm run dev         # Vite dev server
npm run build       # → dist/ (static, deployable anywhere)
npm run preview     # serve the built dist/
```

There is no test suite and no linter configured — don't invent one. Don't add new tooling (TypeScript, Tailwind, test runners, etc.) without being asked; the "zero-dependency engine, tiny UI" shape is intentional.

## Environment

- **Node is not on PATH.** Portable install at `C:\Users\Joe\tools\node-v20.18.1-win-x64\`. Before running `npm` / `node`, prepend it: `export PATH="/c/Users/Joe/tools/node-v20.18.1-win-x64:$PATH"`.
- **Shell is bash on Windows.** Use Unix syntax (`/dev/null`, forward slashes).
- This directory is its own git repo (independent from the parent `source/repos` workspace).

## Architecture — read ARCHITECTURE.md first

`ARCHITECTURE.md` is the authoritative reference for the engine API, game-state shape, card values, scoring/star rules, bot selection, and integration notes. Consult it before non-trivial changes. Key invariants it documents but that are easy to violate:

- **Engine is framework-free.** `src/autoq-engine.js` has zero imports and exports a functional API (`createGame`, `submitHand`, `takeMulligan`, `getStandings`, `getUsedCardIndices`, `filterOptionsAgainstDealt`, `calculateStars`, `CARD_VALUES`, `HANDS`). Do not import React, DOM APIs, or anything else into it — this is what allows the game to be reused in non-React hosts.
- **Game state is a plain object**, not a class or store. Each engine call returns a fresh game; `AutoQ.jsx` holds it in `useState`. Don't convert it to a class or external store.
- **Digraphs (QU, TH, CL, IN, ER) are single cards** with their own point values. `submitHand` auto-selects the highest-scoring breakdown when a word can be formed multiple ways — don't "simplify" this.
- **Bots replay real historical hands** from `src/bot-scores.json` against a shared depleting deck, with synthetic zero-score entries injected to prevent high-skew. If you touch bot selection, re-read the "Bot Behavior" section.
- **Stars only apply with 3+ total players and no ties** (longest word + most words, +10 each). See `calculateStars`.

## Component wiring

`src/main.jsx` mounts `<AutoQ />` with no props, so the live build uses bundled `bot-scores.json` and **skips dictionary validation** — any word composable from the dealt cards is accepted. `AutoQ` accepts optional `scores`, `validateWords`, and `onStateChange` props (see JSDoc at top of `src/AutoQ.jsx`). Wire `validateWords` only if a dictionary backend is actually being introduced.

## .env.local

`.env.local` holds Merriam-Webster API keys (Dictionary + medical_v2) intentionally **without** the `VITE_` prefix so they are *not* exposed to the client bundle. Keys are for a future server-side validation endpoint; there is no server in this repo yet, and `validateWords` is not wired in `main.jsx`. Don't prefix them with `VITE_` to "make them work" — that would leak the keys into the static bundle.

## Styling

Plain CSS in `src/autoq.css`, scoped under `.autoq-section` with `--aq-*` custom properties for theming. Fonts (Anybody, DM Sans) come from Google Fonts. No CSS framework; don't introduce one.

## Deployment

`npm run build` → upload `dist/` contents to the target host. The production target is a subdirectory under sipnstrut.com's gameroom; `base: "./"` is what makes that work, so don't change it to an absolute base.
