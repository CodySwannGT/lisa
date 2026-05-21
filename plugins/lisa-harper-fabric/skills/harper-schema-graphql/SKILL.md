---
name: harper-schema-graphql
description: This skill should be used when editing a Harper (HarperDB/Fabric) schema.graphql — defining or changing database tables, types, fields, relationships, or indexes that the graphqlSchema extension turns into Harper tables and API surface. Use it when adding a table, changing the data model, or when a resource/verify path depends on schema shape. Pairs with harper-resources, harper-config-yaml, and harper-component-model.
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
table and control exposure, primary keys, and indexes. The exact directive set
depends on the Harper version in use — confirm against the live `schema.graphql`
in this project and the Harper schema docs before adding new syntax. Common shape:

```graphql
type Dog @table {
  id: ID @primaryKey
  name: String @indexed
  breed: String
  owner: String
}
```

- `@table` marks the type as a persisted Harper table.
- `@primaryKey` marks the primary key field.
- `@indexed` adds a secondary index for query/`search`.
- Exposure of a type as an API endpoint is controlled by the schema/`rest`
  configuration — see [[harper-config-yaml]].

> Treat the directive names above as a starting point, not gospel — verify against
> the project's existing schema and current Harper docs, since directive syntax has
> evolved across versions.

## How the schema drives the app

- The `graphqlSchema` extension creates/migrates tables from the schema on load.
- `rest: true` exposes exported tables/resources as REST endpoints; the GraphQL
  surface is generated from the same schema.
- Resources that `extends tables.X` depend on `X` existing in the schema. A rename
  or removal in the schema is a breaking change for every resource and verify path
  that references it.

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

- [Components overview](https://docs.harperdb.io/reference/v5/components/overview)
- [Applications](https://docs.harperdb.io/docs/developers/applications)
