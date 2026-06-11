---
name: phaser-scenes
description: This skill should be used when creating or editing Phaser 4 scenes — the init/preload/create/update lifecycle, starting/stopping/sleeping scenes, running scenes in parallel (HUD/pause overlays), passing data between scenes, the registry, and event-based communication. Use it when adding a scene, wiring scene transitions, or debugging lifecycle/ordering issues. Pairs with phaser-project-structure, phaser-assets, and phaser-gameobjects.
---

# Phaser 4 Scenes

## Overview

Scenes are Phaser's unit of game-flow composition. The lifecycle is unchanged
from Phaser 3 — `init(data)` → `preload()` → `create(data)` → `update(time, delta)`
— and each scene owns its display list, input, camera, time events, and (if
enabled) physics world.

One scene class per file under `src/scenes/`, exported as a class whose key
matches the file name:

```ts
export class Game extends Phaser.Scene {
  constructor() {
    super("Game"); // the scene key — also a constant in src/assets.ts
  }
  init(data: GameStartData) { /* receive data, reset state */ }
  preload() { /* per-scene late loads only — bulk loading is the Preloader's job */ }
  create() { /* build GameObjects, wire input + events */ }
  update(_time: number, delta: number) { /* per-frame; delta in ms */ }
}
```

## Lifecycle rules

- `init` receives the data passed by `scene.start(key, data)` — type that payload
  (an interface per scene) instead of `any`.
- `preload` in gameplay scenes should be rare; the Preloader scene loads the game
  pack up front ([[phaser-assets]]). Use per-scene `preload` only for genuinely
  scene-local or late-bound assets.
- `create` is where GameObjects are built. Everything constructed here must be
  cleaned up on shutdown if it lives outside the scene's display list (timers on
  other scenes, global event listeners, DOM elements).
- `update(time, delta)` runs per render frame. Frame-rate-independent movement
  multiplies by `delta`; physics movement belongs in Arcade bodies, not manual
  position math ([[phaser-physics]]).

## Scene control

Via `this.scene` (the ScenePlugin):

- `start(key, data)` — stop the current scene, start another.
- `launch(key, data)` — start another scene **in parallel** (HUD, pause overlay).
- `pause` / `resume`, `sleep` / `wake` — suspend update/render without rebuild.
- `stop(key)` — shuts a scene down (fires `Phaser.Scenes.Events.SHUTDOWN`).
- `bringToTop` / `sendToBack` — z-order between parallel scenes.

Overlay pattern: `Game` launches `HUD`; `HUD` renders score/health and listens to
events from `Game`. Pause: launch `Pause`, `this.scene.pause("Game")`.

## Communicating between scenes

In preference order:

1. **Events** — emit on the scene's own emitter and have the other scene listen:
   `gameScene.events.emit("score-changed", score)`. Always remove listeners on
   `SHUTDOWN`: `this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => …)`.
2. **`scene.start`/`launch` data** — for handoff at transition time.
3. **The registry** (`this.registry`) — game-wide key/value store with change
   events; for cross-cutting state like settings or the run seed.

Never reach into another scene's GameObjects directly
(`this.scene.get("Game").player.x = …`) — that couples scenes to each other's
display-list internals and breaks when the other scene rebuilds.

## Project conventions

- Scene keys are constants in `src/assets.ts` (e.g. `SceneKeys.Game`) — `super(SceneKeys.Game)`.
- A scene is an orchestrator: input wiring, GameObject lifecycles, and event
  plumbing. Game rules live in `src/logic/**` and are called from the scene.
- Per-scene state is reset in `init`, not in field initializers — scene classes
  are instantiated once but started many times; stale fields from a previous run
  are a classic restart bug.

## Verification

A scene change is verified by booting the game (`bun run dev`) and exercising the
actual transition: start → play → (pause/resume or restart) → confirm no
duplicated listeners (events firing twice after a restart is the canonical
symptom of a missed `SHUTDOWN` cleanup).
