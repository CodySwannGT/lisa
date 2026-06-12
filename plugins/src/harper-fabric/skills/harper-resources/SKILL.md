---
name: harper-resources
description: This skill should be used when writing or editing Harper (HarperDB/Fabric) resources — the classes in resources.js (built from TypeScript under src/) that expose custom data logic over REST and GraphQL. Use it when adding an endpoint, overriding table behavior, wrapping an external API, or wiring real-time subscriptions. Covers the Resource method-to-HTTP mapping and the TS-is-source build convention. Pairs with harper-schema-graphql, harper-config-yaml, and harper-build-and-deploy.
---

# Harper Resources

## Overview

A **Resource** is a class that provides a unified interface for a set of records or
entities. Resources are how you add custom server-side behavior to a Harper app.
They are loaded by the `jsResource` extension (default file `resources.js`) and,
when **exported**, become live REST and GraphQL endpoints.

A resource either **extends a database table** (to customize an existing table's
behavior) or **extends the base `Resource` class** (to expose data from anywhere —
an external API, a computed view, an in-memory source).

## Method → HTTP verb mapping

The Resource API mirrors REST. Override the method matching the operation you want
to customize:

| Method | HTTP | Use |
| --- | --- | --- |
| `get(target)` | GET | Retrieve a record/collection |
| `post(data)` | POST | Create |
| `put(target, data)` | PUT | Replace |
| `patch(target, data)` | PATCH | Partial update |
| `delete(target)` | DELETE | Remove |
| `search(query)` | GET (query) | Query with conditions |
| `subscribe` / `publish` | MQTT/WebSocket | Real-time |

## Extending a table

Add computed fields or guard logic while keeping the table's built-in behavior via
`super`:

```javascript
export class MyTable extends tables.MyTable {
  static async get(target) {
    const record = await super.get(target);
    return { ...record, computedField: 'value' };
  }
}
```

## Wrapping an external source

```javascript
export class MyExternalData extends Resource {
  static async get(target) {
    const response = await fetch(`https://api.example.com/${target.id}`);
    return response.json();
  }
}
```

## Making a resource an endpoint

A resource becomes an endpoint when it is **exported** and `rest: true` (and/or
`graphqlSchema`) is enabled in `config.yaml`:

```yaml
rest: true
graphqlSchema:
  files: schema.graphql
jsResource:
  files: resources.js
```

Resources can also be registered programmatically with `server.resources.set()`.
See [[harper-config-yaml]] for the extension wiring, [[harper-schema-graphql]] for
how the schema defines the tables resources extend, and [[harper-realtime]] when
`subscribe`, `publish`, or WebSocket behavior is part of the feature.

## Project conventions (TS is source)

- **Write resources in TypeScript under `src/`. `harper-app/resources.js` is a
  generated artifact** produced by `bun run build`. Never edit `resources.js` by
  hand — change the TypeScript and rebuild. See [[harper-build-and-deploy]].
- Operational scripts that touch resources (seed, smoke, verify, ingest, crawl,
  extraction) must run from compiled JavaScript or generated Harper assets, not
  stale checked-in JS.
- Prefer immutable data flow: `readonly` types, pure transformations, copies, and
  explicit returns. Do not mutate parameters, records, arrays, or config objects
  unless an API forces it, and document the exception locally.
- Avoid `any`, broad casts, and `ts-ignore`. If an external API forces an escape
  hatch, isolate it behind a typed adapter.

## Build the real thing

If an endpoint needs a schema change, a seed path, or a deploy script change, make
that change — do not ship a client-side workaround or silently downgrade to a stub
or mock. A change is unfinished until the local build and the relevant deployed or
smoke path agree.

## Verification

Run `bun run build`, `bun run typecheck`, and the smallest relevant test. For an
endpoint change, also hit the actual REST/GraphQL route against a local or deployed
Harper instance (the project smoke command) and confirm the response shape.

## Sources

- [Resources overview](https://docs.harperdb.io/reference/v5/resources/overview)
- [Applications](https://docs.harperdb.io/docs/developers/applications)
