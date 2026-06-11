---
name: phaser-rendering
description: This skill should be used when working on rendering in Phaser 4 — the render node architecture that replaced v3 pipelines, the unified Filter system that replaced FX and masks, tint modes, pixel-rounding options (roundPixels, smoothPixelArt, vertexRoundMode), DynamicTexture's buffered drawing, the Extern object for external WebGL, and lighting. Use it for any visual-effect, shader, mask, or custom-rendering task, and whenever v3 rendering idioms (setPipeline, preFX/postFX, BitmapMask, tintFill) appear. Pairs with phaser-gameobjects and phaser-v3-migration.
---

# Phaser 4 Rendering

## Overview

Phaser 4 replaced the entire v3 WebGL pipeline system with a **render node
architecture**: small single-purpose nodes (each with a `run` method, batchable
where it matters) that the renderer composes per object. WebGL state is fully
managed, context loss restores automatically, and rendering is just-in-time —
GPU work is deferred until actually needed. WebGL2 is fully supported; WebGL1
still works; **there is no WebGPU backend**; the Canvas renderer is deprecated.

Practical consequences, in order of how often they bite:

## Filters replaced FX and masks

The v3 `preFX`/`postFX` controllers and `BitmapMask` are gone. Phaser 4 has one
unified **Filter** system that works on any GameObject **and on cameras**:

- Geometry/bitmap masks → the `Mask` filter.
- Bloom / Shine / Circle FX → `Phaser.Actions.AddEffectBloom()`,
  `AddEffectShine()`, `AddMaskShape()` helpers.
- Gradient FX → the new `Gradient` GameObject.
- Filters split into **internal** and **external** lists (replacing the
  pre/post distinction); filter setters are chainable.
- A filtered or masked `Container` can itself be used as a mask source — new
  capability, not possible in v3.

## Tinting

`tintFill` and `setTintFill()` were removed. Use `setTint(color)` plus
`setTintMode(mode)` with `Phaser.TintModes`: `MULTIPLY` (default), `FILL`,
`ADD`, `SCREEN`, `OVERLAY`, `HARD_LIGHT`.

## Custom shaders and pipelines

- A v3 custom pipeline must be rewritten as a **RenderNode**, registered at boot
  via the game config's `render.renderNodes` map.
- The `Shader` GameObject was rewritten: config-based constructor
  (`ShaderQuadConfig`), explicit `setUniform()`, `renderImmediate`, GLSL
  `#pragma` directives. Shadertoy-style automatic uniforms are gone.
- **Never make raw WebGL calls** — wrap external GL renderers in the `Extern`
  GameObject, which fences GL state around your code.
- Texture coordinates now follow GL orientation (**Y=0 at bottom**). Phaser
  translates standard usage automatically, but custom shaders and pre-compressed
  textures must account for the flip (re-encode compressed textures).

## Pixel rounding and pixel art

- `roundPixels` defaults to **`false`** in v4 (v3: true). The old default caused
  flicker on rotated/scaled objects; leave the new default alone.
- Pixel-art projects choose ONE strategy: `pixelArt: true` (crisp,
  nearest-neighbor) or `render.smoothPixelArt: true` (WebGL-only, anti-aliased
  scaling/rotation of pixel art).
- Per-object fine-tuning: `gameObject.vertexRoundMode` —
  `"off" | "safe" | "safeAuto" | "full" | "fullAuto"`.

## DynamicTexture / RenderTexture are buffered

Draw commands no longer execute immediately — they queue until you call
**`render()`**. Forgetting `render()` is the #1 "my RenderTexture is blank" bug
in v4. Related: `preserve()` keeps a command buffer for reuse, `callback()`
injects custom steps, and `RenderTexture#renderMode` selects
`"render" | "redraw" | "all"`.

## Lighting

`setPipeline('Light2D')` is gone. Enable per object with
`gameObject.setLighting(true)`; lights have an explicit `z`; self-shadowing is
supported; lighting now works on many more object types (including particles).

## Performance notes specific to the v4 renderer

- Quads render from index buffers (4 vertices, not 6) and batching survives
  multi-texture switches better, especially on mobile — but atlases are still
  the foundation of batching ([[phaser-assets]]).
- For massive draw counts use `SpriteGPULayer` / `TilemapGPULayer`
  ([[phaser-gameobjects]]) instead of thousands of individual sprites.

## Verification

Rendering changes are verified visually in a real browser: `bun run dev`, then a
Playwright screenshot assertion or manual confirmation that the effect renders
and the console shows no WebGL errors. For filter/shader work, verify on both a
WebGL2 and (if supported) WebGL1 context before calling it done.
