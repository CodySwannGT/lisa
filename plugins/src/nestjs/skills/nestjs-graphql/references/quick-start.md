# NestJS GraphQL Quick Start

Reference documentation for setting up and configuring NestJS GraphQL with Apollo.

## Installation

### Core Dependencies

```bash
bun add @nestjs/graphql @nestjs/apollo @apollo/server graphql
```

### Optional Dependencies

```bash
# DataLoader for N+1 prevention
bun add dataloader

# GraphQL tools for schema transformation
bun add @graphql-tools/utils

# Query complexity limiting
bun add graphql-query-complexity
```

## Code-First vs Schema-First

NestJS supports two approaches to building GraphQL APIs:

### Code-First (Recommended)

Define types using TypeScript decorators. The schema is auto-generated.

**Advantages:**
- Type safety between resolvers and schema
- No schema/code synchronization issues
- Refactoring support from IDE
- Single source of truth

```typescript
@ObjectType()
export class User {
  @Field(() => ID)
  id: string;

  @Field()
  email: string;
}
```

### Schema-First

Write `.graphql` schema files, generate TypeScript types.

```graphql
type User {
  id: ID!
  email: String!
}
```

## Module Configuration

### Basic Setup

```typescript
import { ApolloDriver, ApolloDriverConfig } from "@nestjs/apollo";
import { Module } from "@nestjs/common";
import { GraphQLModule } from "@nestjs/graphql";
import { join } from "path";

@Module({
  imports: [
    GraphQLModule.forRoot<ApolloDriverConfig>({
      driver: ApolloDriver,
      autoSchemaFile: join(process.cwd(), "src/schema.gql"),
      sortSchema: true,
    }),
  ],
})
export class AppModule {}
```

### Production Configuration

```typescript
GraphQLModule.forRoot<ApolloDriverConfig>({
  driver: ApolloDriver,
  // In-memory schema for Lambda (no file writes)
  autoSchemaFile: process.env.IS_OFFLINE === "true"
    ? join(process.cwd(), "src/schema.gql")
    : true,
  sortSchema: true,
  playground: false,
  introspection: true, // Enable for API explorers
})
```

### Async Configuration with Dependencies

```typescript
GraphQLModule.forRootAsync<ApolloDriverConfig>({
  driver: ApolloDriver,
  imports: [DataLoaderModule],
  inject: [DataLoaderService],
  useFactory: (dataLoaderService: DataLoaderService) => ({
    autoSchemaFile: true,
    sortSchema: true,
    playground: false,
    introspection: true,
    context: ({ req, res }) => ({
      req,
      res,
      loaders: dataLoaderService.getLoaders(),
    }),
  }),
})
```

## Configuration Options

### autoSchemaFile

Controls where the generated schema is written:

| Value | Behavior |
|-------|----------|
| `true` | In-memory schema (no file) |
| `"path/to/schema.gql"` | Write to file |
| `join(process.cwd(), "src/schema.gql")` | Absolute path |

### sortSchema

When `true`, sorts types and fields alphabetically in generated schema.

### playground

GraphQL Playground is deprecated. Use Apollo Sandbox instead:

```typescript
{
  playground: false,
  plugins: [ApolloServerPluginLandingPageLocalDefault()],
}
```

### introspection

Enable/disable schema introspection queries. Required for API explorers and client codegen.

### context

Function that creates the GraphQL context for each request:

```typescript
context: ({ req, res }) => ({
  req,           // Express request (with user from auth middleware)
  res,           // Express response
  loaders,       // DataLoader instances
  // Add custom context properties
})
```

## NestJS CLI Configuration

### nest-cli.json

```json
{
  "$schema": "https://json.schemastore.org/nest-cli",
  "collection": "@nestjs/schematics",
  "sourceRoot": "src",
  "compilerOptions": {
    "deleteOutDir": true
  }
}
```

### Generating Components

Always use NestJS CLI to generate GraphQL components:

```bash
# Generate module
bunx nest g module users --no-spec

# Generate service
bunx nest g service users --no-spec

# Generate resolver
bunx nest g resolver users --no-spec
```

The `--no-spec` flag skips spec file generation (we write tests first with TDD).

## TypeScript Configuration

Required compiler options for NestJS decorators:

```json
{
  "compilerOptions": {
    "emitDecoratorMetadata": true,
    "experimentalDecorators": true,
    "strictPropertyInitialization": false
  }
}
```

## Schema Transformation

Apply transformations to the generated schema:

```typescript
GraphQLModule.forRoot<ApolloDriverConfig>({
  // ... other options
  transformSchema: (schema) => {
    // Apply auth enforcement
    const withAuth = authExtensionTransformer(schema);
    // Apply field-level auth
    return fieldAuthExtensionTransformer(withAuth);
  },
})
```

## Error Handling

### Custom Error Formatting

```typescript
GraphQLModule.forRoot<ApolloDriverConfig>({
  formatError: (error) => ({
    message: error.message,
    code: error.extensions?.code,
    path: error.path,
    // Omit stack traces in production
    ...(process.env.NODE_ENV !== "production" && {
      locations: error.locations,
    }),
  }),
})
```

## Health Check Integration

GraphQL endpoints should be separate from REST health checks for AWS ALB:

```typescript
// REST health check
@Controller("health")
export class HealthController {
  @Get()
  check() {
    return { status: "ok", timestamp: new Date().toISOString() };
  }
}
```
