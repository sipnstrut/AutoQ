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

`ARCHITECTURE.md` is the authoritative reference for the engine API, game-state shape, card values, scoring/star rules, bot selection, and integration notes. Consult it before non-trivial changes — in particular the Exports table for the full engine surface. Key invariants that are easy to violate:

- **Engine is framework-free.** `src/autoq-engine.js` has zero imports and exposes a functional API. Do not import React, DOM APIs, or anything else into it — this is what allows the game to be reused in non-React hosts.
- **Game state is immutable from the caller's perspective.** Every engine call (`createGame`, `submitHand`, `takeMulligan`, …) returns a fresh game object; `AutoQ.jsx` replaces it wholesale in `useState`. Mutating the returned object in place will break React re-renders and the `onStateChange` subscription. Don't convert to a class or external store either.
- **Digraphs (QU, TH, CL, IN, ER) are single cards** with their own point values. `submitHand` auto-selects the highest-scoring breakdown when a word can be formed multiple ways — don't "simplify" this.
- **Bots replay real historical hands** from `src/bot-scores.json` against a shared depleting deck, with synthetic zero-score entries injected to prevent high-skew. If you touch bot selection, re-read the "Bot Behavior" section.
- **Stars only apply with 3+ total players and no ties** (longest word + most words, +10 each). See `calculateStars`.

## Component wiring

`src/main.jsx` mounts `<AutoQ />` with the bundled `bot-scores.json` and a `validateWords` function that POSTs to `/api/dictionary`. That endpoint is same-origin when the build is served from sipnstrut (e.g. under `/games/autoq-more-magic/`), so validation works transparently on deploy; on the Vite dev server the endpoint is absent, so validateWords **fail-opens** and accepts every composable word. `AutoQ` accepts three optional props (JSDoc at the top of `src/AutoQ.jsx`):

- **`scores`** — array of historical score objects; overrides the bundled `bot-scores.json`. Useful when a host wants live bot data from an API instead of the snapshot shipped in the bundle.
- **`validateWords`** — `async (input) => { valid, invalid }`. Wire this only when a dictionary backend is actually being introduced; otherwise all composable words are accepted.
- **`onStateChange`** — `(game) => void`. Fires on start, mulligan, submit, finish, and reset; receives the current game object, or `null` when no game is active. Used by the sipnstrut gameroom host to mirror game state into its own UI.

## Bot-score source

`src/bot-scores.json` is **not a static snapshot anymore** — it grows nightly. The sipnstrut.com codebase (sns-web) runs a daily workflow (`annotate-bot-scores.yml`) that pulls from two upstreams (QBIM API + sipnstrut.com BOTSEED), validates new entries against Merriam-Webster, and commits the updated file. A second workflow (`sync-bot-scores-to-autoq.yml`, deploy-key auth) then mirrors it into this repo as `chore: sync bot-scores.json from sns-web`. Next `npm run build` bundles the new entries automatically. Full pipeline diagram in `ARCHITECTURE.md`'s "Updating Bot Data" section.

For a host that wants higher freshness than the nightly bundle (or for non-sipnstrut hosts that don't get the mirrored file), the QBIM endpoint is CORS-open, read-only, no auth:

```
GET https://jqoyoafk29.execute-api.us-east-1.amazonaws.com/prod/stats/scores
```

Fetch once at mount, cache client-side (full-table scan), pass as `<AutoQ scores={data} />`. Each row has `hand`, `raw_score`, `words`, `breakdown`, `word_count`, `longest_word_letters` — exactly what the engine's bot selector consumes. Note: most rows are unplayed assignments; filter on `words && breakdown` before treating a row as a seed.

## .env.local

`.env.local` holds Merriam-Webster API keys (Dictionary + medical_v2) intentionally **without** the `VITE_` prefix so they are *not* exposed to the client bundle. Keys are for a future server-side validation endpoint; there is no server in this repo yet, and `validateWords` is not wired in `main.jsx`. Don't prefix them with `VITE_` to "make them work" — that would leak the keys into the static bundle.

## Styling

Plain CSS in `src/autoq.css`, scoped under `.autoq-section` with `--aq-*` custom properties for theming. Fonts (Anybody, DM Sans) come from Google Fonts. No CSS framework; don't introduce one.

## Deployment

`npm run build` → upload `dist/` contents to the target host. The production target is a subdirectory under sipnstrut.com's gameroom; `base: "./"` is what makes that work, so don't change it to an absolute base.
