# Project-Specific Patterns

This document covers patterns specific to this project's NestJS GraphQL implementation, including zero-trust authentication, DataLoader integration, and documentation standards.

## Zero-Trust Auth System

### Auth Architecture

**Zero-Trust Principles:**
- Everything is inaccessible by default (deny-by-default)
- Every operation must explicitly declare auth requirements
- Missing auth declarations throw errors at schema build time

### Auth Levels

| Level | Operation-Level | Field-Level | Description |
|-------|-----------------|-------------|-------------|
| `Public` | Yes | Yes | No authentication required |
| `Authed` | Yes | Yes | Any authenticated user |
| `Owner` | **No** | Yes | Only the resource owner |
| `Groups` | Yes | Yes | Members of specified groups |

**Why Owner doesn't work at operation level:**
At the Query/Mutation level, there is no parent `source` object to check ownership against. Owner auth requires a parent object with an owner field (e.g., `todo.ownerId`) which only exists when resolving nested fields.

### Operation-Level Auth Decorators

```typescript
import { Public, Authed, Groups } from "../auth";

// Public access - no auth required
@Query(() => String, { description: "Public health check" })
@Public()
hello(): string {
  return "Hello World";
}

// Authenticated users only
@Query(() => [Todo], { description: "User's todos" })
@Authed()
async myTodos(@Context() { req }: GraphQLContext): Promise<Todo[]> {
  return this.todoService.findByUser(req.user.id);
}

// Group-based access
@Mutation(() => Boolean, { description: "Admin-only operation" })
@Groups("ADMINS", "MODERATORS")
async deleteAllSpam(): Promise<boolean> {
  return this.spamService.deleteAll();
}
```

### Ownership Checks in Mutations

Since `@Owner` doesn't work at operation level, check ownership in resolver:

```typescript
@Mutation(() => Todo, { description: "Update a todo" })
@Authed()
async updateTodo(
  @Args("id", { type: () => ID }) id: string,
  @Args("input") input: UpdateTodoInput,
  @Context() { req }: GraphQLContext
): Promise<Todo> {
  const todo = await this.todoService.findById(id);

  if (!todo) {
    throw new GraphQLError("Todo not found", {
      extensions: { code: "NOT_FOUND" },
    });
  }

  if (todo.ownerId !== req.user.id) {
    throw new GraphQLError("Not authorized to update this todo", {
      extensions: { code: "UNAUTHORIZED" },
    });
  }

  return this.todoService.update(id, input);
}
```

### Field-Level Auth

For protecting sensitive fields on object types:

```typescript
import { FieldAuth } from "../auth";
import { AuthLevel } from "../auth/auth.types";

@ObjectType()
export class User {
  @Field()
  name: string;

  // Only owner or admins can see email
  @Field()
  @FieldAuth({
    read: [AuthLevel.OWNER, AuthLevel.GROUPS],
    write: [AuthLevel.OWNER],
    groups: ["ADMINS"],
    ownerField: "id",
  })
  email: string;

  // Only owner can see SSN
  @Field()
  @FieldAuth({
    read: [AuthLevel.OWNER],
    write: [AuthLevel.OWNER],
    ownerField: "id",
  })
  ssn: string;
}
```

### Auth Types

```typescript
interface AuthUser {
  readonly id: string;
  readonly sub: string;
  readonly groups?: readonly string[];
  readonly organizationId?: string;
}

interface GraphQLContext {
  readonly req: {
    readonly user?: AuthUser;
  };
  readonly res: Response;
  readonly loaders: IDataLoaders;
}
```

## DataLoader Integration

### Architecture Overview

DataLoader prevents N+1 queries by batching and caching database requests within a single GraphQL request.

**Key Concepts:**
1. **Per-Request Fresh Loaders**: Each GraphQL request gets new DataLoader instances
2. **Batch Loading**: Multiple `.load()` calls are batched together
3. **Order Preservation**: Results return in same order as input keys

### IDataLoaders Interface

```typescript
// src/data-loader/data-loader.interface.ts
import DataLoader from "dataloader";

export interface IDataLoaders {
  readonly usersLoader: DataLoader<string, User | null>;
  readonly postsByAuthorLoader: DataLoader<string, Post[]>;
  readonly commentsLoader: DataLoader<string, Comment[]>;
  // Add new loaders here as needed
}
```

### DataLoaderService

```typescript
// src/data-loader/data-loader.service.ts
import { Injectable } from "@nestjs/common";
import DataLoader from "dataloader";

@Injectable()
export class DataLoaderService {
  constructor(
    private readonly userService: UserService,
    private readonly postService: PostService
  ) {}

  getLoaders(): IDataLoaders {
    return {
      usersLoader: this.createUsersLoader(),
      postsByAuthorLoader: this.createPostsByAuthorLoader(),
    };
  }

  private createUsersLoader(): DataLoader<string, User | null> {
    return new DataLoader<string, User | null>(async (ids) => {
      const users = await this.userService.findByIds([...ids]);
      const userMap = new Map(users.map(u => [u.id, u]));
      return ids.map(id => userMap.get(id) ?? null);
    });
  }

  private createPostsByAuthorLoader(): DataLoader<string, Post[]> {
    return new DataLoader<string, Post[]>(async (authorIds) => {
      const posts = await this.postService.findByAuthorIds([...authorIds]);
      const postMap = new Map<string, Post[]>();

      for (const post of posts) {
        const existing = postMap.get(post.authorId) ?? [];
        postMap.set(post.authorId, [...existing, post]);
      }

      return authorIds.map(id => postMap.get(id) ?? []);
    });
  }
}
```

### Using DataLoader in Resolvers

```typescript
@Resolver(() => Post)
export class PostResolver {
  @ResolveField(() => User, { description: "Post author" })
  async author(
    @Parent() post: Post,
    @Context() { loaders }: GraphQLContext
  ): Promise<User | null> {
    if (!post.authorId) return null;
    return loaders.usersLoader.load(post.authorId);
  }
}

@Resolver(() => User)
export class UserResolver {
  @ResolveField(() => [Post], { description: "User's posts" })
  async posts(
    @Parent() user: User,
    @Context() { loaders }: GraphQLContext
  ): Promise<Post[]> {
    return loaders.postsByAuthorLoader.load(user.id);
  }
}
```

### Adding a New DataLoader

1. Add batch method to service:
   ```typescript
   async findByIds(ids: readonly string[]): Promise<Entity[]> {
     return this.repository.findBy({ id: In([...ids]) });
   }
   ```

2. Add loader type to interface:
   ```typescript
   export interface IDataLoaders {
     readonly entityLoader: DataLoader<string, Entity | null>;
   }
   ```

3. Create loader in service:
   ```typescript
   private createEntityLoader(): DataLoader<string, Entity | null> {
     return new DataLoader(async (ids) => {
       const entities = await this.entityService.findByIds([...ids]);
       const map = new Map(entities.map(e => [e.id, e]));
       return ids.map(id => map.get(id) ?? null);
     });
   }
   ```

4. Add to getLoaders():
   ```typescript
   getLoaders(): IDataLoaders {
     return {
       entityLoader: this.createEntityLoader(),
       // ... other loaders
     };
   }
   ```

5. Use in resolver:
   ```typescript
   @ResolveField(() => Entity, { nullable: true })
   async entity(
     @Parent() parent: Parent,
     @Context() { loaders }: GraphQLContext
   ): Promise<Entity | null> {
     if (!parent.entityId) return null;
     return loaders.entityLoader.load(parent.entityId);
   }
   ```

## GraphQL Documentation Standards

### Documentation Requirements

**Every element must be documented:**
- Types (`@ObjectType`)
- Fields (`@Field`)
- Queries (`@Query`)
- Mutations (`@Mutation`)
- Arguments (`@Args`)
- Input types (`@InputType`)
- Enums (via `registerEnumType`)

### Documentation Pattern

Use both JSDoc (for code) AND `description` option (for introspection):

```typescript
/**
 * A user account in the system.
 *
 * Represents an authenticated user with profile information.
 */
@ObjectType({
  description: "A user account with profile information",
})
export class User {
  /**
   * The user's unique identifier.
   */
  @Field(() => ID, { description: "The user's unique identifier" })
  id: string;

  /**
   * The user's email address.
   *
   * Used for authentication and notifications.
   */
  @Field(() => String, {
    description: "Email address for authentication and notifications",
  })
  email: string;
}
```

### Query/Mutation Documentation

```typescript
/**
 * Retrieves a user by their unique identifier.
 *
 * @param id - The unique identifier of the user
 * @returns The user if found, null otherwise
 */
@Query(() => User, {
  nullable: true,
  description: "Retrieves a user by ID. Returns null if not found.",
})
@Authed()
async user(
  @Args("id", { description: "The unique identifier" }) id: string
): Promise<User | null> {
  return this.userService.findById(id);
}
```

### Enum Documentation

```typescript
export enum OrderStatus {
  PENDING = "PENDING",
  CONFIRMED = "CONFIRMED",
  SHIPPED = "SHIPPED",
  DELIVERED = "DELIVERED",
}

registerEnumType(OrderStatus, {
  name: "OrderStatus",
  description: "Status of an order in the fulfillment pipeline",
  valuesMap: {
    PENDING: { description: "Order received but not yet processed" },
    CONFIRMED: { description: "Order confirmed and payment received" },
    SHIPPED: { description: "Order has been shipped" },
    DELIVERED: { description: "Order delivered to customer" },
  },
});
```

### Description Guidelines

| Element | Guidelines |
|---------|------------|
| **First line** | Complete, concise sentence (imperative for actions) |
| **Constraints** | Document max/min values, valid formats |
| **Nullability** | Explain null vs empty semantics |
| **Units** | Always specify: "Duration in milliseconds" |
| **Defaults** | Document default values: "Default: 20" |
| **Examples** | Include for complex fields: "Example: 2024-01-15" |

### Naming Conventions

| Element | Convention | Example |
|---------|------------|---------|
| Types | PascalCase, singular | `User`, `OrderItem` |
| Fields | camelCase | `firstName`, `orderDate` |
| Arguments | camelCase | `userId`, `pageSize` |
| Enums | PascalCase | `OrderStatus` |
| Enum Values | SCREAMING_SNAKE_CASE | `PENDING`, `IN_PROGRESS` |
| Input Types | PascalCase + `Input` | `CreateUserInput` |
| Mutations | verb + object | `createUser`, `updateOrder` |
| Queries | noun (no verb prefix) | `user` not `getUser` |

### Deprecation

```typescript
@Field(() => String, {
  nullable: true,
  deprecationReason: "Use `primaryEmail` instead. Will be removed in v3.0.",
  description: "The user's email address.",
})
email?: string;
```

## Module Structure

### Feature Module Pattern

```
src/
├── users/
│   ├── users.module.ts      # Module definition
│   ├── users.resolver.ts    # GraphQL resolver
│   ├── users.resolver.test.ts
│   ├── users.service.ts     # Business logic
│   ├── users.service.test.ts
│   ├── dto/
│   │   ├── create-user.input.ts
│   │   └── update-user.input.ts
│   └── entities/
│       └── user.entity.ts   # ObjectType + TypeORM entity
```

### Module Registration

```typescript
// src/users/users.module.ts
@Module({
  providers: [UsersService, UsersResolver],
  exports: [UsersService],
})
export class UsersModule {}

// src/app.module.ts
@Module({
  imports: [
    GraphQLModule.forRootAsync({ /* ... */ }),
    DataLoaderModule,
    UsersModule,
    PostsModule,
  ],
})
export class AppModule {}
```

## Error Handling Patterns

### Standard Error Response

```typescript
import { GraphQLError } from "graphql";

// Not found
throw new GraphQLError("User not found", {
  extensions: { code: "NOT_FOUND", id },
});

// Unauthorized
throw new GraphQLError("Not authorized", {
  extensions: { code: "UNAUTHORIZED" },
});

// Validation
throw new GraphQLError("Invalid email format", {
  extensions: { code: "VALIDATION_ERROR", field: "email" },
});

// Business logic
throw new GraphQLError("Insufficient funds", {
  extensions: { code: "BUSINESS_ERROR", balance: 100, required: 150 },
});
```

### Error Codes

| Code | HTTP Equivalent | Use Case |
|------|-----------------|----------|
| `NOT_FOUND` | 404 | Resource doesn't exist |
| `UNAUTHORIZED` | 401 | Not authenticated |
| `FORBIDDEN` | 403 | Not authorized |
| `VALIDATION_ERROR` | 400 | Invalid input |
| `BUSINESS_ERROR` | 422 | Business rule violation |
| `INTERNAL_ERROR` | 500 | Server error |
