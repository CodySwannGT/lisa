---
name: harper-build-and-deploy
description: "building, running locally, or…"
---

# Harper Build and Deploy

## Overview

The Harper lifecycle is: **develop locally → build TypeScript into the deployable
component → run/iterate → deploy to Fabric**. This skill covers the CLI, the
project's build step, and the deploy surface so a change is provably finished, not
just compiling.

## Local dev and run (the CLI)

The CLI binary is `harper` (v5; older installs use `harperdb`). Key commands:

| Command | What it does |
| --- | --- |
| `harper dev <path/to/app>` | Dev mode: **watches files, single-threaded, auto-restarts worker threads** on change, with console logging. The fast iteration loop. Does **not** restart the main thread. |
| `harper run <path/to/app>` | Run an app from any directory. Use when you need the main thread to (re)start; manage start/stop yourself. |
| `harper start` / `stop` / `restart` | Background (daemon) lifecycle. |
| `harper status` | Harper and clustering status. |
| `harper get_components` | List installed components. |

In this project, dev typically runs against the component dir, e.g.
`harper dev harper-app` (use the project's documented run command if it wraps this).

## The build step (TypeScript -> generated artifacts)

Harper loads JavaScript (`resources.js`) and serves static files (`web/**`). In this
project those are **generated**, not authored.

What the build actually does:

1. Compiles the TypeScript source under `src/` into deployable JavaScript.
2. Emits `harper-app/resources.js`, the aggregate resource module loaded by the
   `jsResource` extension.
3. Emits per-resource modules such as `harper-app/resource-*.js` when the project
   build splits resources for Harper's runtime loader.
4. Copies browser/static output into `harper-app/web/**` for the `static`
   extension to serve.
5. Mirrors shared library output into `harper-app/lib/**` and rewrites imports
   such as `../lib/foo.js` to `./lib/foo.js`. Fabric packages the component root
   as a flat deploy unit, and Node resolves real paths at runtime, so imports must
   point at files that exist inside the packaged `harper-app/` root.
6. Adds cache-busting `?v=` query parameters to browser-module imports when the
   project build owns web asset versioning.

Generated Harper deploy artifacts usually include:

- `harper-app/*.js` — every compiled module the build emits to the harper-app
  root (`resources.js`, `resource-*.js`, and any other output such as a route
  negotiation module). The single-star does **not** cross a directory separator,
  so it does not match hand-written shims one level down.
- `harper-app/web/**`
- `harper-app/lib/**`

The guard surfaces (`generated-artifact-globs.txt` for the PreToolUse block hook,
`.gitignore`, `.prettierignore`, the ESLint/oxlint/knip ignores, and
`tsconfig.eslint.json`) all key off `harper-app/*.js` so a newly-named compiled
module is protected automatically. **Name compiled resource modules
`resource-*.ts`** so their JS output is unambiguously generated.

If you keep a *hand-written* `.js` at the harper-app root (e.g. an SEO shell),
the root-level rule would otherwise treat it as generated: re-include it with a
`!harper-app/<file>.js` line below the managed gitignore block, and add it to
`.lisa/harper-generated-artifact-allowlist.txt` so the block hook lets you edit
it. Hand-written shims nested under `harper-app/<route>/index.js` need no
exemption — the root-level rule never matches them.

Every lint, format, dead-code, search, or generated-artifact guard must ignore
generated paths unless it is explicitly validating the build output itself. When
a new generated *directory* appears, add it to every relevant ignore surface in
the same change; partial ignores fail later gates in non-obvious ways.

- **TypeScript under `src/` is source.** `bun run build` produces the deployable
  Harper assets from it.
- **Never edit generated Harper assets directly** — change the TypeScript and
  rebuild. See [[harper-resources]] and [[harper-component-model]].
- **Build before symlinking, packaging, or deploying `harper-app/`.** Deploying
  stale artifacts ships code that does not match `src/`.

## The deployable surface

A deployable Harper component must keep these at the component root Fabric packages:

- `config.yaml` — active extensions ([[harper-config-yaml]])
- `schema.graphql` — data model ([[harper-schema-graphql]])
- `resources.js` — generated custom logic
- `web/**` — generated static assets

If a change touches this surface, it is not done until the local build and the
relevant deployed or smoke path agree.

## Deploying to Fabric

Fabric is Harper's distributed deploy network. Lisa ships a create-only GitHub
Actions workflow at `.github/workflows/deploy.yml` for Harper/Fabric projects. Use
that workflow as the canonical deployment path for repositories that have adopted
the template: it builds the project, runs `harper deploy_component` against the
configured Fabric target, and then runs the project's smoke verification script.

Required GitHub secrets:

- `CLI_TARGET` or `HARPER_FABRIC_TARGET` — Fabric target URL.
- `CLI_TARGET_USERNAME` — deploy username.
- `CLI_TARGET_PASSWORD` — deploy password.

Optional GitHub variables:

- `HARPER_PROJECT` — Fabric project name; defaults to the repository name.
- `HARPER_PACKAGE` — package path; defaults to `harper-app`.

For local debugging or one-off deploys, the equivalent CLI command packages the
component and sends it to a target instance:

```bash
harper deploy_component \
  project=<app-name> \
  package=<path-or-git-url> \
  target=https://<instance>:9925 \
  username=<user> \
  password=<pass> \
  restart=true \
  replicated=true
```

- Omitting `package` deploys the current directory.
- `restart=true` restarts threads after deploy so new code loads.
- `replicated=true` asks Harper/Fabric to apply the component deploy across the
  cluster rather than only the node receiving the deploy request. Include it when
  targeting Fabric or any clustered deployment.
- Credentials can come from `CLI_TARGET_USERNAME` / `CLI_TARGET_PASSWORD` instead of
  inline flags — prefer that so secrets never land in shell history or tracked files.

## Replication and topology

Fabric is a distributed runtime: a project can run on one or more Harper nodes,
often grouped by region or environment. Your application code is packaged as a
component, and the data layer is replicated through Harper's database and
clustering model.

Keep these semantics separate:

- **Component code replication** is controlled by deploy behavior. With
  `replicated=true`, the deployed component package should reach the cluster nodes
  that serve the application. Without it, you may update only the target node and
  leave other nodes running older code.
- **Data replication** is runtime/database behavior. Deploying code does not by
  itself prove that existing rows, schema changes, caches, or realtime state are
  consistent across regions or nodes.
- **Thread restart** is local process behavior. `restart=true` reloads code after
  the package lands; it is not a substitute for checking every node or region that
  receives traffic.

After a replicated deploy, verify from the topology the app actually uses:

1. Confirm the deploy command or workflow used `replicated=true` for Fabric/cluster
   targets.
2. Read `harper status` or the project's Fabric status command to see the expected
   nodes/regions.
3. Hit the public smoke endpoint through the production route, then hit a direct
   node or region endpoint when the project exposes one.
4. For schema or data changes, verify a write/read path that proves the expected
   data is visible where traffic can land.
5. If one node serves old assets or resources, treat the deploy as incomplete even
   when the initial target node passed smoke.

## Secrets

Keep runtime secrets out of tracked files. Use environment variables, the
`loadEnv` extension, or an OS keychain helper. Document *where* secrets live (which
env var, which store) without recording their values.

## Verification (required before reporting done)

1. `bun run build` — produces fresh `resources.js` / `web/**`.
2. `bun run typecheck`.
3. The smallest relevant test command.
4. For deploy-affecting changes, run the create-only GitHub deploy workflow when
   available, or manually run `harper deploy_component` plus the project **smoke
   command** against the local or deployed Harper endpoint.
5. For public HTTP surfaces, run the create-only ZAP baseline workflow or
   `bash scripts/zap-baseline.sh` with `ZAP_TARGET_URL` set to the deployed app.

If a verification command cannot run, report the exact command and the blocker —
do not claim completion. When you hit a Harper/Fabric limitation or workaround,
record the symptom, root cause, fix, and the tempting-but-broken alternatives in
the project's Fabric runbook.

## Sources

- [Harper CLI overview](https://docs.harperdb.io/reference/v4/cli/overview)
- [Harper CLI](https://docs.harperdb.io/docs/deployments/harper-cli)
- [Plugin API](https://docs.harperdb.io/reference/v5/components/plugin-api)
- [Harper Fabric](https://www.harper.fast/)
