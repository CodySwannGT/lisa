---
name: phaser-testing
description: This skill should be used when writing or designing tests for a Phaser 4 game — unit-testing pure game logic with Vitest, keeping logic Phaser-free so it tests without a browser, the Phaser.HEADLESS renderer for logic-only boots, asset-manifest coverage tests, and Playwright smoke tests that prove the game actually boots and renders. Use it when adding tests, setting up CI verification, or deciding what is testable at which level. Pairs with phaser-project-structure, phaser-assets, and phaser-physics.
---

# Phaser 4 Testing

## Overview

Games are testable when the game is not welded to the engine. The stack's test
pyramid, bottom-up:

1. **Vitest unit tests** over `src/logic/**` — the bulk of coverage.
2. **Manifest/contract tests** — cheap structural checks (asset packs, scene
   keys, anim definitions).
3. **Playwright smoke test** — the game boots in a real browser, renders past
   the Preloader, no console errors.

There is no official Phaser testing harness — this layering IS the strategy.

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
  otherwise ships as a green-square texture ([[phaser-assets]]).
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

## Project conventions

- `bun run test` = Vitest (layers 1–2, coverage-gated). Playwright smoke runs as
  its own script/CI job against a built preview.
- Tests never assert on private scene fields; they assert on logic outputs
  (layer 1) or observable behavior (layer 4).

## Verification

The testing setup itself is verified when `bun run test` passes with coverage
over `src/logic/**`, and the Playwright smoke fails when you deliberately break
boot (rename a pack file) — a smoke test that can't fail is decoration.
