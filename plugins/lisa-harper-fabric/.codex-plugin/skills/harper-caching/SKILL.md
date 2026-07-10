---
name: harper-caching
description: "implementing Harper…"
---

# Harper Caching

## Overview

Harper can use a local table as a durable cache for an external source. The table
stores records, enforces schema/index behavior, exposes normal REST/GraphQL
routes, and calls the source Resource only when a record is missing, expired, or
explicitly invalidated.

Use a caching table when the cached data should survive process restarts,
participate in Harper queries, or stay coherent across Fabric nodes. Do not keep
API responses in a module-level `Map` unless the data is deliberately
process-local, disposable, and not part of the application data model.

Cross-check the table declaration in [[harper-schema-graphql]] and the Resource
method conventions in [[harper-resources]] before editing. If cached records are
queried by filters, sort keys, or relationships, also align indexes and query
shape with [[harper-rest-queries]].

## Declare the cache table

Declare a normal `@table` and expose it with `@export` when callers should reach
the cache over REST or GraphQL. Use the `expiration` argument on `@table` for the
default time-to-live, in seconds:

```graphql
type WeatherSnapshot @table(expiration: 300) @export(name: "weather") {
  locationId: String @primaryKey
  city: String @indexed
  temperatureF: Float
  conditions: String
  sourceUpdatedAt: Long
  fetchedAt: Long
}
```

Guidance:

- Keep the primary key stable and derived from the upstream identity. For an
  external REST API, a normalized URL slug, vendor id, or compound key string is
  usually better than an auto-generated id.
- Index attributes used by cache reads (`city`, `tenantId`, `category`, `status`)
  so callers do not fetch broad collections and filter in JavaScript.
- Store upstream freshness metadata such as `sourceUpdatedAt`, `etag`, or
  `fetchedAt` when verification, debugging, or conditional revalidation needs it.
- Keep TTL at the table level unless the upstream response controls freshness per
  record. Per-record expiration belongs in the source Resource context.

## Wire `sourcedFrom`

Implement a source Resource that fetches the upstream record, then attach it to
the table with `sourcedFrom`. In Lisa template projects, write TypeScript under
`src/` and rebuild the generated Harper assets; do not edit `resources.js` by
hand.

```javascript
export class WeatherApiSource extends Resource {
  static loadAsInstance = false;

  async get(target) {
    const id = target.id;
    const response = await fetch(
      `https://api.example.com/weather/${encodeURIComponent(id)}`,
      {
        headers: { Accept: 'application/json' },
      },
    );

    if (response.status === 404) {
      const error = new Error(`Weather location not found: ${id}`);
      error.statusCode = 404;
      throw error;
    }

    if (!response.ok) {
      const error = new Error(`Weather upstream failed: ${response.status}`);
      error.statusCode = 502;
      throw error;
    }

    const data = await response.json();

    return {
      locationId: id,
      city: data.city,
      temperatureF: data.temperatureF,
      conditions: data.conditions,
      sourceUpdatedAt: Date.parse(data.updatedAt),
      fetchedAt: Date.now(),
    };
  }
}

tables.WeatherSnapshot.sourcedFrom(WeatherApiSource);
```

When a requested record is missing or stale, Harper calls the source `get()` and
caches the returned record in the local table. Concurrent requests for the same
missing or stale record share the same upstream load, which avoids a cache
stampede for a single key.

## TTL and eviction

Use `expiration` for the TTL: after that many seconds, the cached entry is stale
and the next read reloads it from the source. If a project cannot express the
default in schema, `sourcedFrom` can also receive options:

```javascript
tables.WeatherSnapshot.sourcedFrom(WeatherApiSource, {
  expiration: 300,
  eviction: 3600,
  scanInterval: 60,
});
```

Option meanings:

| Option | Use |
| --- | --- |
| `expiration` | Default TTL in seconds before the cached record is stale. |
| `eviction` | Seconds after expiration before Harper may physically remove the record. |
| `scanInterval` | Seconds between scans for expired records. |

Prefer schema directives for stable application behavior because the data model
and default freshness policy stay together. Use `sourcedFrom` options when the
cache attachment is intentionally dynamic or the downstream Harper version lacks
the needed schema directive.

## Conditional revalidation

When the upstream provides `ETag`, `Last-Modified`, or `Cache-Control`, pass that
freshness model through the source Resource instead of overwriting good cached
data with every revalidation.

```javascript
export class WeatherApiSource extends Resource {
  static loadAsInstance = false;

  async get(target) {
    const context = this.getContext();
    const headers = new Headers({ Accept: 'application/json' });

    if (context.replacingVersion) {
      headers.set(
        'If-Modified-Since',
        new Date(context.replacingVersion).toUTCString(),
      );
    }

    const response = await fetch(
      `https://api.example.com/weather/${encodeURIComponent(target.id)}`,
      { headers },
    );

    if (response.status === 304) {
      return context.replacingRecord;
    }

    const maxAge = response.headers
      .get('Cache-Control')
      ?.match(/max-age=(\d+)/)?.[1];

    if (maxAge) {
      context.expiresAt = Date.now() + Number(maxAge) * 1000;
    }

    context.lastModified = response.headers.get('Last-Modified');
    return response.json();
  }
}
```

Use `allowStaleWhileRevalidate(entry, id)` on the cached table when stale data is
acceptable during refresh:

```javascript
export class WeatherSnapshot extends tables.WeatherSnapshot {
  static loadAsInstance = false;

  allowStaleWhileRevalidate(entry, id) {
    return Date.now() - entry.expiresAt < 60_000;
  }
}
```

Return `false` or omit the method when callers must wait for a fresh value.

## Explicit invalidation

Use invalidation when an admin action, webhook, scheduled refresh, or upstream
write makes the cached record stale before its TTL.

```javascript
await tables.WeatherSnapshot.invalidate('nyc');
```

The next `get()` for that id reloads from the source. If the project Harper
version or resource shape does not expose `invalidate()`, use an explicit delete
or overwrite path and document the behavior:

```javascript
await tables.WeatherSnapshot.delete('nyc');
await tables.WeatherSnapshot.get('nyc');
```

For write-through caches, implement `put`, `patch`, or `delete` on the source
Resource only when those operations should update the upstream system. Otherwise,
reject writes or keep cache mutation behind an operator-only Resource so clients
do not accidentally diverge from the source of truth.

## Fabric coherence

In a Fabric deployment, treat every node as capable of serving a read while cache
state is replicating:

- Keep `get()` deterministic and idempotent. A second node may reload the same
  stale key.
- Do not store request-local data, credentials, or tenant state in module-level
  variables. Read identity from Resource context and pass context through when
  calling other resources.
- Pick TTLs that tolerate replication delay. Very short TTLs can turn a cache
  into repeated upstream traffic across nodes.
- After invalidation, verify from the route or node that matters for the caller.
  Cross-node visibility may lag until replication catches up.
- Use Harper storage reclamation settings for disk-pressure eviction tuning, not
  as a substitute for application freshness rules.

## Local verification recipe

Prove both cache fill and cache hit behavior against a running Harper app:

1. Add a temporary upstream counter, fixture server log, or test-only header that
   shows how many times the source Resource fetched the upstream id.
2. Build and boot the app (`bun run build`, then the project Harper dev command).
3. Request the same id twice:

```bash
curl -sS http://localhost:9926/weather/nyc | jq .
curl -sS http://localhost:9926/weather/nyc | jq .
```

4. Confirm the upstream was called once, the second response came from the table,
   and the record contains `fetchedAt` or equivalent freshness evidence.
5. Invalidate or delete the id, request it again, and confirm the upstream count
   increments:

```bash
curl -sS -X DELETE http://localhost:9926/weather/nyc
curl -sS http://localhost:9926/weather/nyc | jq .
```

6. If TTL behavior matters, lower `expiration` in a local-only test fixture,
   wait past the TTL, and verify either blocking refresh or stale-while-revalidate
   behavior matches the Resource implementation.

## Sources

- [Harper v4 Resource API](https://docs.harperdb.io/reference/v4/resources/resource-api)
- [Harper v5 Resources overview](https://docs.harperdb.io/reference/v5/resources/overview)
- [Harper storage tuning](https://docs.harperdb.io/reference/v5/database/storage-tuning)
