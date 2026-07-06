---
name: harper-rest-queries
description: This skill should be used when building or debugging Harper (HarperDB/Fabric) REST collection queries and Resource search methods - filters, FIQL comparison operators, OR/grouping, select, sort, limit/offset pagination, relationship traversal, request context, and transaction boundaries. Use it when adding list endpoints, admin filters, query builders, or multi-write resource methods. Pairs with harper-resources and harper-schema-graphql.
---

# Harper REST Queries

## Overview

Harper exposes exported tables and custom Resources as REST endpoints when
`rest: true` is enabled. Collection `GET` requests use URL query parameters for
filtering, sorting, projection, pagination, and relationship traversal. The same
query shape is available inside Resources through `search(query)` and
`tables.X.search(query)`.

Use Harper's native query surface before hand-filtering records in JavaScript.
Hand-filtering is only acceptable after a selective indexed condition has already
narrowed the candidate set and the behavior cannot be represented by the REST
query language.

Cross-check endpoint ownership and generated resource conventions in
[[harper-resources]]. Cross-check table names, indexes, exported resources, and
relationships in [[harper-schema-graphql]].

## REST collection syntax

REST queries run against collection paths with a trailing slash:

```text
GET /products/?category=software
GET /products/?category=software&active=true
```

Rules:

- Query attributes that appear in conditions should be indexed with `@indexed`.
- Multiple `&` conditions are ANDed.
- `|` combines conditions with OR logic.
- Use square brackets for grouping generated from user input because they encode
  cleanly in URLs.
- Encode reserved characters, especially `:` in dates as `%3A`.

Common condition examples:

```text
GET /products/?category=software
GET /products/?price=gt=100
GET /products/?price=ge=100&price=lt=200
GET /products/?price=gt=100&price=lt=200
GET /products/?name==Keyboard*
GET /products/?rating=5|featured=true
GET /products/?rating=5&[tag=fast|tag=scalable|tag=efficient]
GET /products/?discount=null
GET /products/?listDate=gt=2026-01-05T20%3A07%3A27.955Z
```

## Operators

Harper REST comparison operators use FIQL-style syntax:

| URL operator | Programmatic comparator | Meaning |
| --- | --- | --- |
| `==` | `equals` | Equal with type conversion |
| `=lt=` / `lt=` | `less_than` | Less than |
| `=le=` / `le=` | `less_than_equal` | Less than or equal |
| `=gt=` / `gt=` | `greater_than` | Greater than |
| `=ge=` / `ge=` | `greater_than_equal` | Greater than or equal |
| `=ne=` / `!=` | `not_equal` | Not equal |
| `=ct=` | `contains` | String contains |
| `=sw=` / `==value*` | `starts_with` | String starts with |
| `=ew=` | `ends_with` | String ends with |
| `=` / `===` | strict equality | No automatic URL-value conversion |
| `!==` | strict inequality | No automatic URL-value conversion |

For FIQL comparators, Harper converts strings such as `null`, `true`, numbers,
and schema-typed values before searching. Use explicit prefixes when a generated
URL must control conversion:

```text
GET /products/?price==number:123
GET /products/?active==boolean:true
GET /products/?sku==string:00123
GET /products/?createdAt==date:2026-01-05T20%3A07%3A27.955Z
```

## Select, sort, and pagination

Use query functions for projection, paging, and order:

```text
GET /products/?category=software&select(id,name,price)
GET /products/?category=software&select([id,name])
GET /products/?category=software&limit(20)
GET /products/?category=software&limit(40,60)
GET /products/?category=software&sort(+name)
GET /products/?category=software&sort(+rating,-price)
```

Guidance:

- `select(property)` returns a single property directly.
- `select(property1,property2)` returns objects with those properties.
- `select([property1,property2])` returns arrays of selected property values.
- `limit(end)` returns the first `end` records.
- `limit(start,end)` uses `start` as the offset and returns through `end`.
- Prefix sort fields with `+` for ascending and `-` for descending.
- Prefer sorting on an indexed field used by the primary condition, or a narrow
  result set that can be sorted cheaply.

Programmatic pagination normally uses `limit` and `offset`:

```javascript
const pageSize = 20;
const page = Number(url.searchParams.get('page') ?? 0);

const products = await tables.Products.search({
  conditions: [{ attribute: 'category', value: 'software' }],
  sort: { attribute: 'createdAt', descending: true },
  limit: pageSize,
  offset: page * pageSize,
});
```

## Sort with no conditions crashes the planner

A `search()` that carries a `sort` but an **empty `conditions: []`** array throws
at runtime — the planner cannot seed the btree scan from the sort attribute. This
is a latent `500` the first time an unfiltered, sorted collection page is
requested (verified on harperdb 4.7.32).

```javascript
// ✗ crashes: sort with nothing to seed the scan
tables.Advisor.search({
  conditions: [],
  sort: { attribute: 'lastName' },
});
```

Seed a floor/sentinel condition on the sort attribute so the planner has an index
range to walk, then apply the sort:

```javascript
// ✓ floor condition on the sort attribute seeds the scan
tables.Advisor.search({
  conditions: [
    { attribute: 'lastName', comparator: 'greater_than_equal', value: '' },
  ],
  sort: { attribute: 'lastName' },
});
```

Centralize this in the page helper (`searchPageAndCount`) rather than duplicating
a sentinel at each call site. The `harper-no-empty-conditions-with-sort` ast-grep
rule flags the crashing shape.

## Relationship queries

Relationship attributes can be queried with dot syntax when the relationship is
declared in `schema.graphql` and the foreign key fields are indexed:

```graphql
type Product @table @export(name: "products") {
  id: Long @primaryKey
  name: String
  brandId: Long @indexed
  brand: Brand @relationship(from: brandId)
}

type Brand @table @export(name: "brands") {
  id: Long @primaryKey
  name: String @indexed
  products: [Product] @relationship(to: brandId)
}
```

```text
GET /products/?brand.name=Microsoft
GET /brands/?products.name=Keyboard
GET /products/?brand.name=Microsoft&select(id,name,brand{name})
```

Filtering on a related table behaves like an inner join. Selecting a relationship
without filtering can behave like a left join; missing relationships may be
omitted from returned records. Keep relationship names and directives aligned
with [[harper-schema-graphql]] before changing a route.

## Programmatic search

Use `search(query)` inside custom Resources when the endpoint needs validation,
authorization, response shaping, or side effects around Harper's native query
engine:

```javascript
export class Products extends tables.Products {
  static async search(query, context) {
    const safeQuery = {
      ...query,
      conditions: [
        ...(Array.isArray(query.conditions) ? query.conditions : []),
        { attribute: 'tenantId', value: context.user.tenantId },
      ],
      limit: Math.min(query.limit ?? 50, 100),
    };

    return super.search(safeQuery, context);
  }
}
```

Call table resources directly from other resource methods when you are composing
server-side behavior:

```javascript
const products = await tables.Products.search({
  conditions: [
    { attribute: 'category', value: 'software' },
    { attribute: 'price', comparator: 'less_than', value: 200 },
  ],
  sort: { attribute: 'rating', descending: true },
  limit: 20,
});
```

Useful query keys:

| Key | Use |
| --- | --- |
| `conditions` | Attribute predicates. Use an array for AND-style filters. |
| `sort` | Sort descriptor. Prefer indexed fields for large result sets. |
| `limit` | Maximum records returned. Always cap client-controlled values. |
| `offset` | Pagination offset. Prefer stable sort when offset is used. |
| `select` | Projection list. Keep admin-only fields out of public responses. |
| `explain` | Debug execution order and index usage while tuning. |

`search()` can return an `AsyncIterable`. An early `return`/`break` out of a
`for await (... of tables.X.search(...))` loop abandons the iterator before the
scan completes and **leaks the open read transaction** (verified on
harperdb 4.7.32). When iterating manually or stopping early, drain it or call the
iterator's `return()` in `finally` so Harper releases the read transaction — or
bound the query (`search({ ..., limit: 1 })`) when you only need the first row.
The `harper-no-early-return-in-search-loop` ast-grep rule flags early exits from
these loops:

```javascript
const iterator = tables.Products
  .search({ conditions: [{ attribute: 'status', value: 'active' }] })
  [Symbol.asyncIterator]();

try {
  const first = await iterator.next();
  return first.value;
} finally {
  await iterator.return?.();
}
```

## Context in resource methods

Resource methods may receive request context from Harper's REST runtime. Treat
that context as the authoritative place for user identity, request headers, and
request-scoped metadata supplied by the server:

```javascript
export class Orders extends tables.Orders {
  static async post(data, context) {
    const userId = context.user?.id;
    if (!userId) {
      throw new Error('Authentication required');
    }

    return super.post(
      {
        ...(await data),
        createdBy: userId,
      },
      context,
    );
  }
}
```

When one resource delegates to another, pass the same `context` through. This
keeps authorization, headers/request metadata, and transaction ownership aligned
for nested operations:

```javascript
await tables.OrderEvents.post(
  {
    orderId,
    type: 'created',
  },
  context,
);
```

Do not store `context` in module-level variables. It is request-scoped data and
must not leak between concurrent requests.

## Transactions

Harper databases are transactionally consistent. Tables in the same database can
participate in the same atomic unit of work; separate databases do not preserve
cross-database atomicity.

Resource methods should assume a request-level transaction boundary:

- Reads inside a single request observe a consistent transaction context.
- Writes across tables in the same database commit together when the request
  completes successfully.
- Throwing from the resource method before completion rolls the request work back.
- Nested table/resource operations should receive the same `context` to stay in
  the same request transaction.
- Long-running external calls should happen before writes or after commit-aware
  handoff; do not hold a transaction open while waiting on an avoidable network
  dependency.

Example multi-table write:

```javascript
export class Orders extends tables.Orders {
  static async post(data, context) {
    const order = await super.post(await data, context);

    await tables.OrderEvents.post(
      {
        orderId: order.id,
        type: 'created',
      },
      context,
    );

    return order;
  }
}
```

If `OrderEvents.post()` throws, the order creation should not be reported as
successful. Verify the rollback behavior with an integration test against a real
Harper process when the route writes more than one table.

## Verification recipes

Filtered, sorted, paginated REST query:

```bash
curl -fsS "$BASE_URL/products/?category=software&price=gt=100&sort(-rating)&limit(10)" \
  | jq -e '
      length <= 10 and
      all(.[]; .category == "software" and .price > 100)
    '
```

Projection:

```bash
curl -fsS "$BASE_URL/products/?category=software&select(id,name)" \
  | jq -e 'all(.[]; has("id") and has("name") and (has("cost") | not))'
```

Relationship traversal:

```bash
curl -fsS "$BASE_URL/products/?brand.name=Microsoft&select(id,name,brand{name})" \
  | jq -e 'all(.[]; .brand.name == "Microsoft")'
```

Pagination stability:

```bash
first="$(curl -fsS "$BASE_URL/products/?sort(+createdAt)&limit(0,20)")"
second="$(curl -fsS "$BASE_URL/products/?sort(+createdAt)&limit(20,40)")"
jq -e --argjson a "$first" --argjson b "$second" -n '
  (($a | map(.id)) as $left |
   ($b | map(.id)) as $right |
   (($left + $right) | unique | length) == (($left | length) + ($right | length)))
'
```

Multi-table rollback:

```bash
order_id="rollback-$(date +%s)"

curl -sS -o /tmp/order-response.json -w "%{http_code}" \
  -X POST "$BASE_URL/orders/" \
  -H 'content-type: application/json' \
  --data "{\"id\":\"$order_id\",\"forceEventFailure\":true}" \
  | grep -E '4[0-9][0-9]|5[0-9][0-9]'

curl -fsS "$BASE_URL/orders/$order_id" \
  | jq -e '.error or .message or (.id != "'$order_id'")'
```

For routes with auth rules, add a negative assertion that a user without the
required role cannot filter, select, or sort on restricted data.

## Sources

- [REST overview](https://docs.harperdb.io/reference/v5/rest/overview)
- [REST querying](https://docs.harperdb.io/reference/v5/rest/querying)
- [Resources overview](https://docs.harperdb.io/reference/v5/resources/overview)
- [Query optimization](https://docs.harperdb.io/reference/v5/resources/query-optimization)
- [Database overview](https://docs.harperdb.io/reference/v5/database/overview)
