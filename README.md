# AutoQ

A solo word game based on Quiddler — React + Vite standalone app.

## Develop

```bash
npm install
npm run dev
```

## Build for deployment

```bash
npm run build
```

Output goes to `dist/`. Upload its contents to any static host (the website, Netlify, GitHub Pages, etc.).

Because `vite.config.js` sets `base: "./"`, the build works from any subdirectory on the host — no path rewriting needed.

## Architecture

See [ARCHITECTURE.md](./ARCHITECTURE.md) for engine API, game state shape, and integration notes.
