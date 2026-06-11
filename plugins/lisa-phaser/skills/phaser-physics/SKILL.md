---
name: phaser-physics
description: This skill should be used when working with physics in a Phaser 4 game — Arcade physics bodies, velocity/acceleration, colliders and overlaps, the fixed timestep, groups and static groups, and when (rarely) to reach for Matter.js instead. Use it when adding movement, collision, platforming behavior, or debugging tunneling/jitter. Pairs with phaser-gameobjects and phaser-scenes.
---

# Phaser 4 Physics

## Overview

Phaser 4 bundles the same two engines as v3: **Arcade** (AABB, fast, the
default) and **Matter.js** (full rigid-body). The opinionated default is
Arcade; Matter is opt-in for genuinely physical mechanics (stacking, joints,
torque). Bundled Spine left v4, Matter did not.

Key v4 fact: Arcade's **`fixedStep` defaults to `true`** — the world steps at a
fixed rate decoupled from render FPS. Keep it. Fixed-step physics is what makes
movement deterministic across 60 Hz/144 Hz displays and what makes
logic-level tests reproducible. Do not switch to variable step to mask a bug.

## Setup

```ts
// game config
physics: { default: "arcade", arcade: { gravity: { x: 0, y: 0 }, debug: false } }

// scene
const player = this.physics.add.sprite(x, y, Tex.GameAtlas, "player");
player.setCollideWorldBounds(true);
const platforms = this.physics.add.staticGroup();
this.physics.add.collider(player, platforms);
this.physics.add.overlap(player, pickups, (p, item) => this.collect(item), undefined, this);
```

## Movement rules

- Move bodies with **velocity/acceleration** (`setVelocity`, `setAccelerationX`),
  never by writing `x`/`y` per frame — direct position writes teleport the body
  past colliders and create tunneling.
- For teleports (respawn, screen wrap) set position once and reset the body
  (`body.reset(x, y)`).
- Drag, bounce, and max velocity are body config, not per-frame math:
  `setDrag`, `setBounce`, `setMaxVelocity`.
- Platformer jump checks use `body.blocked.down` (world/static contact) rather
  than `touching.down` alone.

## Colliders, overlaps, groups

- `collider` separates bodies; `overlap` only reports. Pickups/triggers are
  overlaps; walls/floors are colliders.
- Register colliders **once in `create`** between groups — never inside
  `update` (a per-frame `add.collider` leaks collider objects and tanks the
  frame rate).
- Pooled entities ([[phaser-gameobjects]]) must disable their body on despawn
  (`body.enable = false`) or dead objects keep colliding invisibly.

## Tunneling and jitter checklist

1. Fast small bodies passing through thin walls → keep `fixedStep: true`, give
   walls thickness, cap speed with `setMaxVelocity`.
2. Jitter against walls → bodies overlap due to direct position writes; use
   velocities.
3. "Collider stopped working" after pooling → the body wasn't re-enabled on
   `get()` or wasn't disabled on despawn.
4. Different behavior on different monitors → someone turned off fixed step or
   moved physics math into `update` scaled by render delta.

## When Matter is justified

Choose Matter for: realistic stacking/toppling, constraints/joints, compound
bodies, polygon collision shapes. Run it in a dedicated scene; don't mix Arcade
and Matter for the same entities. If the mechanic is "platformer/top-down/
shmup", the answer is Arcade.

## Determinism

Physics-adjacent randomness (spawn jitter, knockback variance) uses the seeded
`Phaser.Math.RND` — never `Math.random()` — so a recorded seed reproduces a run
exactly. Combined with fixed-step Arcade, gameplay bugs become replayable; see
[[phaser-testing]].

## Verification

Physics changes are verified by playing the affected interaction in the running
game with `arcade.debug: true` toggled on (body outlines visible), confirming
contacts/velocities behave as specified, then toggling debug back off before
committing.
