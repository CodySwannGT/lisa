---
name: harper-build-and-deploy
description: This skill should be used when building, running locally, or deploying a Harper (HarperDB/Fabric) component — running harper dev/run, producing the generated resources.js and web/** from TypeScript via the project build, packaging the harper-app component, deploying to Harper Fabric, or handling deploy-time secrets. Use it for any change that affects the deployable surface or the dev loop. Pairs with harper-component-model, harper-config-yaml, and harper-resources.
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

## The build step (TypeScript → generated artifacts)

Harper loads JavaScript (`resources.js`) and serves static files (`web/**`). In this
project those are **generated**, not authored:

- **TypeScript under `src/` is source.** `bun run build` compiles it into
  `harper-app/resources.js` and `harper-app/web/**`.
- **Never edit `resources.js` or `web/**` directly** — change the TypeScript and
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
- `replicated=true` replicates the deploy across all nodes in a cluster — include it
  when targeting Fabric/a cluster.
- Credentials can come from `CLI_TARGET_USERNAME` / `CLI_TARGET_PASSWORD` instead of
  inline flags — prefer that so secrets never land in shell history or tracked files.

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
