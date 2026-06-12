---
name: harper-config-yaml
description: This skill should be used when creating or editing a Harper (HarperDB/Fabric) component's config.yaml — enabling a built-in extension (graphqlSchema, jsResource, rest, static, roles, loadEnv, dataLoader, fastifyRoutes), wiring an external component, or troubleshooting why an extension is not loading. Critical: it documents the no-merge footgun where a custom config.yaml replaces Harper's default config entirely. Pairs with harper-component-model, harper-resources, and harper-schema-graphql.
---

# Harper config.yaml

## Overview

A Harper component is configured by a single `config.yaml` at the component root
(`harper-app/config.yaml` in this project). It declares **which extensions are
active** and which files each extension reads. Extensions are *enabled* here, not
installed — the built-ins ship with Harper.

The structure is a map of extension name to its options:

```yaml
extensionName:
  option-1: value
  option-2: value
```

## ⚠️ The no-merge footgun

If a component has **no** `config.yaml`, Harper applies this default automatically:

```yaml
rest: true
graphqlSchema:
  files: '*.graphql'
roles:
  files: 'roles.yaml'
jsResource:
  files: 'resources.js'
fastifyRoutes:
  files: 'routes/*.js'
  urlPath: '.'
static:
  files: 'web/**'
```

The moment you add a **custom `config.yaml`, it replaces this default entirely —
Harper does not merge your file with the defaults.** If you write a `config.yaml`
that only enables `static`, you have silently turned off `rest`, `graphqlSchema`,
`jsResource`, and `roles`. This is the most common Harper config mistake.

**Rule:** when you add or edit `config.yaml`, re-declare every extension the app
actually needs — start from the default block above and add to it. Do not assume
unmentioned extensions stay on.

## Built-in extensions

| Key | Purpose | Common options |
| --- | --- | --- |
| `rest` | Auto REST endpoints and resource WebSocket subscriptions | `true`, or an object with options such as `webSocket` |
| `graphqlSchema` | Define tables/types from GraphQL files | `files: '*.graphql'` — see [[harper-schema-graphql]] |
| `jsResource` | Load custom JS resources | `files: 'resources.js'` — see [[harper-resources]] |
| `static` | Serve static files over HTTP | `files: 'web/**'`, `urlPath` |
| `roles` | Role-based access control | `files: 'roles.yaml'` |
| `loadEnv` | Load env vars from `.env` | `files` |
| `dataLoader` | Seed tables from JSON/YAML | `files` |
| `fastifyRoutes` | Custom Fastify routes | `files: 'routes/*.js'`, `urlPath` |

For real-time work, component `config.yaml` keeps `rest`, `graphqlSchema`, and
`jsResource` enabled so exported resources can be addressed by HTTP/WebSocket and
MQTT topic paths. Broker ports and MQTT authentication live in the root
`harper-config.yaml`, not the component file. See [[harper-realtime]].

## External components and custom plugins

A component you depend on from npm needs a `package:` directive matching a
`package.json` dependency:

```yaml
'@harperdb/nextjs':
  package: '@harperdb/nextjs'
  files: './'
```

A custom plugin you author is wired with `pluginModule` (point at the built JS, not
TypeScript source):

```yaml
pluginModule: ./dist/index.js
```

The deprecated Extension API used `extensionModule` instead. Prefer `pluginModule`.
See [[harper-component-model]] for the plugin-vs-extension distinction.

## Project conventions

- `config.yaml` is **source** and lives at `harper-app/config.yaml`. It is part of
  the deployable surface Fabric packages — keep it at the component root.
- The files `config.yaml` points to (`resources.js`, `web/**`) are **generated** by
  `bun run build` from TypeScript under `src/`. Editing `config.yaml` to point at a
  new file means the build must produce that file. See [[harper-build-and-deploy]].
- A `config.yaml` change is a deploy-shape change: update the matching project doc
  (the Fabric runbook) in the same change, and re-run the smoke command.
- Keep secrets out of `config.yaml`. Use `loadEnv` / environment variables and
  document *where* secrets live without recording their values.

## Verification

After editing `config.yaml`, confirm the app still boots and the expected surface
is live: run `harper dev harper-app` (or the project's run command) and check that
the REST/GraphQL/static endpoints you rely on respond. A config that silently
dropped an extension often fails only at runtime, not at build time.

## Sources

- [Components overview](https://docs.harperdb.io/reference/v5/components/overview)
- [Built-in extensions](https://docs.harperdb.io/docs/reference/components/built-in-extensions)
