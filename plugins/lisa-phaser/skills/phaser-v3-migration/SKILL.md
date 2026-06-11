---
name: phaser-v3-migration
description: This skill should be used when migrating a Phaser 3 game to Phaser 4, reviewing code that contains Phaser 3 idioms, or answering "does this v3 API still exist" questions — pipelines→render nodes, preFX/postFX/BitmapMask→Filters, tintFill→TintModes, removed namespaces (Geom.Point, Struct, Mesh/Plane, Camera3D, bundled Spine), config default changes, and texture-orientation changes. Pairs with phaser-rendering and phaser-project-structure.
---

# Phaser 3 → Phaser 4 Migration

## Overview

Phaser 4.0.0 "Caladan" (April 2026; current line v4.1 "Salusa") keeps the core
game-facing API stable — scenes, input, Arcade/Matter physics, tweens,
animations, audio, and the scale manager are **unchanged** — and replaces the
rendering internals. The official estimate for a standard-API game is hours,
not weeks. The npm package is still `phaser`; v4 ships its own
`types/phaser.d.ts`.

Upstream references for deeper detail: the official migration guide in the
phaser repo (`changelog/v4/4.0/MIGRATION-GUIDE.md`) and the shader-specific
guide. This skill is original Lisa content written against those primary
sources — it is not a port of any upstream plugin or skill package.

## What did NOT change (don't "migrate" these)

Scene lifecycle (`init/preload/create/update`), `this.scene` control, Loader
API (plus new `atlasPCT`), Input, Arcade & Matter physics, Tweens/Timelines,
`anims`, Scale Manager, Sound managers, Groups, Containers, particle emitter
API (v3.60 style).

## The breaking changes, by frequency of impact

| Phaser 3 | Phaser 4 |
| --- | --- |
| `setPipeline(...)` / `setPostPipeline(...)` / `resetPipeline()` | RenderNodes (`render.renderNodes` config) — rewrite required |
| `preFX` / `postFX` controllers | Unified **Filter** system (internal/external lists) |
| `BitmapMask` / `GeometryMask` | `Mask` filter; `Phaser.Actions.AddMaskShape()` |
| Bloom/Shine/Circle FX | `Actions.AddEffectBloom()` / `AddEffectShine()` |
| Gradient FX | `Gradient` GameObject |
| `setTintFill(c)` / `tintFill` | `setTint(c)` + `setTintMode(Phaser.TintModes.FILL)` |
| `setPipeline('Light2D')` | `gameObject.setLighting(true)`; lights gained `z` |
| `Phaser.Geom.Point` | Removed — `Phaser.Math.Vector2` (geometry returns Vector2) |
| `Phaser.Struct.Set` / `Struct.Map` | Native `Set` / `Map` |
| Shadertoy-style `Shader` uniforms | Rewritten Shader: `ShaderQuadConfig`, `setUniform()`, `#pragma` |
| RenderTexture/DynamicTexture draw-executes-immediately | **Buffered** — call `render()`; `preserve()`, `renderMode` |
| Bundled Spine 3/4 plugins | Removed — Esoteric's official Phaser Spine runtime |
| `Mesh`, `Plane`, OBJ loader, `Camera3D`, `Layer3D` | Removed, no replacement |
| `Math.TAU` = π/2 (wrong) | `Math.TAU` = 2π (correct); `PI_OVER_2` added; `PI2` removed |
| `Create.GenerateTexture`, polyfills, IE9 entry | Removed |

## Behavior/default changes that silently alter a port

- `roundPixels` default flipped **true → false**. If a pixel-art game looks
  blurry after porting, set `pixelArt: true` (or `render.smoothPixelArt`) —
  don't blanket-restore roundPixels.
- **Texture Y-flip**: UVs are GL-oriented (Y=0 bottom). Standard usage is
  translated automatically, but custom shaders and **compressed textures** must
  be updated/re-encoded.
- `Camera#matrix` no longer includes position (`matrixExternal` does;
  `matrixCombined` removed) — affects code doing manual camera-space math.
- `Grid` "outline" properties renamed to "stroke". TileSprite was rebuilt
  (atlas frames, `tileRotation`; cropping removed). `DOMElement` without a
  container parent now throws.

## Migration procedure

1. Bump `phaser` to `^4.1.0`; remove any `@types/phaser`.
2. Typecheck — removed APIs surface as compile errors; fix using the table.
3. Grep for the silent ones types won't catch: `Light2D`, `tintFill`,
   `Math.TAU`, custom shader GLSL, compressed-texture loads.
4. Rewrite pipelines/FX as RenderNodes/Filters ([[phaser-rendering]]); re-add
   `render()` calls after DynamicTexture drawing.
5. Swap Spine to the Esoteric runtime; check third-party plugins (`rex` users:
   the v4 line is the separate `phaser4-rex-plugins` package, which also ships
   `p3-fx` ports of the dropped v3 FX).
6. Verify visually per [[phaser-rendering]] — renderer migrations produce
   wrong-pixels bugs, not exceptions.

## Project conventions

This stack's lint config hard-bans the left column of the table in `src/**` —
a migration is not complete until lint passes with those rules on, with zero
disables.
