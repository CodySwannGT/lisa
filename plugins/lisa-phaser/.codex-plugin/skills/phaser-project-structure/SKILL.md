---
name: phaser-project-structure
description: "creating, restructuring, or…"
---

# Phaser 4 Project Structure

## Overview

This stack targets **Phaser 4** (v4.2+, npm package `phaser@^4.2.0`), built
with **Vite + TypeScript** — the layout the official `phaserjs/template-vite-ts`
template and `npm create @phaserjs/game@latest` scaffold. Phaser 4 ships its own
type definitions (`types/phaser.d.ts`); do not add `@types/phaser`.

## Canonical layout

| Path | Role |
| --- | --- |
| `index.html` | Single page that loads `src/main.ts`; owns the game container div |
| `src/main.ts` | Game config + `new Phaser.Game(config)` — the only bootstrap file |
| `src/scenes/` | One scene class per file (`Boot.ts`, `Preloader.ts`, `MainMenu.ts`, `Game.ts`, …) |
| `src/logic/` | Pure TypeScript game logic — **no `phaser` imports** (testable) |
| `src/assets.ts` | Typed asset-key constants (texture, audio, anim, scene keys) |
| `public/assets/` | Static assets served by Vite (atlases, audio, packs) — never imported |
| `tests/` | Vitest unit tests for `src/logic/**` and pure helpers |
| `dist/` | Vite build output — generated, never edited or committed |

## The game config

One config object in `src/main.ts`. The opinionated baseline:

```ts
const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,            // WebGL; Canvas renderer is deprecated in v4
  width: 1280,
  height: 720,
  parent: "game-container",
  backgroundColor: "#028af8",
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  physics: {
    default: "arcade",
    arcade: { gravity: { x: 0, y: 0 }, debug: false }, // fixedStep defaults to true in v4 — keep it
  },
  scene: [Boot, Preloader, MainMenu, Game],
};
```

v4-specific config facts:

- `roundPixels` now defaults to **`false`** (v3 defaulted true). Leave it — the
  new default prevents flicker on rotated/scaled objects.
- Pixel-art games: `pixelArt: true` (nearest-neighbor + roundPixels), or the new
  **`render.smoothPixelArt: true`** (WebGL-only) for pixel art that rotates or
  scales smoothly. Pick one per project and record the choice.
- Custom render nodes register under `render.renderNodes` — see the official `filters-and-postfx` skill.
- `Phaser.HEADLESS` exists for logic-only boots (tests) — see [[phaser-testing]].

## Scene flow

Four-stage boot, in order (see the official `scenes` skill for lifecycle detail):

1. **Boot** — loads only the handful of assets the Preloader's loading screen
   needs (logo, progress-bar art). No game assets here.
2. **Preloader** — renders the loading UI and loads everything else, preferably
   via a single asset-pack manifest (see the official `loading-assets` skill), then starts MainMenu.
3. **MainMenu** — entry UI; starts Game.
4. **Game** (+ overlay scenes like `HUD`, `Pause` run in parallel) — gameplay.

## Project conventions

- All game code is TypeScript under `src/`; `bun run dev` (vite), `bun run build`
  (vite build), `bun run preview` serve and package it.
- Scenes orchestrate; they do not contain algorithmic game logic. Rules
  evaluation, procedural generation, scoring, pathfinding, and state machines
  live in `src/logic/` as pure functions/classes so Vitest can run them without
  a browser.
- Asset keys come from `src/assets.ts` constants — a typo in an inline string
  key fails at runtime only; a typo in a constant fails at compile time.
- Determinism: seed `Phaser.Math.RND` (or a local `RandomDataGenerator`) from a
  single place; never `Math.random()` in game code.

## Verification

A structural change is verified when `bun run typecheck`, `bun run test`, and
`bun run build` pass AND the game boots: `bun run dev`, open the page, confirm
the canvas renders past the Preloader with no console errors.
