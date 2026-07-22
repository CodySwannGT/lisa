# Lisa Console UI (`ui/`) — Architecture and Test Mechanics

Reference knowledge for the Lisa Console UI subsystem, demoted from the eager
rules tier (`.claude/rules/PROJECT_RULES.md`) by gardener ticket #1788: these
are durable, declarative facts that only matter when touching `ui/`,
`src/cli/ui-cmd.ts`, or `tests/e2e/` — the wiki index is the routing surface.

## Overview

The console UI ships as a single hand-written file, `ui/index.html` — there is
no bundler and no `ui/dist`. It is served by the `lisa ui` command via `runUi`
in `src/cli/ui-cmd.ts`.

## Running locally

- The CLI entrypoint is `bun src/index.ts ui` (or `bun dist/index.js ui` after
  build). Do not use `bun src/cli/index.ts ui` — that module has no `main()`.
- After source changes that register new `/api/status` probes, rebuild
  (`bun run build:dist`) or run via the source entrypoint before trusting live
  `dist/` output; a stale `dist/` can silently omit newly added probe modules.

## Build layout: built CLI entry is `dist/index.js`, not `dist/src/...`

`tsconfig.local.json` sets `rootDir: "src"` + `outDir: "dist"`, which flattens
`src/` out of the emitted tree. The CLI entry is `dist/index.js` (also
`bin.lisa` in `package.json`) — **not** `dist/src/cli/index.js`. Verification,
plan, and doctor commands that guess a nested `dist/src/...` path fail. Always
target `dist/index.js`.

## Testing `runUi`: always pass `{ sync: false }`

Pass `sync: false` whenever calling `runUi` from a test. Without it, `runUi`
calls `runConfigSync` and mutates the temp/working directory under test. All
unit and e2e tests use `{ port: "0", sync: false }`.

## Playwright pipeline boundary

`playwright.config.ts` defines **one** global `webServer` on a fixed port
(`UI_TEST_PORT = 4783`) with `baseURL: http://127.0.0.1:4783`. That single
shared server cannot host per-test probe injection. To drive real code with
stubbed edges (e.g. injected probes), a spec must bypass `baseURL`:
`import { runUi }`, launch a per-test server on `port: "0"`, and navigate to
the absolute `http://127.0.0.1:${address.port}` URL, closing the server in a
`finally`. See `tests/e2e/ui-stacks.spec.ts`.

e2e spec files are **not** type-checked by `tsc --noEmit` (root `tsconfig`
`include` is `src/**`, and tests are excluded) and are ESLint-ignored
(`eslint.ignore.config.json` ignores `e2e/**`). Playwright's own TypeScript
pipeline is what typechecks them — do not expect the repo's `lint`/`typecheck`
gates to cover changes made only inside `tests/e2e/`.

## Toggle checkboxes need `dispatchEvent("click")`

The console's toggle controls are an `opacity-0` `<input type="checkbox">`
layered under a styled `.trk`/`span`. Playwright's `.click()` hits the visual
layer and does not fire the input's change handler. Use
`card.getByRole("checkbox").dispatchEvent("click")` — it reliably fires the
handler. Reuse this for every console toggle test. (Web analog of the Maestro
iOS `opacity-0`/`testID` accessibility gaps.)

## `esc()` / `el()` are a text-context escaper and a raw-HTML sink

In `ui/index.html`, `esc(s)` escapes `& < > "` but **not** `'` — it is safe
only for text/element content interpolated into `innerHTML`, not for
attribute-value contexts (which can be broken out of with a single quote).
`el(tag, cls, html)` assigns its third argument straight to `innerHTML`, so it
is a raw-HTML sink: only ever pass it `esc()`-wrapped values or trusted catalog
constants. If you add attribute interpolation, add an attribute-safe escaper
rather than reusing `esc()`.

The single checkable invariant on this page — `runUi` called from tests
without `{ sync: false }` — is a future EXECUTABLE-CONTROL candidate if
violations recur; file it with recurrence evidence rather than re-promoting
this page.
