---
name: phaser-services
description: This skill should be used when wiring cross-cutting services and shared state in a Phaser 4 game — the typed registry wrapper for global state, a single dedicated EventsCenter bus (never game.events), the .on()/.off() listener discipline enforced in scene shutdown, SoundService (mobile audio unlock on first gesture), InputService (semantic actions instead of raw keys), and SaveService (versioned localStorage with a migration chain). Use it when adding global state, an event bus, audio/input/save plumbing, or fixing listener leaks and lost saves. Pairs with the official scenes skill, phaser-testing, and phaser-i18n.
---

# Phaser 4 Services and Shared State

## Overview

Cross-cutting concerns — global state, app events, sound, input, save — live in
`src/services/**` as thin, typed singletons, **not** scattered through scenes.
Two rules anchor everything: state flows through a typed registry wrapper, and
app messaging flows through **one dedicated EventsCenter** that is never
`game.events`. Direct `localStorage` access outside `src/services/**` is
lint-banned — persistence goes through SaveService.

## Global state: a typed wrapper over the registry

`this.registry` is a game-wide key/value `DataManager` shared across scenes. Raw
access is stringly-typed and untestable, so wrap it once:

```ts
// src/services/state.ts
interface GameState { coins: number; level: number; muted: boolean; seed: number; }
const DEFAULTS: GameState = { coins: 0, level: 1, muted: false, seed: 0 };

export class GameStore {
  constructor(private reg: Phaser.Data.DataManager) {
    for (const k in DEFAULTS) if (!reg.has(k)) reg.set(k, (DEFAULTS as any)[k]);
  }
  get<K extends keyof GameState>(k: K): GameState[K] { return this.reg.get(k); }
  set<K extends keyof GameState>(k: K, v: GameState[K]) { this.reg.set(k, v); }
  onChange<K extends keyof GameState>(k: K, fn: (v: GameState[K]) => void) {
    const h = (_p: unknown, key: string, v: GameState[K]) => { if (key === k) fn(v); };
    this.reg.events.on(Phaser.Data.Events.CHANGE_DATA, h);
    return () => this.reg.events.off(Phaser.Data.Events.CHANGE_DATA, h); // caller .off()s in shutdown
  }
}
```

Construct it once (in Boot) and read it via the registry. Keys are typed by
`GameState`, so a typo is a compile error. The registry holds *small* shared
state (settings, run seed, currency) — not GameObjects and not per-frame data.

## The EventsCenter bus (never `game.events`)

App-level messaging ("enemy-died", "score-changed", "level-cleared") uses a
single dedicated emitter. Reusing `game.events` (the engine's own bus) is
lint-banned — it mixes your events with engine lifecycle events and is
impossible to fully tear down.

```ts
// src/services/event-center.ts
export const EventCenter = new Phaser.Events.EventEmitter();

// typed key constants come from src/assets.ts (generated) — no raw strings
import { GameEvent } from "../assets";
EventCenter.emit(GameEvent.ScoreChanged, score);
```

## Listener discipline: every `.on()` has a matching `.off()`

This is the leak rule the `require-shutdown-cleanup` lint rule and the testing
leak gate ([[phaser-testing]]) enforce. **Any** external listener — `EventCenter`,
`this.input`, `this.scale`, `this.time`, `window`, the registry — must be removed
in the scene's `shutdown`. Listeners on the scene's own display objects die with
the scene; external ones do not, and they fire again (doubled) after a restart.

```ts
export class Game extends Phaser.Scene {
  private cleanups: Array<() => void> = [];

  create() {
    const onResize = (s: Phaser.Structs.Size) => this.layout(s.width, s.height);
    this.scale.on(Phaser.Scale.Events.RESIZE, onResize);
    this.cleanups.push(() => this.scale.off(Phaser.Scale.Events.RESIZE, onResize));

    const onScore = (n: number) => this.hud.setScore(n);
    EventCenter.on(GameEvent.ScoreChanged, onScore);
    this.cleanups.push(() => EventCenter.off(GameEvent.ScoreChanged, onScore));

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.shutdown, this);
  }

  shutdown() { this.cleanups.forEach(fn => fn()); this.cleanups.length = 0; }
}
```

Keeping the matching `.off()` next to each `.on()` (a `cleanups` array, or named
handler methods you remove in `shutdown`) is the pattern that survives the leak
gate. Prefer `.once()` where a listener should fire only once.

## SoundService — audio unlock on first gesture

Web Audio starts **suspended** until a user gesture; sound played before then is
silently dropped ("works on my machine, silent on the phone"). Centralize the
unlock and all playback:

```ts
// src/services/sound-service.ts
export class SoundService {
  private unlocked = false;
  constructor(private sound: Phaser.Sound.BaseSoundManager, private store: GameStore) {}

  attachUnlock(scene: Phaser.Scene) {
    if (this.unlocked) return;
    scene.input.once(Phaser.Input.Events.POINTER_DOWN, () => this.resume());
    // Phaser also fires its own unlock; resume() is idempotent
    this.sound.once(Phaser.Sound.Events.UNLOCKED, () => this.resume());
  }
  private resume() { if ((this.sound as any).context?.state === "suspended") (this.sound as any).context.resume(); this.unlocked = true; }
  play(key: string, cfg?: Phaser.Types.Sound.SoundConfig) { if (!this.store.get("muted")) this.sound.play(key, cfg); }
}
```

Scenes call `soundService.play(Sfx.Jump)` — never `this.sound.play("jump")`.
Sound keys are generated constants ([[phaser-asset-pipeline]]).

## InputService — semantic actions, not raw keys

Scenes should ask "is *jump* down?", not "is the spacebar down?". A semantic
layer makes rebinding, gamepads, and touch swap in without touching game code,
and keeps replays deterministic (record actions, not hardware).

```ts
// src/services/input-service.ts
export type Action = "left" | "right" | "jump" | "fire" | "pause";

export class InputService {
  private down = new Set<Action>();
  private bindings: Record<number, Action> = {};
  constructor(kb: Phaser.Input.Keyboard.KeyboardPlugin) {
    this.bindings[Phaser.Input.Keyboard.KeyCodes.LEFT] = "left";
    this.bindings[Phaser.Input.Keyboard.KeyCodes.SPACE] = "jump";
    kb.on("keydown", (e: KeyboardEvent) => { const a = this.bindings[e.keyCode]; if (a) this.down.add(a); });
    kb.on("keyup",   (e: KeyboardEvent) => { const a = this.bindings[e.keyCode]; if (a) this.down.delete(a); });
  }
  isDown(a: Action) { return this.down.has(a); }
  snapshot(): readonly Action[] { return [...this.down]; } // for replay capture
}
```

`update()` reads `input.isDown("jump")` and forwards the action set to pure logic
in `src/logic/**`. (Register/remove the keyboard listeners with the same on/off
discipline above.)

## SaveService — versioned localStorage with a migration chain

Raw `localStorage` outside `src/services/**` is lint-banned. Saves carry a schema
`VERSION`; on load, unknown-but-older saves run forward through a migration chain,
so an old player's data is never silently lost or crash-loaded.

```ts
// src/services/save-service.ts
const KEY = "save:v"; const VERSION = 3;
interface SaveV3 { version: 3; coins: number; unlocked: string[]; settings: { muted: boolean } }

const migrations: Record<number, (s: any) => any> = {
  1: s => ({ ...s, unlocked: [], version: 2 }),                 // v1 -> v2
  2: s => ({ ...s, settings: { muted: false }, version: 3 }),  // v2 -> v3
};

export class SaveService {
  load(): SaveV3 {
    const raw = localStorage.getItem(KEY);                 // only legal localStorage access lives here
    if (!raw) return this.fresh();
    try {
      let s = JSON.parse(raw);
      while (s.version < VERSION) s = migrations[s.version](s);
      return s as SaveV3;
    } catch { return this.fresh(); }                       // corrupt save -> fresh, never crash
  }
  save(s: SaveV3) { localStorage.setItem(KEY, JSON.stringify({ ...s, version: VERSION })); }
  private fresh(): SaveV3 { return { version: VERSION, coins: 0, unlocked: [], settings: { muted: false } }; }
}
```

Bump `VERSION` and add the `n -> n+1` migration whenever the shape changes; never
mutate the read path to "just handle" an old shape inline.

## Errors and telemetry

A vendor-neutral telemetry/analytics abstraction (`src/services/telemetry.ts`)
exposes `track(event, props)` and `captureError(err, ctx)` behind a stable
interface so the concrete sink (PostHog, Sentry, none) swaps without touching
game code. Wire Phaser's error surfaces to it — `window.onerror`, the loader's
`FILE_LOAD_ERROR`, and `try/catch` around scene transitions all route to
`captureError`. Strings shown to players come from the i18n catalog
([[phaser-i18n]]), never hardcoded.

## Project conventions

- Services live in `src/services/**`; that directory is the **only** place raw
  `localStorage` is permitted.
- One EventsCenter instance, exported once; never `game.events` for app events.
- Every external `.on()` is paired with an `.off()` removed in `shutdown` (lint:
  `require-shutdown-cleanup`; verified by the leak gate in [[phaser-testing]]).
- Service logic that is pure (migrations, action mapping, mute gating) belongs in
  or beside `src/logic/**` so Vitest covers it.

## Verification

Services are verified by the runtime gates: the leak gate ([[phaser-testing]])
proves listeners are removed (start/stop a scene N times, counts return to
baseline); a SaveService unit test feeds each old version through the migration
chain and asserts the current shape; and on a real phone, the first tap unlocks
audio (sound plays) — confirm before committing.
</content>
