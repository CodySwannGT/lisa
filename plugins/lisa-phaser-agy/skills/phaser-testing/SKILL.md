---
name: phaser-testing
description: This skill should be used when writing or designing tests for a Phaser 4 game — unit-testing pure game logic with Vitest, keeping logic Phaser-free so it tests without a browser, the Phaser.HEADLESS renderer for logic-only boots, asset-manifest coverage tests, and the CI runtime gates (boot smoke, allocation/perf budget, leak gate, determinism gate, deterministic Playwright visual regression, bundle-size budget) that verify scenes and entities that are excluded from unit coverage. Use it when adding tests, setting up CI verification, or deciding what is testable at which level. Pairs with phaser-project-structure, the official loading-assets skill, and phaser-services.
---

# Phaser 4 Testing

## Overview

Games are testable when the game is not welded to the engine. The stack's test
pyramid, bottom-up:

1. **Vitest unit tests** over `src/logic/**` — the bulk of coverage.
2. **Manifest/contract tests** — cheap structural checks (asset packs, scene
   keys, anim definitions).
3. **Headless integration** (sparingly) — `Phaser.HEADLESS` for things that
   genuinely need the engine loop.
4. **Playwright smoke** — the game boots in a real browser, renders past the
   Preloader, no console errors.
5. **CI runtime gates** — scenes/entities are excluded from unit coverage and
   instead verified by deterministic runtime gates: boot smoke, allocation/perf
   budget, leak gate, determinism gate, visual regression, bundle-size budget.

There is no official Phaser testing harness — this layering IS the strategy. The
dividing line: pure logic is unit-tested; everything that needs the engine is a
runtime gate, never a brittle unit test that mocks the world.

## Layer 1: pure logic under Vitest (the rule that makes it possible)

`src/logic/**` contains game rules as plain TypeScript with **no `phaser`
imports**: damage calculation, wave spawning schedules, inventory, scoring,
state machines, procedural generation. Scenes call logic; logic never touches
GameObjects.

```ts
// src/logic/score.ts
export function comboMultiplier(streak: number): number { … }

// tests/logic/score.test.ts — plain vitest, node environment, no browser
import { comboMultiplier } from "../../src/logic/score";
it("caps the combo multiplier at 8x", () => {
  expect(comboMultiplier(999)).toBe(8);
});
```

Determinism makes this work for anything random: logic takes a
`Phaser.Math.RandomDataGenerator`-compatible interface (or just a `() => number`)
as a parameter, production passes the seeded RND, tests pass a fixed sequence.

If a piece of "logic" can't be tested without constructing a Scene, that is a
design smell — extract the rule from the scene first, then test it.

## Layer 2: contract tests

Cheap tests that catch the silent runtime failures Phaser is famous for:

- **Asset coverage**: every key constant in `src/assets.ts` appears in
  `public/assets/pack.json` (and optionally vice versa). A missing pack entry
  otherwise ships as a green-square texture (the official `loading-assets` skill).
- **Scene registry**: every `SceneKeys` constant has a scene class registered in
  the game config's `scene` array.
- These are plain Vitest tests reading JSON/TS — no Phaser instance needed.

## Layer 3: booting Phaser in tests (use sparingly)

`Phaser.HEADLESS` (renderer type 3) boots a Game without creating a canvas or
WebGL context — but Phaser still expects DOM-ish globals, so it needs a
browser-like environment (jsdom/happy-dom) and careful teardown
(`game.destroy(true)`). Reserve headless boots for integration tests of things
that genuinely need the engine loop (scene transitions, timer events). Most of
what people reach for headless to test belongs in Layer 1 instead.

## Layer 4: Playwright smoke

The non-negotiable end of the pyramid — proof the game runs:

```ts
test("game boots and renders", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.goto("/");
  const canvas = page.locator("canvas");
  await expect(canvas).toBeVisible();
  // Past the Preloader: poll a window hook the game sets, e.g. in MainMenu.create()
  await page.waitForFunction(() => (window as never as { __sceneReady?: string }).__sceneReady === "MainMenu");
  expect(errors).toEqual([]);
  await expect(page).toHaveScreenshot("boot.png", { maxDiffPixelRatio: 0.02 });
});
```

Convention: scenes set `window.__sceneReady = key` in `create()` (dev/test
builds) so tests await real readiness instead of sleeping. Run against
`bun run dev` (or `vite preview` in CI).

## Layer 5: CI runtime gates (how scenes get verified)

Scenes and entities are deliberately **excluded from unit coverage** — mocking
the engine to "unit test" a scene tests the mock. Instead, CI runs a set of
deterministic gates against a real (or headless) game. Each gate fails the build
on regression; together they are the contract that the engine-coupled layer
keeps working.

**Boot smoke** — the Playwright test above, hardened: page error listener, wait
for `__sceneReady`, assert zero console errors. This is the floor.

**Allocation / perf budget** — run the game for N frames and assert the frame
budget and heap growth. Per-frame allocation is what the `no-allocation-in-update`
and `no-create-in-update` lint rules forbid statically; this gate catches what
slips through dynamically.

```ts
test("steady-state frames stay within budget", async ({ page }) => {
  await page.goto("/"); await bootTo(page, "Game");
  const stats = await page.evaluate(async () => {
    const g = (window as any).__game as Phaser.Game;
    const frames: number[] = []; let last = performance.now();
    for (let i = 0; i < 600; i++) { await new Promise(r => g.events.once("postrender", r)); const n = performance.now(); frames.push(n - last); last = n; }
    return { p95: frames.sort((a,b)=>a-b)[Math.floor(frames.length*0.95)], heap: (performance as any).memory?.usedJSHeapSize };
  });
  expect(stats.p95).toBeLessThan(20); // ~50fps floor on CI hardware
});
```

**Leak gate** — start and stop a scene N times and assert that texture count,
event-listener count, active tweens, and timers all return to baseline. This is
the runtime enforcement of the `require-shutdown-cleanup` rule and the
on/off-discipline in [[phaser-services]].

```ts
test("scene start/stop leaves no leaks", async ({ page }) => {
  await page.goto("/"); await bootTo(page, "MainMenu");
  const before = await page.evaluate(() => (window as any).__game.textures.getTextureKeys().length);
  for (let i = 0; i < 20; i++) await page.evaluate(async () => {
    const g = (window as any).__game as Phaser.Game; g.scene.start("Game");
    await new Promise(r => setTimeout(r, 50)); g.scene.stop("Game");
    await new Promise(r => setTimeout(r, 50));
  });
  const after = await page.evaluate(() => (window as any).__game.textures.getTextureKeys().length);
  expect(after).toBeLessThanOrEqual(before); // no per-cycle texture growth
});
```

**Determinism gate** — boot twice with the same seed, drive the same inputs, and
assert an identical state hash. Logic exposes a serializable snapshot; the gate
hashes it. Same seed → same hash, always. This is the runtime backstop for the
no-`Math.random()`/`Date.now()`/`performance.now()` rules ([[phaser-services]]).

```ts
const run = (seed: number) => page.evaluate(s => (window as any).__sim(s, REPLAY), seed);
expect(hash(await run(1234))).toBe(hash(await run(1234)));
```

**Deterministic visual regression** — `toHaveScreenshot` under **software GL**
(`--use-gl=swiftshader`), a **frozen frame** (pause the loop / step a fixed
number of ticks at a fixed delta), and **masked dynamic regions** (timers,
particles). Without all three, screenshots flake. Pin Playwright's browser and
OS in CI so the baseline is stable.

```ts
await page.evaluate(() => { const g=(window as any).__game; g.loop.sleep(); g.step(0,16.6); });
await expect(page).toHaveScreenshot("game.png", { mask: [page.locator("#timer")], maxDiffPixelRatio: 0.01 });
```

**Bundle-size budget** — assert the built bundle stays under a byte budget so a
stray dependency or an un-split `phaser` chunk fails the PR. Wire it to the prod
build's `manualChunks` split ([[phaser-build-deploy]]).

```jsonc
// size-limit / custom check after `bun run build`
[{ "path": "dist/assets/index-*.js", "limit": "60 kB" },
 { "path": "dist/assets/phaser-*.js", "limit": "400 kB" }]
```

## Project conventions

- `bun run test` = Vitest (layers 1–2, coverage-gated **over `src/logic/**`
  only** — scenes/entities are out of scope here). The layer-5 gates run as their
  own CI jobs against a built `vite preview` (and a headless boot for the
  determinism gate).
- Build pins are part of the contract: `phaser ^4.2.0`, Vite, TypeScript 6.
- Tests never assert on private scene fields; they assert on logic outputs
  (layer 1), observable behavior (layer 4), or the runtime invariants the gates
  measure (layer 5).

## Verification

The testing setup itself is verified when `bun run test` passes with coverage
over `src/logic/**`, the Playwright smoke fails when you deliberately break boot
(rename a pack file), and each layer-5 gate fails on its targeted regression —
leak gate when a listener loses its `.off()`, determinism gate when a
`Math.random()` sneaks in, visual gate when the frame changes. A gate that
can't fail is decoration.
