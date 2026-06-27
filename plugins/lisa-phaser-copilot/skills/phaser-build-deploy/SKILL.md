---
name: phaser-build-deploy
description: This skill should be used when configuring the production build or deploying a Phaser 4 game — the Vite prod config (manualChunks to split the phaser vendor chunk, terser two-pass minification), content-hashed assets with immutable caching, the base path per host, vite-plugin-pwa (autoUpdate + globPatterns covering game assets), a bundle-size budget, and static hosting. Use it when setting up the build, fixing caching/base-path issues, adding the PWA, or enforcing bundle size. Pairs with phaser-asset-pipeline, phaser-project-structure, and phaser-testing.
---

# Phaser 4 Build and Deploy

## Overview

The game ships as static files built by **Vite** (with TypeScript 6, `phaser`
pinned `^4.2.0`). A good prod build does four things: split the large `phaser`
vendor chunk so app code can change without re-downloading the engine, minify
hard, content-hash everything for immutable caching, and register a PWA service
worker that precaches game assets. A bundle-size budget keeps the result honest.
The asset pipeline ([[phaser-asset-pipeline]]) runs first; this skill packages
its output.

## Vite production config

```ts
// vite.config.ts
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  base: process.env.BASE_PATH ?? "/",   // "/" for root domains, "/repo/" for project pages
  build: {
    target: "es2022",
    assetsInlineLimit: 0,               // never inline game assets — keep them cacheable files
    minify: "terser",
    terserOptions: { compress: { passes: 2, drop_console: true }, format: { comments: false } },
    rollupOptions: {
      output: {
        manualChunks: { phaser: ["phaser"] },          // engine in its own long-lived chunk
        entryFileNames: "assets/[name]-[hash].js",      // content hash on everything
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
});
```

`manualChunks: { phaser: ["phaser"] }` is the single highest-value line: Phaser is
hundreds of KB and rarely changes, so isolating it means a gameplay tweak only
busts the small app chunk. Two-pass terser squeezes meaningfully more than one.

## Asset hashing and immutable caching

Every emitted file carries a content hash, so it can be cached forever and a
change produces a new filename (cache-busted automatically):

```
/assets/index-3f2a.js        Cache-Control: public, max-age=31536000, immutable
/assets/phaser-9b1c.js       Cache-Control: public, max-age=31536000, immutable
/index.html                  Cache-Control: no-cache   (must revalidate to pick up new hashes)
```

`index.html` is the only file served `no-cache` — it points at the hashed assets,
so revalidating it is enough to roll the whole app forward. Game assets under
`public/assets/**` ([[phaser-asset-pipeline]]) are hashed by the PWA precache
manifest below even though Vite copies them verbatim.

## Base path per host

`base` must match where the game is served:

- Root domain / custom domain → `base: "/"`.
- GitHub Pages project site → `base: "/<repo>/"`.
- Subpath behind a reverse proxy → that subpath.

A wrong `base` is the classic "works on `bun run dev`, blank canvas on deploy"
bug — assets 404 because the URLs are absolute to the wrong root. Drive it from an
env var so the same build config serves every host.

## PWA: vite-plugin-pwa (on by default)

The PWA is on by default: install-to-home-screen, offline play, and auto-update.
`registerType: "autoUpdate"` ships new versions without a manual prompt; the
critical part is extending `globPatterns` to precache **game assets** (atlases,
audio sprites, fonts) — the Workbox default only catches JS/CSS/HTML and would
leave a "installed but can't load its art offline" game.

```ts
VitePWA({
  registerType: "autoUpdate",
  includeAssets: ["favicon.svg"],
  workbox: {
    globPatterns: ["**/*.{js,css,html,png,jpg,svg,webp,woff2,json,fnt,mp3,m4a,ogg}"],
    // critically include packed game assets:
    globDirectory: "dist",
    additionalManifestEntries: [],     // or widen globPatterns to assets/**/*.{png,json,fnt,ogg,m4a}
    maximumFileSizeToCacheInBytes: 8 * 1024 * 1024, // raise above default 2MB for atlas pages
  },
  manifest: { name: "Game", short_name: "Game", display: "fullscreen", orientation: "landscape",
              background_color: "#000000", theme_color: "#000000", icons: [/* 192/512 */] },
})
```

Set `maximumFileSizeToCacheInBytes` above the default 2 MB or large atlas pages
silently fall out of the precache.

## Bundle-size budget

A byte budget, checked after `bun run build`, fails the PR when a stray dependency
or an un-split engine chunk bloats the download. This is the same budget the
bundle-size gate in [[phaser-testing]] enforces in CI.

```jsonc
// size-limit config (or a custom post-build check)
[
  { "name": "app",    "path": "dist/assets/index-*.js",  "limit": "60 kB" },
  { "name": "phaser", "path": "dist/assets/phaser-*.js", "limit": "400 kB" }
]
```

Separate budgets per chunk catch the right regressions: app growth from your code
vs. an accidental second copy of a big dependency landing in the phaser chunk.

## Static deploy

Output is plain static files in `dist/` — host on any static CDN (GitHub Pages,
Netlify, Cloudflare Pages, S3+CloudFront). Requirements: serve over HTTPS (PWA +
Web Audio expect a secure context), set the cache headers above (immutable for
hashed assets, no-cache for `index.html`), and for client-routed builds add an
SPA fallback to `index.html`. Build with the host's base path:

```bash
BASE_PATH=/my-game/ bun run build   # then publish dist/
```

## Project conventions

- Run the asset pipeline before the build (`prebuild`) so `public/assets/**` and
  `src/assets.ts` are current ([[phaser-asset-pipeline]]).
- `phaser` is always its own manualChunk; never let it merge into the app chunk.
- `base` comes from an env var, never hardcoded to one host.
- The bundle-size budget is committed and CI-gated ([[phaser-testing]]).
- Build pins: `phaser ^4.2.0`, Vite, TypeScript 6.

## Verification

Verified by `bun run build` succeeding under the size budget, then `bun run
preview` (served at the deploy `base`) booting the game with no 404s and no
console errors. Confirm the PWA registers (Application → Service Workers), load
once online then go offline and reload to confirm assets are precached, and
confirm a redeploy auto-updates clients without a manual cache clear.
</content>
