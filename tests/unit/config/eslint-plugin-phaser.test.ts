/**
 * Tests for the custom eslint-plugin-phaser rules and the wired no-restricted
 * selectors in the Phaser ESLint factory. These run in CI via Vitest +
 * ESLint's RuleTester/Linter (the plugin's own __tests__ are NOT picked up by
 * Vitest, so this is the authoritative gate).
 */
import { createRequire } from "node:module";
import { Linter, RuleTester } from "eslint";
import type { Rule } from "eslint";
import { describe, expect, it } from "vitest";

import { getPhaserConfig } from "../../../src/configs/eslint/phaser.js";

const require = createRequire(import.meta.url);
const noCreateInUpdate =
  require("../../../eslint-plugin-phaser/rules/no-create-in-update.js") as Rule.RuleModule;
const noAllocationInUpdate =
  require("../../../eslint-plugin-phaser/rules/no-allocation-in-update.js") as Rule.RuleModule;
const requireShutdownCleanup =
  require("../../../eslint-plugin-phaser/rules/require-shutdown-cleanup.js") as Rule.RuleModule;

const ruleTester = new RuleTester({
  languageOptions: { ecmaVersion: 2022, sourceType: "module" },
});

ruleTester.run("no-create-in-update", noCreateInUpdate, {
  valid: [
    // Creation in create() is fine.
    "class S { create() { this.add.sprite(0, 0, 'k'); } }",
    // No creation in update().
    "class S { update() { this.player.x += 1; } }",
    "class S { update() { this.sprite.setVelocity(100); } }",
    // Creation lives in a callback defined (not directly) in update — out of scope.
    "class S { update() { const cb = () => this.add.sprite(0, 0, 'k'); } }",
    // Non-Phaser new is fine.
    "class S { update() { const v = new MyVector(1, 2); } }",
  ],
  invalid: [
    {
      code: "class S { update() { this.add.sprite(0, 0, 'k'); } }",
      errors: [{ messageId: "createInUpdate" }],
    },
    {
      code: "class S { update() { this.physics.add.sprite(0, 0, 'k'); } }",
      errors: [{ messageId: "createInUpdate" }],
    },
    {
      code: "class S { update() { this.time.delayedCall(100, this.fn); } }",
      errors: [{ messageId: "createInUpdate" }],
    },
    {
      code: "class S { update() { this.make.image({ key: 'k' }); } }",
      errors: [{ messageId: "createInUpdate" }],
    },
    {
      code: "class S { update = () => { this.add.image(0, 0, 'k'); }; }",
      errors: [{ messageId: "createInUpdate" }],
    },
    {
      code: "class S { update() { const r = new Phaser.Geom.Rectangle(0, 0, 1, 1); } }",
      errors: [{ messageId: "newInUpdate" }],
    },
  ],
});

ruleTester.run("no-allocation-in-update", noAllocationInUpdate, {
  valid: [
    "class S { update() { this.x += 1; } }",
    "class S { create() { const o = { a: 1 }; } }",
    "class S { update() { for (let i = 0; i < this.n; i++) { this.tick(i); } } }",
    // Reusing a hoisted scratch object is fine.
    "class S { update() { this.scratch.x = 1; this.scratch.y = 2; } }",
  ],
  invalid: [
    {
      code: "class S { update() { const o = { a: 1 }; } }",
      errors: [{ messageId: "objectLiteral" }],
    },
    {
      code: "class S { update() { const a = [1, 2, 3]; } }",
      errors: [{ messageId: "arrayLiteral" }],
    },
    {
      code: "class S { update() { this.items.map(x => x.y); } }",
      errors: [{ messageId: "arrayMethod" }],
    },
    {
      code: "class S { update() { const m = new Map(); } }",
      errors: [{ messageId: "newCollection" }],
    },
    {
      code: "class S { update() { this.spawn({ x: 1, y: 2 }); } }",
      errors: [{ messageId: "objectLiteral" }],
    },
  ],
});

ruleTester.run("require-shutdown-cleanup", requireShutdownCleanup, {
  valid: [
    // Persistent listener WITH a shutdown method.
    "class S { create() { this.input.on('pointerdown', this.h); } shutdown() { this.input.off('pointerdown', this.h); } }",
    // Persistent listener WITH an in-place shutdown handler.
    "class S { create() { this.input.on('pointerdown', this.h); this.events.once('shutdown', this.cleanup, this); } }",
    // this.events listeners auto-clean — not leaky.
    "class S { create() { this.events.on('update', this.h); } }",
    // No external listeners at all.
    "class S { create() { this.add.sprite(0, 0, 'k'); } }",
  ],
  invalid: [
    {
      code: "class S { create() { this.input.on('pointerdown', this.h); } }",
      errors: [{ messageId: "requireShutdown" }],
    },
    {
      code: "class S { create() { this.scale.on('resize', this.h); } }",
      errors: [{ messageId: "requireShutdown" }],
    },
    {
      code: "class S { create() { this.game.events.on('blur', this.h); } }",
      errors: [{ messageId: "requireShutdown" }],
    },
    {
      code: "class S { create() { window.addEventListener('resize', this.h); } }",
      errors: [{ messageId: "requireShutdown" }],
    },
  ],
});

describe("Phaser factory no-restricted-syntax selectors", () => {
  // Lisa's own CI never executes the Phaser config, so validate the wired
  // selectors here: extract them from the real factory output and run them
  // through a plain Linter (no typed parser needed for these JS snippets).
  const config = getPhaserConfig({ tsconfigRootDir: process.cwd() });
  const gameBlock = config.find(
    c =>
      Array.isArray(c.files) &&
      c.files.includes("src/**/*.ts") &&
      Boolean(c.rules?.["no-restricted-syntax"])
  );
  const restricted = gameBlock?.rules?.["no-restricted-syntax"];

  const lint = (code: string): readonly Linter.LintMessage[] => {
    const linter = new Linter();
    return linter.verify(code, [
      { rules: { "no-restricted-syntax": restricted as Linter.RuleEntry } },
    ]);
  };

  it("wires a no-restricted-syntax entry into the src game block", () => {
    expect(Array.isArray(restricted)).toBe(true);
  });

  it("every selector is valid (Linter does not throw)", () => {
    expect(() => lint("const x = 1;")).not.toThrow();
  });

  it.each([
    ["sprite.setPipeline('x');", /pipeline/i],
    ["Math.random();", /deterministic/i],
    ["Date.now();", /deterministic/i],
    ["performance.now();", /deterministic/i],
    ["new Phaser.Display.BitmapMask(scene);", /BitmapMask/],
    ["const c = { physics: { arcade: { debug: true } } };", /debug/i],
  ])("fires for %s", (code, pattern) => {
    const messages = lint(code);
    expect(messages.some(m => pattern.test(m.message))).toBe(true);
  });
});
