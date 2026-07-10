---
name: harper-schema-graphql
description: "editing a Harper (HarperDB/Fabri…"
---

# Harper schema.graphql

## Overview

Harper defines its database tables and types from **GraphQL schema files**, loaded
by the `graphqlSchema` extension (default `*.graphql`; this project uses
`harper-app/schema.graphql`). The schema is the source of truth for the data model:
the tables it declares are what resources extend ([[harper-resources]]) and what
the REST/GraphQL surface exposes.

## Defining tables

A table is a GraphQL type. Harper-specific directives mark a type as a persisted
table and control exposure, primary keys, indexes, audit timestamps, sealed
records, and relationships. Lisa's Harper Fabric template pins `harperdb` to the
Harper 4 line (`^4.7.29`), so use this v4 directive reference for template
projects:

```graphql
type Dog @table @export(name: "dogs") {
  id: Long @primaryKey
  name: String @indexed
  breed: String
  ownerId: Long @indexed
  owner: Owner @relationship(from: ownerId)
  createdAt: Long @createdTime
  updatedAt: Long @updatedTime
}
```

| Directive | Scope | Syntax | Use |
| --- | --- | --- | --- |
| `@table` | Type | `type Product @table { ... }` | Creates a persisted table named after the type. Optional arguments: `table: "products"` to override the table name, `database: "commerce"` to choose a database, `expiration: 3600` for TTL-style records, and `audit: true` to force audit logging. |
| `@export` | Type | `type Product @table @export(name: "products") { ... }` | Exposes the table as a resource endpoint for REST/MQTT and related surfaces. `name` is optional; without it the type name is the path segment. |
| `@sealed` | Type | `type Product @table @sealed { ... }` | Rejects undeclared properties. Omit it when the table intentionally accepts extra record fields. |
| `@primaryKey` | Field | `id: Long @primaryKey` | Marks the unique table key. If omitted on insert, Harper v4 can auto-generate a UUID for `String`/`ID` keys or an auto-incrementing integer for `Int`/`Long`/`Any` keys. Prefer `Long` or `Any` for generated numeric keys. |
| `@indexed` | Field | `sku: String @indexed` | Adds a secondary index used by REST filters, SQL, and NoSQL/search paths. Array fields index each element. For vectors in Harper v4.6+, use `embedding: [Float] @indexed(type: "HNSW")`. |
| `@createdTime` | Field | `createdAt: Long @createdTime` | Writes Unix epoch milliseconds when the record is created. |
| `@updatedTime` | Field | `updatedAt: Long @updatedTime` | Writes Unix epoch milliseconds whenever the record is updated. |
| `@relationship(from: field)` | Field | `owner: Owner @relationship(from: ownerId)` | The foreign key is on this table and references the target table primary key. If the foreign key field is an array, the relationship is many-to-many. |
| `@relationship(to: field)` | Field | `dogs: [Dog] @relationship(to: ownerId)` | The foreign key is on the target table. The relationship field must be an array. |
| `@relationship(from: field, to: field)` | Field | `product: Product @relationship(from: productSku, to: sku)` | Joins this table's field to a non-primary-key field on the target table. Index both join fields. |

Use v5 docs only when the downstream project has intentionally moved off the Lisa
template's Harper 4 dependency; do not mix v5-only syntax into a `harperdb`
`^4.7.29` project.

## How the schema drives the app

- The `graphqlSchema` extension creates/migrates tables from the schema on load.
- `rest: true` exposes exported tables/resources as REST endpoints; the GraphQL
  surface is generated from the same schema.
- Resources that `extends tables.X` depend on `X` existing in the schema. A rename
  or removal in the schema is a breaking change for every resource and verify path
  that references it.

## Schema evolution

Schema changes are deploy-time data-model changes, not just type edits. Harper's
`graphqlSchema` extension ensures declared tables and attributes exist when the
component loads, but it does not perform semantic data migrations such as
renaming tables, copying field values, or rewriting existing rows for you.

Classify each change before editing:

| Change | Compatibility | What Harper does | Required agent work |
| --- | --- | --- | --- |
| Add optional field | Usually safe | Adds the declared attribute shape; existing rows read as missing/`null` until written. | Update resources, seeds, and verification that should include the field. |
| Add required/non-null field | Breaking for existing rows and writers | The schema can declare the field, but existing records do not magically gain valid values. | Backfill first or deploy as optional, populate, then tighten in a later deploy. |
| Add `@indexed` | Usually safe, operationally sensitive | Creates/uses a secondary index for the attribute. Large tables may pay rebuild cost. | Verify filtered REST/search paths and note index build risk in the deploy runbook. |
| Add `@sealed` | Breaking when rows or writers use extra properties | Future writes with undeclared properties are rejected. | Audit current data/writers, declare needed fields, or migrate callers before sealing. |
| Rename field | Breaking | Treated as a new field; the old field and its values are not transformed. | Add the new field, copy values with a migration, update code, verify, then remove old usage. |
| Rename type/table | Breaking | Harper v4 does not rename tables; changing the type name creates a new empty table and leaves the old table/data untouched. | Create the new table, copy data, update resources/routes, verify both read/write paths, then retire the old table intentionally. |
| Change field type | Breaking | Existing stored values are not coerced into the new type in a controlled migration. | Add a replacement field/table, transform data with code, verify, then remove old usage. |
| Remove field/type | Breaking | Schema no longer declares it, but dependent resources, routes, queries, seeds, and clients can still reference it. | Delete references first, run a migration/cleanup if needed, and verify old API paths fail or redirect intentionally. |

Migration recipe for production data:

1. Add the new schema shape in a backward-compatible way: new table or nullable
   replacement field, keeping the old field/table available.
2. Write a one-shot migration using a Harper resource method or Operations
   API/script that reads old rows, transforms values, and writes the new shape.
   Make it idempotent; reruns should skip rows already migrated or compare a
   migration marker.
3. Deploy to one Fabric environment and run the migration before switching
   readers/writers. For replicated Fabric deployments, assume every node may see
   the new code/schema at slightly different times; keep old and new reads
   compatible until replication and smoke checks are green.
4. Update resources, REST/GraphQL queries, data-loader seeds, and verify scripts
   in the same PR. A schema PR is incomplete if `bun run verify` or the project
   smoke path cannot prove the migrated read/write behavior.
5. Roll back by reverting code/schema only when the old field/table remains
   intact. Once cleanup drops old data or callers, rollback needs a reverse
   migration and a restored compatibility path.

## Project conventions

- `schema.graphql` is **source** and lives at the component root that Fabric
  packages (`harper-app/schema.graphql`). Keep it there.
- A schema change is a data-model change. In the **same change**:
  - Update the conceptual schema docs.
  - Update any verify/smoke paths that assert joins, relationships, or row counts —
    those assertions encode the data model and must track it.
  - Update resources and seed/data-loader paths that reference changed tables.
- Document deploy-affecting consequences (new tables, migrations) in the Fabric
  runbook. See [[harper-build-and-deploy]].

## Verification

After a schema change, boot the app (`harper dev harper-app` or the project run
command) and confirm tables migrate cleanly and the dependent endpoints respond.
Run any verify path that asserts row counts or joins against the changed model.

## Sources

- [Harper v4 Schema](https://docs.harperdb.io/reference/v4/database/schema)
- [Components overview](https://docs.harperdb.io/reference/v4/components/overview)
- [Operations API](https://docs.harperdb.io/reference/v4/operations-api/operations)
