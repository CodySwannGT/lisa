# Advanced Features

Guide to field middleware, query complexity, plugins, subscriptions, and extensions.

## Extensions

Extensions allow attaching metadata to GraphQL schema elements.

### @Extensions Decorator

```typescript
import { Extensions, Field, ObjectType } from "@nestjs/graphql";

@ObjectType()
export class User {
  @Field()
  @Extensions({ role: "ADMIN" })
  secretField: string;
}
```

### Accessing Extensions

Extensions are available on field config in schema transformers:

```typescript
import { mapSchema, MapperKind } from "@graphql-tools/utils";

const transformer = (schema: GraphQLSchema) => {
  return mapSchema(schema, {
    [MapperKind.OBJECT_FIELD]: (fieldConfig) => {
      const extensions = fieldConfig.extensions;
      if (extensions?.role === "ADMIN") {
        // Wrap resolver with auth check
      }
      return fieldConfig;
    },
  });
};
```

### Using Extensions for Auth

```typescript
// Decorator
export const AUTH_EXTENSION_KEY = "auth";

export const Public = () =>
  Extensions({ [AUTH_EXTENSION_KEY]: { rules: [{ allow: "public" }] } });

export const Authed = () =>
  Extensions({ [AUTH_EXTENSION_KEY]: { rules: [{ allow: "authed" }] } });

// Usage
@Query(() => String)
@Public()
hello(): string {
  return "Hello World";
}
```

## Field Middleware

Middleware that runs during field resolution.

### Creating Middleware

```typescript
import { FieldMiddleware, MiddlewareContext, NextFn } from "@nestjs/graphql";

export const loggingMiddleware: FieldMiddleware = async (
  ctx: MiddlewareContext,
  next: NextFn
) => {
  const start = Date.now();
  const result = await next();
  const duration = Date.now() - start;
  console.log(`Field ${ctx.info.fieldName} took ${duration}ms`);
  return result;
};
```

### Applying Middleware to Field

```typescript
@ObjectType()
export class User {
  @Field({ middleware: [loggingMiddleware] })
  email: string;
}
```

### Global Middleware

```typescript
GraphQLModule.forRoot<ApolloDriverConfig>({
  buildSchemaOptions: {
    fieldMiddleware: [loggingMiddleware],
  },
})
```

### Middleware Context

```typescript
interface MiddlewareContext<TSource = unknown, TContext = unknown> {
  source: TSource;           // Parent object
  args: Record<string, unknown>; // Field arguments
  context: TContext;         // GraphQL context
  info: GraphQLResolveInfo;  // Resolve info
}
```

### Transform Middleware

```typescript
const upperCaseMiddleware: FieldMiddleware = async (ctx, next) => {
  const value = await next();
  return typeof value === "string" ? value.toUpperCase() : value;
};
```

### Auth Middleware

```typescript
const authMiddleware: FieldMiddleware = async (ctx, next) => {
  const { extensions } = ctx.info.parentType.getFields()[ctx.info.fieldName];

  if (extensions?.auth === "admin") {
    const user = ctx.context.req.user;
    if (!user?.isAdmin) {
      return null; // Hide field
    }
  }

  return next();
};
```

## Query Complexity

Prevent expensive queries from overwhelming the server.

### Installation

```bash
bun add graphql-query-complexity
```

### Complexity Plugin

```typescript
import { Plugin } from "@nestjs/apollo";
import { GraphQLSchemaHost } from "@nestjs/graphql";
import {
  ApolloServerPlugin,
  GraphQLRequestListener,
} from "@apollo/server";
import {
  fieldExtensionsEstimator,
  getComplexity,
  simpleEstimator,
} from "graphql-query-complexity";

@Plugin()
export class ComplexityPlugin implements ApolloServerPlugin {
  constructor(private readonly gqlSchemaHost: GraphQLSchemaHost) {}

  async requestDidStart(): Promise<GraphQLRequestListener<unknown>> {
    const maxComplexity = 100;
    const { schema } = this.gqlSchemaHost;

    return {
      didResolveOperation: async ({ request, document }) => {
        const complexity = getComplexity({
          schema,
          operationName: request.operationName,
          query: document,
          variables: request.variables,
          estimators: [
            fieldExtensionsEstimator(),
            simpleEstimator({ defaultComplexity: 1 }),
          ],
        });

        if (complexity > maxComplexity) {
          throw new Error(
            `Query too complex: ${complexity}. Maximum: ${maxComplexity}`
          );
        }
      },
    };
  }
}
```

### Field-Level Complexity

```typescript
@ObjectType()
export class User {
  // Static complexity
  @Field(() => String, { complexity: 1 })
  name: string;

  // Higher complexity for relations
  @Field(() => [Post], { complexity: 10 })
  posts: Post[];

  // Dynamic complexity based on arguments
  @Field(() => [Post], {
    complexity: (options) => {
      const limit = options.args.limit ?? 20;
      return 1 + limit * 2;
    },
  })
  recentPosts: Post[];

  // Complexity with child multiplication
  @Field(() => [Comment], {
    complexity: (options) => {
      return options.childComplexity * (options.args.first ?? 10);
    },
  })
  comments: Comment[];
}
```

### Complexity Guidelines

| Field Type | Suggested Complexity |
|------------|---------------------|
| Scalar fields | 1 |
| Enum fields | 1 |
| Simple object fields | 2-5 |
| Relation fields (belongsTo) | 5-10 |
| Collection fields (hasMany) | 10-20 |
| Aggregation fields | 5-15 |
| Search/filter fields | 10-30 |

## Plugins

Apollo Server plugins for request lifecycle hooks.

### Creating a Plugin

```typescript
import { Plugin } from "@nestjs/apollo";
import {
  ApolloServerPlugin,
  GraphQLRequestListener,
  GraphQLRequestContext,
} from "@apollo/server";

@Plugin()
export class LoggingPlugin implements ApolloServerPlugin {
  async requestDidStart(
    requestContext: GraphQLRequestContext<unknown>
  ): Promise<GraphQLRequestListener<unknown>> {
    console.log("Request started");

    return {
      async willSendResponse() {
        console.log("Response sent");
      },

      async didEncounterErrors({ errors }) {
        console.log("Errors:", errors);
      },
    };
  }
}
```

### Request Lifecycle Hooks

```typescript
interface GraphQLRequestListener {
  // Before parsing
  parsingDidStart?(): Promise<void>;

  // Before validation
  validationDidStart?(): Promise<void>;

  // After operation resolved
  didResolveOperation?(): Promise<void>;

  // Before response sent
  willSendResponse?(): Promise<void>;

  // On errors
  didEncounterErrors?(): Promise<void>;

  // Before execution
  executionDidStart?(): Promise<void>;
}
```

### Registering Plugins

```typescript
@Module({
  imports: [GraphQLModule.forRoot<ApolloDriverConfig>({ /* ... */ })],
  providers: [LoggingPlugin, ComplexityPlugin],
})
export class AppModule {}
```

### Performance Monitoring Plugin

```typescript
@Plugin()
export class PerformancePlugin implements ApolloServerPlugin {
  async requestDidStart(): Promise<GraphQLRequestListener<unknown>> {
    const start = Date.now();

    return {
      async willSendResponse({ response }) {
        const duration = Date.now() - start;
        response.http.headers.set("X-Response-Time", `${duration}ms`);
      },
    };
  }
}
```

## Subscriptions

Real-time updates via WebSocket.

### Installation

```bash
bun add graphql-subscriptions
```

### PubSub Setup

```typescript
import { PubSub } from "graphql-subscriptions";

// Simple in-memory PubSub (for development only)
export const pubSub = new PubSub();

// For production, use Redis:
// import { RedisPubSub } from "graphql-redis-subscriptions";
// export const pubSub = new RedisPubSub({ /* redis config */ });
```

### Subscription Resolver

```typescript
import { Args, Mutation, Resolver, Subscription } from "@nestjs/graphql";
import { pubSub } from "./pubsub";

const POST_CREATED = "postCreated";

@Resolver(() => Post)
export class PostResolver {
  @Mutation(() => Post)
  async createPost(@Args("input") input: CreatePostInput): Promise<Post> {
    const post = await this.postService.create(input);
    pubSub.publish(POST_CREATED, { postCreated: post });
    return post;
  }

  @Subscription(() => Post, {
    description: "Subscribe to new posts",
  })
  postCreated() {
    return pubSub.asyncIterator(POST_CREATED);
  }
}
```

### Filtered Subscriptions

```typescript
@Subscription(() => Post, {
  filter: (payload, variables) => {
    return payload.postCreated.authorId === variables.authorId;
  },
})
postCreated(@Args("authorId") authorId: string) {
  return pubSub.asyncIterator(POST_CREATED);
}
```

### Subscription with Resolver

```typescript
@Subscription(() => Post, {
  resolve: (payload) => {
    // Transform the payload before sending
    return {
      ...payload.postCreated,
      isNew: true,
    };
  },
})
postCreated() {
  return pubSub.asyncIterator(POST_CREATED);
}
```

### Module Configuration for Subscriptions

```typescript
GraphQLModule.forRoot<ApolloDriverConfig>({
  driver: ApolloDriver,
  autoSchemaFile: true,
  subscriptions: {
    "graphql-ws": true, // Modern WebSocket protocol
    "subscriptions-transport-ws": true, // Legacy protocol (deprecated)
  },
  context: ({ req, connection }) => {
    // HTTP request
    if (req) {
      return { req };
    }
    // WebSocket connection
    if (connection) {
      return { user: connection.context.user };
    }
  },
})
```

### Subscription Authentication

```typescript
GraphQLModule.forRoot<ApolloDriverConfig>({
  subscriptions: {
    "graphql-ws": {
      onConnect: (context) => {
        const { connectionParams } = context;
        const token = connectionParams?.authorization;

        if (!token) {
          throw new Error("Missing auth token");
        }

        // Validate token and return user
        const user = validateToken(token);
        return { user };
      },
    },
  },
})
```

## Schema Transformation

Transform the generated schema before use.

### Using transformSchema

```typescript
GraphQLModule.forRoot<ApolloDriverConfig>({
  transformSchema: (schema) => {
    return mapSchema(schema, {
      [MapperKind.OBJECT_FIELD]: (fieldConfig, fieldName, typeName) => {
        // Transform field config
        return fieldConfig;
      },
    });
  },
})
```

### Combining Transformers

```typescript
const combinedTransformer = (schema: GraphQLSchema): GraphQLSchema => {
  const withAuth = authTransformer(schema);
  const withLogging = loggingTransformer(withAuth);
  return withLogging;
};

GraphQLModule.forRoot<ApolloDriverConfig>({
  transformSchema: combinedTransformer,
})
```

## Directives

Custom schema directives (schema-first approach).

### Defining Directive

```typescript
import { Directive, Field, ObjectType } from "@nestjs/graphql";

@Directive("@upper")
@ObjectType()
export class User {
  @Directive("@deprecated(reason: \"Use name instead\")")
  @Field()
  firstName: string;
}
```

### Registering Directive Transformer

```typescript
import { mapSchema, getDirective, MapperKind } from "@graphql-tools/utils";

function upperDirectiveTransformer(schema: GraphQLSchema) {
  return mapSchema(schema, {
    [MapperKind.OBJECT_FIELD]: (fieldConfig) => {
      const upperDirective = getDirective(schema, fieldConfig, "upper")?.[0];

      if (upperDirective) {
        const { resolve = defaultFieldResolver } = fieldConfig;
        fieldConfig.resolve = async (source, args, context, info) => {
          const result = await resolve(source, args, context, info);
          return typeof result === "string" ? result.toUpperCase() : result;
        };
      }

      return fieldConfig;
    },
  });
}
```

**Note:** For code-first approach, prefer using `@Extensions()` decorator over directives. Extensions are simpler to implement and don't require SDL directive definitions.
