---
name: harper-component-model
description: This skill should be used when reasoning about how a Harper (formerly HarperDB) Fabric application is structured — what a component, application, extension, or plugin is, where code and assets belong, and how the pieces depend on each other. Use it before adding a new capability, wiring an extension, deciding where a file should live, or explaining the runtime to someone. Pairs with harper-config-yaml, harper-resources, harper-schema-graphql, and harper-build-and-deploy.
---

# Harper Component Model

## Overview

Harper (formerly HarperDB; the product and company now at harper.fast) is an
open-source Node.js platform that fuses **database, cache, application logic, and
messaging into a single in-memory process**. **Fabric** is Harper's distributed
deploy network: you develop locally, then deploy the same component to Fabric.

Everything you build is a **component**. Understanding the component hierarchy is
the prerequisite for every other Harper decision — config, resources, schema, and
deploy all hang off it.

## The three tiers

Harper organizes functionality into three tiers, top to bottom:

1. **Applications** — the user-facing product. An application *is* a type of
   component. It implements business logic (REST/GraphQL endpoints, web UI,
   real-time) by depending on extensions/plugins. This is what this project is.
2. **Plugins** (v5) / **Extensions** (deprecated) — the building blocks an
   application depends on. A plugin exports a single `handleApplication(scope)`
   method and always runs on worker threads. The deprecated Extension API used
   `start`, `handleFile`, `handleDirectory`, and `setupDirectory` instead.
   `handleApplication()` cannot coexist with Extension API methods — defining
   both throws. Prefer the Plugin API for any custom building block.
3. **Core services** — the high-performance database, networking middleware, and
   the component manager. You configure these; you don't reimplement them.

> An *application* is the component you ship. *Extensions/plugins* are the
> capabilities it consumes. Built-in extensions (`graphqlSchema`, `jsResource`,
> `rest`, `static`, …) are provided by core; you only *enable* them in
> `config.yaml`. See [[harper-config-yaml]].

## Built-in extensions an application typically uses

These ship with Harper and are enabled (not installed) via `config.yaml`:

- `graphqlSchema` — define database tables/types from GraphQL schema files. See [[harper-schema-graphql]].
- `jsResource` — load custom JavaScript resources (`resources.js`). See [[harper-resources]].
- `rest` — auto-generate REST endpoints for exported resources/tables.
- `static` — serve static files (the `web/**` directory) over HTTP.
- `roles` — role-based access control from `roles.yaml`.
- `loadEnv` — load environment variables from `.env`.
- `dataLoader` — seed Harper tables from JSON/YAML.
- `fastifyRoutes` — custom Fastify route handlers.

## Where things live in this project

This project wraps Harper's native model with a fixed layout under `harper-app/`:

| Path | Role | Source or generated |
| --- | --- | --- |
| `harper-app/config.yaml` | Component config — which extensions are active | **Source** |
| `harper-app/schema.graphql` | Table/type definitions | **Source** |
| `src/**` (TypeScript) | Resources, browser modules, shared libs, scripts | **Source** |
| `harper-app/resources.js` | Loaded by `jsResource` | **Generated** — never edit; build from TS |
| `harper-app/web/**` | Served by `static` | **Generated** — never edit; build from TS |

The TypeScript under `src/` is the source of truth. `resources.js` and `web/**`
are deploy artifacts produced by `bun run build`. Never hand-edit them — change
the matching TypeScript and rebuild. See [[harper-build-and-deploy]].

## Decision guide

- **Adding a backend behavior?** It's almost always a *resource* (custom logic) or
  a *schema* change (new table/field), enabled through `config.yaml`. Don't ship a
  client-side workaround for missing backend behavior — make the Harper change.
- **Adding a reusable building block / npm-publishable capability?** That's a
  *plugin* (`pluginModule`), not application code.
- **Adding static UI?** It belongs in `web/**` (generated from `src/` UI code), served
  by the `static` extension.
- **Not sure if it deploys?** A deployable Harper app must keep `config.yaml`,
  `schema.graphql`, `resources.js`, and `web/**` at the component root that Fabric
  packages. If your change touches that surface, build before packaging.

## Sources

- [Components overview](https://docs.harperdb.io/reference/v5/components/overview)
- [Plugin API](https://docs.harperdb.io/reference/v5/components/plugin-api)
- [Applications](https://docs.harperdb.io/docs/developers/applications)
- [Harper platform](https://www.harper.fast/)
