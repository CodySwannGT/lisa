# Phaser 4 Project Rules (load-bearing)

This is a **Phaser 4** (npm `phaser@^4.2.0`) TypeScript game project on the
official `template-vite-ts` layout. Phaser 4 is the only supported target —
never introduce Phaser 3 idioms. These decisions are **locked** and most are
**lint-enforced**; do not disable a rule, fix the code.

## Read the official skills first

Phaser ships 28 authoritative agent skills inside the installed package at
`node_modules/phaser/skills/<topic>/SKILL.md` (`scenes`, `physics-arcade`,
`tweens`, `tilemaps`, `v3-to-v4-migration`, …). **For any Phaser API or
subsystem question, read the matching official skill rather than relying on
memory.** The `lisa-phaser` skills deliberately cover only the opinionated,
lint-enforced project layer.

## Mandatory

1. **Thin scenes over a pure-logic core.** All game rules live in `src/logic/**`
   as plain TypeScript with **zero `phaser` imports** — lint-enforced, and it is
   what makes the game unit-testable.
2. **Determinism.** No `Math.random()`, `Date.now()`, or `performance.now()` in
   game code. Use the seeded `Phaser.Math.RND` and the scene clock.
3. **Nothing created or allocated inside `update()`** — no `this.add.*`,
   `tweens.add`, `time.addEvent`, `new Phaser.*`, object/array literals, or
   `map`/`filter`/`reduce` chains. Create in `create()`; pool via `Group`s.
4. **Events and state.** Cross-cutting events go through one dedicated
   `EventsCenter`; **never reuse `game.events`**. Every external `.on()` needs a
   matching `.off()` in the scene's `shutdown`. Global state goes through the
   typed registry wrapper; persistence goes through SaveService, never raw
   `localStorage`.
5. **No raw keys, no placeholder art.** Texture/audio/animation/scene/event keys
   are typed constants generated into `src/assets.ts`. Art must be real and
   licensed per `phaser-asset-sourcing`; procedural `generateTexture`
   placeholders are tracked art debt and need a linked issue.
6. **No hardcoded user-facing strings** — use the typed i18n catalog.
7. **Verify before reporting complete:** `bun run typecheck`, `bun run lint`,
   `bun run test`, `bun run build`. For rendering or input changes, also verify
   in a real browser (`bun run dev` plus a Playwright check). A green typecheck
   alone is not proof a game works.

Full prose — the ten locked architecture decisions, the enforced lint rules, the
performance contract, and the game-development persona subagents:
[reference/phaser.md](../reference/phaser.md).
