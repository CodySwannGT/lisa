# Resolvers and Mutations

Comprehensive guide to writing GraphQL resolvers in NestJS.

## Resolver Basics

### Resolver Class Structure

```typescript
import { Args, Context, Mutation, Parent, Query, ResolveField, Resolver } from "@nestjs/graphql";

@Resolver(() => User)
export class UserResolver {
  constructor(
    private readonly userService: UserService,
    private readonly postService: PostService
  ) {}

  // Queries, mutations, and field resolvers go here
}
```

### Resolver Decorator

The `@Resolver()` decorator marks a class as a GraphQL resolver.

```typescript
// Basic resolver (no parent type)
@Resolver()
export class QueryResolver {}

// Resolver with parent type (enables field resolvers)
@Resolver(() => User)
export class UserResolver {}

// Resolver with string type name
@Resolver("User")
export class UserResolver {}
```

## Queries

### Basic Query

```typescript
@Query(() => String, { description: "Returns hello world" })
hello(): string {
  return "Hello World";
}
```

### Query with Arguments

```typescript
@Query(() => User, {
  nullable: true,
  description: "Find user by ID"
})
async user(
  @Args("id", { type: () => ID, description: "User's unique identifier" })
  id: string
): Promise<User | null> {
  return this.userService.findById(id);
}
```

### Query with Multiple Arguments

```typescript
@Query(() => [User], { description: "Search users" })
async users(
  @Args("search", { nullable: true }) search?: string,
  @Args("limit", { type: () => Int, defaultValue: 20 }) limit?: number,
  @Args("offset", { type: () => Int, defaultValue: 0 }) offset?: number
): Promise<User[]> {
  return this.userService.search({ search, limit, offset });
}
```

### Query with Input Type

```typescript
@Query(() => [User], { description: "Find users with filters" })
async users(
  @Args("filter", { nullable: true }) filter?: UserFilterInput
): Promise<User[]> {
  return this.userService.findMany(filter);
}
```

## Mutations

### Basic Mutation

```typescript
@Mutation(() => User, { description: "Create a new user" })
async createUser(
  @Args("input") input: CreateUserInput
): Promise<User> {
  return this.userService.create(input);
}
```

### Mutation with Context

```typescript
@Mutation(() => Post, { description: "Create post for authenticated user" })
@Authed()
async createPost(
  @Args("input") input: CreatePostInput,
  @Context() { req }: GraphQLContext
): Promise<Post> {
  return this.postService.create({
    ...input,
    authorId: req.user.id,
  });
}
```

### Update Mutation

```typescript
@Mutation(() => User, { description: "Update user profile" })
@Authed()
async updateUser(
  @Args("id", { type: () => ID }) id: string,
  @Args("input") input: UpdateUserInput,
  @Context() { req }: GraphQLContext
): Promise<User> {
  // Check ownership
  const user = await this.userService.findById(id);
  if (user.id !== req.user.id) {
    throw new UnauthorizedError("Not authorized to update this user");
  }
  return this.userService.update(id, input);
}
```

### Delete Mutation

```typescript
@Mutation(() => Boolean, { description: "Delete a post" })
@Authed()
async deletePost(
  @Args("id", { type: () => ID }) id: string,
  @Context() { req }: GraphQLContext
): Promise<boolean> {
  const post = await this.postService.findById(id);
  if (post.authorId !== req.user.id) {
    throw new UnauthorizedError("Not authorized to delete this post");
  }
  await this.postService.delete(id);
  return true;
}
```

## Field Resolvers

### Basic Field Resolver

```typescript
@Resolver(() => User)
export class UserResolver {
  @ResolveField(() => String, { description: "User's full name" })
  fullName(@Parent() user: User): string {
    return `${user.firstName} ${user.lastName}`;
  }
}
```

### Field Resolver with DataLoader

```typescript
@ResolveField(() => [Post], { description: "User's posts" })
async posts(
  @Parent() user: User,
  @Context() { loaders }: GraphQLContext
): Promise<Post[]> {
  return loaders.postsByAuthorLoader.load(user.id);
}
```

### Nullable Field Resolver

```typescript
@ResolveField(() => Organization, {
  nullable: true,
  description: "User's organization if any"
})
async organization(
  @Parent() user: User,
  @Context() { loaders }: GraphQLContext
): Promise<Organization | null> {
  if (!user.organizationId) return null;
  return loaders.organizationLoader.load(user.organizationId);
}
```

## Decorator Reference

### @Args()

Extract arguments from the GraphQL query:

```typescript
// Simple argument
@Args("name") name: string

// With type specification (required for non-string primitives)
@Args("count", { type: () => Int }) count: number

// Nullable argument
@Args("search", { nullable: true }) search?: string

// With default value
@Args("limit", { type: () => Int, defaultValue: 20 }) limit: number

// With description
@Args("id", {
  type: () => ID,
  description: "The unique identifier"
}) id: string

// Input type argument
@Args("input") input: CreateUserInput
```

### @Context()

Access the GraphQL context:

```typescript
// Full context
@Context() context: GraphQLContext

// Destructured properties
@Context() { req, res, loaders }: GraphQLContext

// Specific property
@Context("req") req: Request
```

### @Parent()

Access the parent object in field resolvers:

```typescript
@ResolveField(() => String)
fullName(@Parent() user: User): string {
  return `${user.firstName} ${user.lastName}`;
}
```

### @Info()

Access the GraphQL resolve info:

```typescript
import { GraphQLResolveInfo } from "graphql";

@Query(() => User)
async user(
  @Args("id") id: string,
  @Info() info: GraphQLResolveInfo
): Promise<User> {
  // Use info for query optimization, field selection, etc.
  const requestedFields = info.fieldNodes[0].selectionSet;
  return this.userService.findById(id, requestedFields);
}
```

## Return Types

### Nullable Returns

```typescript
// Nullable query result
@Query(() => User, { nullable: true })
async user(@Args("id") id: string): Promise<User | null> {
  return this.userService.findById(id);
}

// Nullable array items
@Query(() => [User], { nullable: "items" })
async users(): Promise<(User | null)[]> { }

// Nullable array itself
@Query(() => [User], { nullable: true })
async users(): Promise<User[] | null> { }

// Both nullable
@Query(() => [User], { nullable: "itemsAndList" })
async users(): Promise<(User | null)[] | null> { }
```

### Complexity

Assign complexity to fields for query cost analysis:

```typescript
@Query(() => [User], { complexity: 10 })
async users(): Promise<User[]> { }

// Dynamic complexity
@Query(() => [User], {
  complexity: (options) => options.args.first * 2
})
async users(@Args("first", { type: () => Int }) first: number): Promise<User[]> { }
```

## GraphQL Context Type

Define a typed context interface:

```typescript
import { IDataLoaders } from "../data-loader/data-loader.interface";
import { AuthUser } from "../auth/auth.types";

interface GraphQLContext {
  readonly req: {
    readonly user?: AuthUser;
  };
  readonly res: Response;
  readonly loaders: IDataLoaders;
}
```

## Error Handling

### Throwing Errors

```typescript
import { GraphQLError } from "graphql";

@Query(() => User)
async user(@Args("id") id: string): Promise<User> {
  const user = await this.userService.findById(id);
  if (!user) {
    throw new GraphQLError("User not found", {
      extensions: { code: "NOT_FOUND" },
    });
  }
  return user;
}
```

### Custom Error Classes

```typescript
class NotFoundError extends GraphQLError {
  constructor(resource: string, id: string) {
    super(`${resource} with ID ${id} not found`, {
      extensions: { code: "NOT_FOUND", resource, id },
    });
  }
}
```

## Best Practices

### 1. Always Add Descriptions

```typescript
@Query(() => User, {
  description: "Retrieves a user by their unique identifier"
})
```

### 2. Use Auth Decorators

Every query and mutation must have an auth decorator:

```typescript
@Query(() => [Post])
@Public() // or @Authed() or @Groups("ADMIN")
async posts(): Promise<Post[]> { }
```

### 3. Use DataLoaders for Relations

```typescript
// Bad: N+1 problem
@ResolveField()
async author(@Parent() post: Post): Promise<User> {
  return this.userService.findById(post.authorId);
}

// Good: Batched loading
@ResolveField()
async author(
  @Parent() post: Post,
  @Context() { loaders }: GraphQLContext
): Promise<User> {
  return loaders.userLoader.load(post.authorId);
}
```

### 4. Validate Input

```typescript
import { IsEmail, MinLength } from "class-validator";

@InputType()
export class CreateUserInput {
  @Field()
  @IsEmail()
  email: string;

  @Field()
  @MinLength(8)
  password: string;
}
```
