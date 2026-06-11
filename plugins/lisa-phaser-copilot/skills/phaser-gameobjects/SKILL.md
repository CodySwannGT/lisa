---
name: phaser-gameobjects
description: This skill should be used when creating or managing Phaser 4 GameObjects — sprites, images, text, containers, groups and object pooling, animations (anims), tweens, particles, and the v4 GPU layers (SpriteGPULayer, TilemapGPULayer) for massive object counts. Use it when adding entities, fixing per-frame allocation/GC issues, pooling projectiles, or choosing between a Container and a Group. Pairs with phaser-scenes, phaser-physics, phaser-rendering, and phaser-assets.
---

# Phaser 4 GameObjects

## Overview

GameObjects carry over from Phaser 3 largely unchanged: `Sprite`, `Image`,
`Text`, `BitmapText`, `Container`, `Group`, `Graphics`, the Shape objects, and
the particle system. v4 adds `Gradient`, `Stamp`, `CaptureFrame`, the Noise
objects, NineSlice tiling (`tileX`/`tileY`), and — the headline — the GPU
layers. Removed: `Mesh`, `Plane`, the OBJ loader, `Camera3D`/`Layer3D`
([[phaser-v3-migration]]).

## Choosing the right object

- **Image** for static visuals (cheaper than Sprite — no animation component).
- **Sprite** only when it animates.
- **Container** for transform-grouping a small, fixed set of children (a unit +
  its health bar). Containers are not free — don't nest deeply or use them as
  ad-hoc layers. In v4.1+, `Layer` is a true GameObject and is the right tool
  for z-grouping with filters.
- **Group** for managing many homogeneous objects — and for pooling (below).
- **Text** uses Canvas rasterization per change; for score counters and other
  hot text use `BitmapText`.

## Object pooling (mandatory for spawn-heavy entities)

Bullets, enemies, particles, pickups: never `new`/`destroy` per spawn — pool
through a Group:

```ts
this.bullets = this.add.group({ classType: Bullet, maxSize: 64, runChildUpdate: true });
// spawn
const b = this.bullets.get(x, y, Tex.GameAtlas, "bullet") as Bullet | null;
if (b) { b.setActive(true).setVisible(true); b.fire(dir); }
// despawn (inside Bullet when off-screen/expired)
this.bullets.killAndHide(this); this.body.enable = false;
```

`maxSize` caps the pool; `get()` returns `null` when exhausted — handle it
(drop the spawn) rather than growing unbounded.

## Per-frame discipline

In `update()` paths: no object literals, no array spreads, no `.map/.filter`
chains, no closures. Hoist scratch `Vector2`s and reuse them. The GC pause from
per-frame garbage is the most common cause of stutter that profilers get blamed
for.

## Animations and tweens

- Define animations once (Preloader `create` or a dedicated module) on the
  global `this.anims`; play by key constant: `sprite.play(Anim.Run)`.
- Tweens (`this.tweens.add`) and Timelines carry over from v3 unchanged. Kill
  tweens that target objects you pool/despawn — a tween holding a pooled object
  alive is a classic leak.

## Massive counts: the GPU layers

New in v4 — reach for these instead of "thousands of sprites":

- **SpriteGPULayer** — on the order of a million static-ish sprites in a single
  draw call, with per-member GPU-driven animation, easing, and parallax. Use for
  starfields, crowds, debris, background fauna.
- **TilemapGPULayer** — renders a whole tile layer as one quad with per-pixel
  cost, up to 4096×4096 tiles. Use for large maps, especially on mobile.

Regular Sprites + Groups remain correct for interactive entities (things with
bodies, input, per-entity logic).

## Particles

The particle API is the v3.60-style `this.add.particles(x, y, texture, config)`
emitter manager. v4 additions: particles respect the lighting system. Pool
explosion-style one-shot emitters or use `emitter.explode()` rather than
creating emitters per event.

## Project conventions

- Entity classes (`Bullet extends Phaser.Physics.Arcade.Sprite`) live in
  `src/entities/`, take their tunables from `src/logic/` config objects, and use
  asset-key constants ([[phaser-assets]]).
- Depth management: named depth constants (`Depth.World`, `Depth.FX`,
  `Depth.UI`), not scattered magic numbers.

## Verification

Object-lifecycle changes are verified in the running game: spawn/despawn the
entity repeatedly and watch the object count (`this.children.length`,
`group.getLength()`) stay bounded, and the FPS meter stay flat — an unbounded
count or sawtooth memory profile means the pool or tween cleanup is wrong.
