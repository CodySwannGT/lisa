---
name: phaser-asset-pipeline
description: This skill should be used when setting up or changing the build-time asset pipeline of a Phaser 4 game — packing raw art in assets/src into public/assets (free-tex-packer-core texture atlases, audiosprite audio sprites, BMFont bitmap fonts) and the codegen step that emits typed keys to src/assets.ts so a missing or renamed key is a compile error. Use it when adding source art, wiring packing into the build, regenerating typed keys, or eliminating raw string asset keys. Assumes the raw art already exists — get it first via phaser-asset-sourcing (CC0 sourcing + license gate). Pairs with phaser-asset-sourcing, the official loading-assets skill, phaser-build-deploy, and phaser-services.
---

# Phaser 4 Asset Pipeline

## Where the raw art comes from (read this first)

This skill **packs** raw art; it does not conjure it. The inputs under
`assets/src/**` are **real, licensed source art you sourced first** — they do not
magically pre-exist, and they are not procedural `generateTexture` rectangles.
Before you can pack anything, use **[[phaser-asset-sourcing]]**: it covers where
game art comes from (curated CC0 packs like Kenney and Ninja Adventure → deriving
CC0 art → asking the human), the strict CC0-or-equivalent license gate with
`assets/LICENSES.md` evidence, provenance via a committed ingest script, and why
`generateTexture` placeholders are tracked art debt rather than a finished state.
The rule of thumb: **source → `assets/src` → pack (this skill) → typed keys.**

## Overview

The pipeline turns committed source art into runtime form — it is a build step,
not a substitute for having art. Raw source art lives in `assets/src/**` (PNGs,
audio, font sources); a build step packs it into `public/assets/**` (atlases,
audio sprites, bitmap fonts) and **codegens typed key constants into
`src/assets.ts`**. The payoff: a missing or renamed asset is a **compile error**,
not a green square or silent-missing audio at runtime. No raw string asset /
scene / event keys anywhere — they all come from the generated module (the
official `loading-assets` skill covers loading those keys at runtime).

## Layout

| Path | Role |
| --- | --- |
| `assets/src/sprites/**` | Raw individual PNGs — the art source of truth (sourced per [[phaser-asset-sourcing]]) |
| `assets/src/audio/**` | Raw audio clips (wav/ogg sources) |
| `assets/src/fonts/**` | Font sources for BMFont generation |
| `assets/LICENSES.md` | License evidence per source pack (CC0 quote + evidence URL) — see [[phaser-asset-sourcing]] |
| `scripts/ingest-assets.mjs` | The provenance record — how each frame was carved from its source pack into `assets/src` (re-runnable) |
| `public/assets/**` | **Generated** packed output (atlases, audiosprites, fonts, `pack.json`) — git-ignored or committed as a build artifact |
| `src/assets.ts` | **Generated** typed key constants — never edited by hand |
| `scripts/pack-assets.mjs` | The pipeline driver (runs the three packers + codegen) |

## Step 1: texture atlases with free-tex-packer-core

`free-tex-packer-core` packs many PNGs into atlas pages plus a JSON manifest, in
a Node script (no GUI, runs in CI):

```js
// scripts/pack-assets.mjs (excerpt)
import { packAsync } from "free-tex-packer-core";
import { glob } from "glob";
import { readFile, writeFile } from "node:fs/promises";

const images = await Promise.all(
  (await glob("assets/src/sprites/**/*.png")).map(async p => ({
    path: p.replace("assets/src/sprites/", ""), contents: await readFile(p),
  })));

const files = await packAsync(images, {
  textureName: "game", width: 4096, height: 4096,
  packer: "MaxRectsPacker", packerMethod: "Smart", // see gotcha below
  padding: 2, extrude: 1,                            // 1px extrude kills bleeding at integer scales
  allowRotation: false, allowTrim: false,            // pixel-art-safe (see below)
  detectIdentical: true,
  exporter: "JsonHash", removeFileExtension: true, prependFolderName: true,
});
for (const f of files) await writeFile(`public/assets/atlases/${f.name}`, f.buffer ?? f.content);
```

The frame names in the manifest become the atlas frame keys you reference as
generated constants. Atlas everything that renders together — loose images break
sprite batching (the official `loading-assets` skill). Full-screen backdrops and
parallax layers are the exception: copy them verbatim into `public/assets/images`
and `load.image` them — they would bloat an atlas. Even this exception keeps the
no-raw-string promise: the codegen step emits one generated constant per copied
image (the `Img` record below), and the loader derives the file path from the
key in exactly one place — a call site never spells out a path string.

**Packer gotcha (verified in the reference implementation):** use
`packer: "MaxRectsPacker"` with `packerMethod: "Smart"`. The other packer methods
produce degenerate single-row *strip* atlases that waste enormous texture space
and can blow past the max texture size. **For pixel art**, set `allowTrim: false`
and `allowRotation: false`: trimming makes animation frames different sizes so
anchors swim between frames, and rotation makes Phaser frame-flipping non-trivial.
Add `extrude: 1` to stop edge bleeding when the game renders at integer scales.
Keep inputs **sorted** and emit **no timestamps** so the packed output is
deterministic and can be committed + `git diff --exit-code`-checked in CI.

## Step 2: audio sprites with audiosprite

`audiosprite` concatenates short SFX into one file (in multiple codecs) plus a
JSON map of `{ start, end }` per clip — one request, one decode, instead of dozens:

```jsonc
// package.json script
"pack:audio": "audiosprite --output public/assets/audio/sfx --export ogg,m4a --format howler2 assets/src/audio/*.wav"
```

Provide at least two codecs (`ogg` + `m4a`) so every browser can play one. Load
with `this.load.audioSprite(Audio.Sfx, "audio/sfx.json")` and play by sprite key.

## Step 3: bitmap fonts with BMFont

`BitmapText` is the performant choice for high-churn text (scores, timers) —
the official `loading-assets` skill / [[phaser-i18n]]. Generate the `.fnt` (XML/JSON) + PNG page
from a font source with a BMFont tool (`msdf-bmfont-xml` or the `bmfont` CLI) in
the same script:

```jsonc
"pack:font": "msdf-bmfont -o public/assets/fonts/ui --font-size 42 --texture-size 1024 1024 assets/src/fonts/ui.ttf"
```

Load with `this.load.bitmapFont(Font.UI, "fonts/ui.png", "fonts/ui.fnt")`.

## Step 4: codegen typed keys into `src/assets.ts`

After packing, walk the generated manifests and emit `as const` key maps. This is
the step that turns runtime failures into compile failures:

```js
// scripts/pack-assets.mjs (codegen excerpt)
const atlas = JSON.parse(await readFile("public/assets/atlases/game.json", "utf8"));
const frames = Object.keys(atlas.frames); // raw keys, e.g. "player/idle"
const sfx = Object.keys(JSON.parse(await readFile("public/assets/audio/sfx.json","utf8")).spritemap);
const images = (await readdir("public/assets/images", { recursive: true }))
  .filter(f => f.endsWith(".png")).sort(); // standalone backdrops/parallax layers

const out = `// AUTO-GENERATED by scripts/pack-assets.mjs — do not edit.
export const Tex = { GameAtlas: "game" } as const;
export const Frame = { ${frames.map(k => `${toIdent(k)}: "${k}"`).join(", ")} } as const;
export const Img = { ${images.map(p => `${toIdent(p)}: "img-${p.replace(/\.png$/u, "")}"`).join(", ")} } as const;
export const Audio = { Sfx: "sfx" } as const;
export const Sfx = { ${sfx.map(s => `${toIdent(s)}: "${s}"`).join(", ")} } as const;
export const Font = { UI: "ui" } as const;
export const SceneKeys = { Boot:"Boot", Preloader:"Preloader", MainMenu:"MainMenu", Game:"Game" } as const;
export const GameEvent = { ScoreChanged:"score-changed", EnemyDied:"enemy-died" } as const;
`;
await writeFile("src/assets.ts", out);
```

Scenes import `Tex`, `Frame`, `Img`, `Sfx`, `Font`, `SceneKeys`, `GameEvent` —
never an inline string. Rename art, re-run the pipeline, and every now-stale
reference fails `bun run typecheck` immediately. (Scene/event keys are kept in
the same generated module so they share the no-raw-string discipline; edit them
via the codegen template, not by hand.)

**Animation keys are the one deliberately hand-authored layer.** Codegen cannot
know how frames group into cycles, so animation keys live in a hand-written
`as const` record (e.g. `AnimKeys` / `FxAnims`) whose frame sequences are built
from the generated `Frame` constants — and the contract test below proves every
frame those definitions reference exists in the committed atlases. The typed-key
guarantee is therefore: **generated** constants for textures, frames, images,
audio, and fonts; **hand-authored typed constants + contract-test coverage** for
animation keys. Nothing is a raw inline string either way.

## Step 5: wire into the build

The pipeline runs before dev and before build so generated output is never stale:

```jsonc
// package.json
"scripts": {
  "assets": "node scripts/pack-assets.mjs",
  "predev":   "bun run assets",
  "prebuild": "bun run assets",
  "dev":   "vite",
  "build": "vite build"
}
```

For fast iteration, a `--watch` mode on the pack script re-packs changed source
art. In CI the pack step runs once before `vite build`; the build then hashes the
generated files for immutable caching ([[phaser-build-deploy]]).

## Project conventions

- `assets/src/**` is the source of truth; `public/assets/**` and `src/assets.ts`
  are generated — treat them as build output (re-runnable, not hand-edited).
- One atlas per render group, one audiosprite per SFX set, BMFont for hot text.
- A **contract test** asserts every frame name the game *derives by convention*
  (e.g. `battlerWalkFrame(ref, dir, n)`, FX-strip frame lists, per-speaker
  portrait keys) resolves to a real entry in the committed atlas JSON under
  `public/assets`. The other constants in `src/assets.ts` (`SceneKeys`,
  `GameEvent`, `Font`, `Audio`, standalone `Img` entries) are plain generated
  literals already enforced by TypeScript at every use site, so they don't need
  a runtime check — only names built at runtime from a pattern can go stale
  silently without one. This keeps that narrower guarantee honest: a renamed or
  missing frame fails a headless Vitest assertion instead of rendering a silent
  black square. The test reads the packed JSON directly — zero Phaser
  ([[phaser-testing]]):

  ```ts
  const frames = new Set(Object.keys(
    JSON.parse(readFileSync("public/assets/atlases/battlers.json", "utf8")).frames));
  for (const ref of BATTLER_REFS)
    for (const dir of DIRS) {
      expect(frames).toContain(battlerIdleFrame(ref, dir));
      expect(frames).toContain(battlerAttackFrame(ref, dir));
      for (let n = 0; n < WALK_FRAME_COUNT; n++)
        expect(frames).toContain(battlerWalkFrame(ref, dir, n));
    }
  // ...and one loop per remaining derived family (FX-strip frame lists,
  // per-speaker portrait keys, …) — the test is only done when EVERY name the
  // game can derive at runtime has been asserted against the committed atlas.
  ```

- Ship a `--check` mode on the pack script: it re-packs into a temp staging area
  and exits non-zero if any committed output under `public/assets` — atlases,
  standalone images, audio, fonts alike — or `src/assets.ts` is stale, so CI
  proves the committed artifacts (and every generated key they back) are current.
- The generated `src/assets.ts` is the single source of asset/scene/event keys —
  the no-raw-string-keys rule depends on it existing.

## Verification

The pipeline is verified by deleting a source PNG and re-running `bun run assets`:
the corresponding generated constant disappears and `bun run typecheck` fails at
every use site (proving keys are compile-checked). Then boot the game and confirm
the atlas/audiosprite/font load with no `FILE_LOAD_ERROR` and render/play
correctly.
</content>
