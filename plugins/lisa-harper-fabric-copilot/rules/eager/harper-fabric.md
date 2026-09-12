# Harper/Fabric Project Rules (load-bearing)

These rules apply to Harper/Fabric component apps managed by Lisa. The head
below is what changes behaviour in a session that never asks for it; the full
contract — deploy surface, documentation sync, design-system detail — lives in
the reference body.

## Mandatory

1. **Build the real thing.** If a change needs a Harper resource, schema
   update, seed path, or deploy script change, make that change. Do not ship a
   client-side workaround, a stub, or a partial path for missing backend
   behaviour unless the user explicitly asks for a stop-gap.
2. **TypeScript under `src/` is the source.** Every `.js` at the harper-app root
   (`harper-app/*.js`), plus `harper-app/web/**/*.js` and `harper-app/lib/**`,
   is a generated deploy artifact. Never edit one — change the matching
   TypeScript and run `bun run build`.
3. **`harper-app/config.yaml` does not merge with Harper defaults.** Keep every
   required top-level extension declared when editing it.
4. **UI is composed from the project design system.** Extend the design-system
   component first, then consume it through the barrel. No raw colours, no ad
   hoc spacing. Every UI change needs Playwright verification with screenshots —
   typecheck and unit tests are not enough for a visual change.
5. **Immutable data flow.** `readonly` types, pure transformations, `const` over
   `let`. Do not mutate parameters, singletons, fixtures, or config objects. No
   `any`, broad casts, or `ts-ignore` outside a typed adapter.
6. **Verify before reporting completion.** `bun run build`, `bun run typecheck`,
   and the smallest relevant test command; plus the project smoke command for
   deploy-affecting changes. If a command cannot run, report it and the blocker.

Full prose: [reference/harper-fabric.md](../reference/harper-fabric.md).
