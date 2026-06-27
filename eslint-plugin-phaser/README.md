# @codyswann/eslint-plugin-phaser

ESLint 9 plugin enforcing Phaser 4 performance and lifecycle invariants that
cannot be expressed as flat `no-restricted-syntax` selectors. It is wired into
the Phaser stack automatically by `@codyswann/lisa/eslint/phaser`; you do not
configure it directly.

## Rules

| Rule | What it catches |
| --- | --- |
| `no-create-in-update` | Creating GameObjects, tweens, timers, or `new Phaser.*` objects inside a Scene `update()` method (per-frame churn). Create in `create()` and pool/reuse. |
| `no-allocation-in-update` | Heap allocations in `update()` — object/array literals, array-iteration chains (`.map`/`.filter`/`.reduce`/`.flatMap`), and `new` collections. Hoist scratch objects; iterate in place. |
| `require-shutdown-cleanup` | A Scene that registers persistent external listeners (`this.input`/`this.scale`/`this.game.events`, `window`/`document`) without a cleanup path. Satisfied by a `shutdown()` method or a `this.events.once('shutdown', ...)` handler. |

All three are scoped to `src/**` game code (relaxed in tests) by the Lisa Phaser
ESLint config. Tests for these rules live in the Lisa repo under
`tests/unit/config/eslint-plugin-phaser/` and run in CI via Vitest + ESLint's
`RuleTester`.
