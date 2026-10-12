---
name: harper-config-yaml
description: "This skill should be used when creating or editing a Harper (HarperDB/Fabric) component's config.yaml — enabling a built-in extension (graphqlSchema, jsResource, rest, static, roles, loadEnv, dataLoader, fastifyRoutes), wiring an external component, or troubleshooting why an extension is not loading. Critical: it documents the no-merge footgun where a custom config.yaml replaces Harper's default config entirely. Pairs with harper-component-model, harper-resources, and harper-schema-graphql."
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

## `dataLoader`: seed data

Use `dataLoader` for versioned seed/reference records that should exist whenever
the component is deployed. Define table shape first with `graphqlSchema`, then
point `dataLoader.files` at one or more JSON/YAML files:

```yaml
graphqlSchema:
  files: 'schema.graphql'
dataLoader:
  files:
    - 'data/roles.yaml'
    - 'data/reference/*.json'
```

Each data file targets exactly one table and has `database`, `table`, and
`records` keys:

```yaml
database: app
table: Role
records:
  - id: admin
    name: Administrator
    permissions:
      - users:read
      - users:write
  - id: viewer
    name: Viewer
    permissions:
      - users:read
```

Harper runs the loader on full system starts and component deployments. It is
safe to re-run when files are idempotent: new records are inserted, unchanged
records are skipped, and records are updated from the file only when the tracked
file content changed. User-created records and user edits made after an initial
load are preserved; changed data-loaded records are patched instead of blindly
replaced.

Choose `dataLoader` for small, source-controlled reference/configuration data
that should ship with the component. Use a REST/Operations API script or job for
large imports, environment-specific backfills, or one-off migrations where retry
scope and operator approval matter.

Verify locally:

```bash
harper dev harper-app
curl -s http://localhost:9926/app/Role/admin
harper dev harper-app # restart/redeploy and confirm the seed did not duplicate
```

## `fastifyRoutes`: custom HTTP routes

Prefer `jsResource` plus `rest` for normal CRUD/action APIs. Use `fastifyRoutes`
only when the route shape does not fit the Resource model: webhooks, custom
serialization, unusual path matching, or a compatibility endpoint.

```yaml
rest: true
graphqlSchema:
  files: 'schema.graphql'
jsResource:
  files: 'resources.js'
fastifyRoutes:
  files: 'routes/*.js'
  urlPath: 'hooks'
```

Route modules default-export an async function that receives the Fastify server
and Harper helpers:

```js
export default async (server, { hdbCore, logger }) => {
  server.route({
    method: 'POST',
    url: '/payment/:provider',
    preValidation: hdbCore.preValidation,
    handler: async (request, reply) => {
      logger.debug(`payment webhook ${request.params.provider}`);
      request.body = {
        operation: 'insert',
        schema: 'app',
        table: 'WebhookEvent',
        records: [
          {
            id: request.headers['x-event-id'],
            provider: request.params.provider,
            payload: request.body,
          },
        ],
      };
      const result = await hdbCore.request(request);
      return { ok: true, result };
    },
  });
};
```

Use Fastify's `request.params`, `request.query`, `request.body`, and `request.headers`
for route inputs. Keep auth explicit: `hdbCore.request` should be paired with
`hdbCore.preValidation` so Harper authenticates the request. Avoid
`requestWithoutAuthentication` unless the route has its own signature/JWT check
and all user-provided values are bound or escaped; never build SQL strings by
interpolating params/body values.

Verify locally:

```bash
harper dev harper-app
curl -i -X POST http://localhost:9926/app/hooks/payment/stripe \
  -H 'Authorization: Basic ...' \
  -H 'Content-Type: application/json' \
  -H 'x-event-id: evt_123' \
  --data '{"status":"paid"}'
```

## `static`: serve web assets and SPAs

Use `static` to serve generated browser output or other immutable assets from
the component. In Lisa Harper Fabric projects, `harper-app/web/**` is generated
by the project build; edit the source UI under `src/`, not the deployed files.

```yaml
static:
  files: 'web/**'
  urlPath: '.'
  index: true
```

`files` selects what is served. `urlPath` mounts those files under a URL prefix:
`urlPath: 'app'` makes `web/index.html` available at `/app/index.html`; the
default application path still includes the Harper project/component prefix. Use
`index: true` to serve `index.html` for directory requests, and `extensions:
['html']` when clean URLs should resolve to `.html` files.

For client-side-routed SPAs, return the app shell for unmatched asset paths:

```yaml
static:
  files: 'web/**'
  urlPath: '.'
  index: true
  fallthrough: false
  notFound:
    file: 'web/index.html'
    statusCode: 200
```

That fallback is for browser routes such as `/reports/weekly`; it should not hide
missing API endpoints or broken asset names. Keep API routes under a clear
prefix, and check that hashed JS/CSS assets still return their actual files.

Harper's documented `static` config controls path matching and not-found
behavior, not custom cache policy. Treat MIME type and cache headers as runtime
behavior to verify with `curl -I`; if the app needs precise cache headers,
front it with an edge/proxy policy or a custom route designed for that asset
surface.

Verify locally:

```bash
harper dev harper-app
curl -I http://localhost:9926/app/
curl -I http://localhost:9926/app/assets/index.js
curl -I http://localhost:9926/app/client-side-route
```

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
- [Data Loader](https://docs.harperdb.io/reference/v5/database/data-loader)
- [Fastify Routes](https://docs.harperdb.io/reference/v5/fastify-routes/overview)
- [Static Files](https://docs.harperdb.io/reference/v5/static-files/overview)
