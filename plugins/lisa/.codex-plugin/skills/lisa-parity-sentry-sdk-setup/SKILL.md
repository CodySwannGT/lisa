---
name: lisa-parity-sentry-sdk-setup
description: "Install and configure the…"
allowed-tools: ["Read", "Edit", "Write", "Bash"]
synced-from: sentry@claude-plugins-official@1.2.0
---

# Sentry SDK Setup

Detect a project's framework and runtime, then install and configure the correct
Sentry SDK with sensible, production-ready defaults: client initialization, DSN
via environment variable, error capture, performance/tracing, and source map
upload so stack traces are readable.

## Consolidation note

Upstream `sentry@claude-plugins-official` 1.0.0 shipped **~30 separate per-SDK
setup skills**; this single Lisa-native skill consolidated all of them. As of
upstream **1.2.0** Sentry itself consolidated the suite into one
`sentry-instrument` playbook, so the shapes now match — but this skill remains a
from-scratch reimplementation against Lisa conventions, **not** a translation of
the upstream skill. Pinned to `sentry@claude-plugins-official@1.2.0` via
`synced-from` so the parity drift detector tracks it as one unit.

## Step 0 — Scope the install

Decide what you are actually doing before touching code; default to the
smallest scope (adapted from upstream 1.2.0's scope gate):

- **First error** — no Sentry yet: install the SDK, initialize it for **error
  capture plus tracing** — noting that tracing is **opt-in** in every Sentry
  SDK: it only activates when you set `tracesSampleRate`/`tracesSampler` (and,
  in browsers, add the tracing integration, e.g.
  `browserTracingIntegration()`), exactly as the Step 3 snippets do — then
  verify a real captured event and stop. Do not wire up further signals
  unasked.
- **Add a signal** — Sentry already installed and the user wants one more signal
  (logging, profiling, session replay, metrics, cron check-ins, AI/LLM
  monitoring): skip install/provisioning and configure just that signal per the
  SDK's docs.
- **Full setup** — the user asked for "proper" defaults: do first-error, then
  propose releases + source maps + the signals that fit the app, and add what
  they accept.

**Never over-instrument.** Wiring up every signal upfront produces noise,
quota burn, and config the team doesn't understand.

## Step 1 — Detect framework & runtime

Inspect the project before choosing an SDK. Read `package.json`
(dependencies/scripts), config files, and lockfiles:

- `next` dependency or `next.config.*` → **Next.js**
- `@nestjs/core` → **NestJS**
- `react-native` / `expo` → **React Native / Expo**
- `react` + a bundler (vite/webpack) without Next → **React (browser)**
- `express` / `fastify` / `koa` and a Node entrypoint → **Node server**
- `vue` / `@angular/core` / `svelte` → that browser framework
- `pyproject.toml` / `requirements.txt`; `django`/`flask`/`fastapi` →
  **Python** (and which web framework)
- A plain Node library/CLI → **Node**

If the runtime is genuinely ambiguous, ask which app to instrument rather than
guessing. Respect the project's package manager (bun/npm/pnpm/yarn — match the
lockfile) and module system (ESM vs CJS).

## Step 2 — Install the package

Use the project's package manager. Examples (swap `bun add` for your manager):

| Framework | Package |
| --- | --- |
| React (browser) | `@sentry/react` |
| Next.js | `@sentry/nextjs` |
| Node / Express / Fastify | `@sentry/node` (+ `@sentry/profiling-node` for profiling) |
| NestJS | `@sentry/nestjs` (+ `@sentry/node`) |
| React Native / Expo | `@sentry/react-native` |
| Vue | `@sentry/vue` |
| Angular | `@sentry/angular` |
| Svelte / SvelteKit | `@sentry/svelte` / `@sentry/sveltekit` |
| Python (generic) | `sentry-sdk` |
| Django | `sentry-sdk[django]` |
| Flask | `sentry-sdk[flask]` |
| FastAPI | `sentry-sdk[fastapi]` |

For Next.js, prefer the official wizard when available — it scaffolds the config
files and source-map upload for you:

```bash
npx @sentry/wizard@latest -i nextjs
```

## Step 3 — Initialize the client

Initialize **as early as possible** in the app's lifecycle, before other code
runs. Always read the DSN from the environment (see Step 4) — never hard-code it.

**React (browser)** — `src/instrument.ts`, imported first in the entrypoint:

```ts
import * as Sentry from "@sentry/react";

Sentry.init({
  dsn: import.meta.env.VITE_SENTRY_DSN,
  environment: import.meta.env.MODE,
  integrations: [Sentry.browserTracingIntegration()],
  tracesSampleRate: 0.1, // tune per traffic; 1.0 in dev
});
```

**Node / Express** — `instrument.ts`, required at the very top of the entrypoint
(`import "./instrument";` must be the first import):

```ts
import * as Sentry from "@sentry/node";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV,
  tracesSampleRate: 0.1,
});
```

Then, after routes are defined: `Sentry.setupExpressErrorHandler(app);`

**NestJS** — import `./instrument` first in `main.ts`, then add Sentry's module:

```ts
// main.ts — FIRST line
import "./instrument";
// ...
// app.module.ts
import { SentryModule } from "@sentry/nestjs/setup";
@Module({ imports: [SentryModule.forRoot()] })
export class AppModule {}
```

**Next.js** — config lives in `sentry.client.config.ts`,
`sentry.server.config.ts`, `sentry.edge.config.ts`, and `next.config.js` is
wrapped with `withSentryConfig`. The wizard (Step 2) writes these; verify the DSN
is read from `process.env.NEXT_PUBLIC_SENTRY_DSN` / `process.env.SENTRY_DSN`.

**React Native / Expo** — wrap the root component:

```ts
import * as Sentry from "@sentry/react-native";
Sentry.init({
  dsn: process.env.EXPO_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 0.2,
});
export default Sentry.wrap(App);
```

**Python (Django/Flask/FastAPI/generic)** — initialize at startup
(`settings.py`, app factory, or main module):

```python
import os
import sentry_sdk

sentry_sdk.init(
    dsn=os.environ["SENTRY_DSN"],
    environment=os.environ.get("ENVIRONMENT", "production"),
    traces_sample_rate=0.1,
    send_default_pii=False,
)
```

Framework-specific integrations (e.g. `DjangoIntegration`, `FastApiIntegration`)
are auto-enabled by the matching extra installed in Step 2.

## Step 4 — DSN via environment

- Store the DSN in an environment variable, never in committed source.
- Add it to `.env.example` (with a placeholder) so the requirement is documented,
  but keep the real value in `.env`/secrets and confirm `.env` is gitignored.
- Use the framework's public-env convention for client-side code:
  `NEXT_PUBLIC_SENTRY_DSN` (Next.js), `VITE_SENTRY_DSN` (Vite),
  `EXPO_PUBLIC_SENTRY_DSN` (Expo). Server-only code uses `SENTRY_DSN`.
- For source-map upload (Step 6) the build also needs `SENTRY_AUTH_TOKEN`,
  `SENTRY_ORG`, and `SENTRY_PROJECT` — these are **build/CI** secrets, not
  shipped to the client.

## Step 5 — Error + performance monitoring

- **Errors**: unhandled exceptions/rejections are captured automatically once
  `init` runs; add the framework error handler where required (Express:
  `setupExpressErrorHandler`; React: an error boundary via
  `Sentry.ErrorBoundary`; NestJS: `SentryModule`). Use
  `Sentry.captureException(err)` for caught-but-notable errors.
- **Performance/tracing**: set a `tracesSampleRate` (start ~0.1 in production,
  `1.0` in dev) and enable the framework tracing integration (browser tracing,
  HTTP/DB auto-instrumentation on the server). Optionally add profiling on Node
  via `@sentry/profiling-node` and `profilesSampleRate`.
- Set `environment` and (ideally) `release` so issues are grouped per deploy.

## Step 6 — Source maps (readable stack traces)

Minified/transpiled traces are useless without source maps. Configure upload at
build time:

- **Next.js**: handled by `withSentryConfig` in `next.config.js` (the wizard sets
  it up); ensure `SENTRY_AUTH_TOKEN`/`SENTRY_ORG`/`SENTRY_PROJECT` exist in CI.
- **Vite/Webpack/Rollup/esbuild**: add the Sentry bundler plugin
  (`@sentry/vite-plugin`, `@sentry/webpack-plugin`, etc.) with `sourcemaps`
  upload enabled and the same auth env vars.
- **Node**: build with source maps emitted and upload via
  `sentry-cli sourcemaps upload` (or the bundler plugin) in the release step.
- **React Native**: source maps upload through the Sentry Metro/Gradle/Xcode
  integration added by the SDK's setup.
- Tie uploads to a **release** identifier (commit SHA or version) and inject the
  same release into `Sentry.init({ release })` so traces map to the right build.

## Step 7 — Verify

- Build/typecheck to confirm the SDK wiring compiles:
  `bun run build` / `bun run typecheck` (or the project's equivalents).
- Trigger a deliberate test error in a non-production environment and confirm it
  appears in Sentry with a **readable** (source-mapped) stack trace.
- Confirm a transaction/trace shows up to validate performance monitoring.
- Remove the test error afterward.

## Rules

- **Do not port or copy upstream plugin code** — reimplement from scratch.
- Never hard-code or commit a DSN or `SENTRY_AUTH_TOKEN`; route everything
  through env/secrets and update `.env.example`.
- Match the project's package manager and module system; do not introduce a new
  one to install Sentry.
- Initialize Sentry before any other application code runs.
- Tune sample rates for the environment — do not ship `tracesSampleRate: 1.0` to
  high-traffic production by default.
- Verify with a real captured event and a source-mapped trace before declaring
  setup complete.
