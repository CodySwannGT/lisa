---
name: phaser-assets
description: This skill should be used when loading or organizing assets in a Phaser 4 game — the Loader (images, texture atlases, spritesheets, audio, fonts), asset-pack manifests via this.load.pack, the new PCT compact atlas format (load.atlasPCT), typed asset keys, and where files live in the Vite project. Use it when adding any asset, restructuring loading, fixing a missing-texture/green-square bug, or optimizing load size. Pairs with phaser-project-structure, phaser-scenes, and phaser-gameobjects.
---

# Phaser 4 Assets and Loading

## Overview

All runtime assets live under `public/assets/` (served verbatim by Vite — never
`import` game assets through the bundler) and are loaded by Phaser's Loader in a
scene's `preload()`. The opinionated pattern: **one asset-pack manifest, loaded
by the Preloader, with every key defined as a typed constant.**

## Asset packs (the default loading strategy)

A pack is a JSON manifest the Loader consumes wholesale:

```json
{
  "main": {
    "files": [
      { "type": "atlasPCT", "key": "game-atlas", "url": "atlases/game.pct" },
      { "type": "image", "key": "background", "url": "images/background.png" },
      { "type": "audio", "key": "sfx-jump", "url": ["audio/jump.ogg", "audio/jump.m4a"] },
      { "type": "spritesheet", "key": "explosion", "url": "sheets/explosion.png",
        "frameConfig": { "frameWidth": 64, "frameHeight": 64 } }
    ]
  }
}
```

```ts
// Preloader.preload()
this.load.pack("game-pack", "assets/pack.json");
```

Why packs: loading is declared in one reviewable file instead of scattered
`load.*` calls; adding an asset never touches scene code beyond using the key.

## Texture atlases — the rule, not the suggestion

Individual images break sprite batching. Everything that renders together ships
in an atlas:

- **PCT (Phaser Compact Texture)** is the preferred v4 atlas format —
  `this.load.atlasPCT(key, url)` — its manifests are 90–95% smaller than the
  JSON-hash equivalent. JSON/XML/Unity/multi-atlas loaders still exist for
  third-party toolchains.
- Spritesheets (`load.spritesheet`) are acceptable only for uniform-grid
  animation strips; anything else is an atlas.

## Audio

- Provide at least two encodings (`.ogg` + `.m4a`) in the url array; Phaser
  picks the first the browser can play.
- Web Audio is the default manager; it unlocks on first user gesture — never
  autoplay sound before input (it will silently fail and "work on my machine").
- Use audio sprites (`load.audioSprite`) for large sets of short SFX.

## Typed keys

Every key lives in `src/assets.ts`:

```ts
export const Tex = { GameAtlas: "game-atlas", Background: "background" } as const;
export const Sfx = { Jump: "sfx-jump" } as const;
export const SceneKeys = { Boot: "Boot", Preloader: "Preloader", Game: "Game" } as const;
```

Scenes use `Tex.GameAtlas`, never `"game-atlas"` inline. A bad inline key fails
at runtime as a green square or silent missing audio; a bad constant fails in
review and in tests that assert the pack manifest covers every constant.

## Loading UX and failure handling

- The Preloader binds `this.load.on("progress", …)` to a progress bar built from
  Boot-loaded art ([[phaser-project-structure]]).
- Handle `loaderror`: `this.load.on(Phaser.Loader.Events.FILE_LOAD_ERROR, …)` —
  log the key and URL; a missing asset must fail loudly in dev, not render as a
  placeholder in production.

## Project conventions

- `public/assets/` subdirs: `atlases/`, `images/`, `audio/`, `sheets/`, `fonts/`,
  plus `pack.json` at the root of `assets/`.
- Generated atlas files (PCT/JSON + PNG pages) are build inputs, committed to the
  repo; their source art lives wherever the art pipeline keeps it.
- A test should assert that every key constant in `src/assets.ts` appears in
  `pack.json` (cheap manifest-coverage check; see [[phaser-testing]]).

## Verification

Asset changes are verified by booting the game and watching the network panel /
console: every file 200s, no `FILE_LOAD_ERROR`, and the new asset visibly renders
or audibly plays in the scene that uses it.
