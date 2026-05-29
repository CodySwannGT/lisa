# Types and Scalars

Guide to defining GraphQL types, scalars, enums, interfaces, and unions in NestJS.

## Object Types

### Basic Object Type

```typescript
import { Field, ID, ObjectType } from "@nestjs/graphql";

@ObjectType({ description: "A user account in the system" })
export class User {
  @Field(() => ID, { description: "Unique identifier" })
  id: string;

  @Field(() => String, { description: "Email address" })
  email: string;

  @Field(() => String, { nullable: true, description: "Display name" })
  displayName?: string;

  @Field(() => Boolean, { description: "Whether email is verified" })
  isVerified: boolean;

  @Field(() => Date, { description: "Account creation date" })
  createdAt: Date;
}
```

### Object Type with Relations

```typescript
@ObjectType({ description: "A blog post" })
export class Post {
  @Field(() => ID)
  id: string;

  @Field(() => String)
  title: string;

  @Field(() => User, { description: "Post author" })
  author: User;

  @Field(() => [Comment], { description: "Post comments" })
  comments: Comment[];
}
```

## Input Types

### Basic Input Type

```typescript
import { Field, InputType } from "@nestjs/graphql";

@InputType({ description: "Input for creating a user" })
export class CreateUserInput {
  @Field(() => String, { description: "User's email" })
  email: string;

  @Field(() => String, { description: "User's password" })
  password: string;

  @Field(() => String, { nullable: true, description: "Optional display name" })
  displayName?: string;
}
```

### Update Input Type

```typescript
@InputType({ description: "Input for updating a user" })
export class UpdateUserInput {
  @Field(() => String, { nullable: true })
  displayName?: string;

  @Field(() => String, { nullable: true })
  avatarUrl?: string;
}
```

## Mapped Types

NestJS provides utility functions to create derived types from existing ones.

### PartialType

Makes all fields optional:

```typescript
import { PartialType } from "@nestjs/graphql";

@InputType()
export class UpdateUserInput extends PartialType(CreateUserInput) {}
```

### PickType

Select specific fields:

```typescript
import { PickType } from "@nestjs/graphql";

@InputType()
export class UpdateEmailInput extends PickType(CreateUserInput, ["email"] as const) {}
```

### OmitType

Exclude specific fields:

```typescript
import { OmitType } from "@nestjs/graphql";

@InputType()
export class UpdateUserInput extends OmitType(CreateUserInput, ["password"] as const) {}
```

### IntersectionType

Combine multiple types:

```typescript
import { IntersectionType } from "@nestjs/graphql";

@InputType()
export class CreateUserWithPrefsInput extends IntersectionType(
  CreateUserInput,
  UserPreferencesInput
) {}
```

### Composition

Combine multiple utilities:

```typescript
@InputType()
export class UpdateUserInput extends PartialType(
  OmitType(CreateUserInput, ["password"] as const)
) {}
```

## Enums

### Defining Enums

```typescript
import { registerEnumType } from "@nestjs/graphql";

export enum UserRole {
  ADMIN = "ADMIN",
  MODERATOR = "MODERATOR",
  USER = "USER",
}

registerEnumType(UserRole, {
  name: "UserRole",
  description: "Available user roles in the system",
  valuesMap: {
    ADMIN: { description: "Full system access" },
    MODERATOR: { description: "Content moderation access" },
    USER: { description: "Standard user access" },
  },
});
```

### Using Enums in Types

```typescript
@ObjectType()
export class User {
  @Field(() => UserRole, { description: "User's role" })
  role: UserRole;
}

@InputType()
export class CreateUserInput {
  @Field(() => UserRole, { defaultValue: UserRole.USER })
  role: UserRole;
}
```

## Interfaces

### Defining Interfaces

```typescript
import { Field, ID, InterfaceType } from "@nestjs/graphql";

@InterfaceType({ description: "Base interface for all nodes" })
export abstract class Node {
  @Field(() => ID)
  id: string;
}
```

### Implementing Interfaces

```typescript
@ObjectType({ implements: () => [Node] })
export class User extends Node {
  @Field(() => String)
  email: string;
}

@ObjectType({ implements: () => [Node] })
export class Post extends Node {
  @Field(() => String)
  title: string;
}
```

### Resolving Interface Types

```typescript
@InterfaceType({
  resolveType: (value) => {
    if ("email" in value) return User;
    if ("title" in value) return Post;
    return null;
  },
})
export abstract class Node {
  @Field(() => ID)
  id: string;
}
```

## Unions

### Defining Unions

```typescript
import { createUnionType } from "@nestjs/graphql";

export const SearchResult = createUnionType({
  name: "SearchResult",
  description: "Possible search result types",
  types: () => [User, Post, Comment] as const,
  resolveType: (value) => {
    if ("email" in value) return User;
    if ("title" in value) return Post;
    if ("body" in value) return Comment;
    return null;
  },
});
```

### Using Unions

```typescript
@Query(() => [SearchResult], { description: "Search across all content" })
async search(@Args("query") query: string): Promise<typeof SearchResult[]> {
  const users = await this.userService.search(query);
  const posts = await this.postService.search(query);
  return [...users, ...posts];
}
```

## Custom Scalars

### Built-in Scalars

NestJS/GraphQL includes these scalars by default:
- `ID` - Unique identifier
- `String` - UTF-8 string
- `Boolean` - true/false
- `Int` - 32-bit integer
- `Float` - Double-precision float

### Date Scalar

```typescript
import { Scalar, CustomScalar } from "@nestjs/graphql";
import { Kind, ValueNode } from "graphql";

@Scalar("Date", () => Date)
export class DateScalar implements CustomScalar<number, Date> {
  description = "Date custom scalar type";

  parseValue(value: number): Date {
    return new Date(value);
  }

  serialize(value: Date): number {
    return value.getTime();
  }

  parseLiteral(ast: ValueNode): Date {
    if (ast.kind === Kind.INT) {
      return new Date(parseInt(ast.value, 10));
    }
    return null;
  }
}
```

### JSON Scalar

```typescript
import { Scalar, CustomScalar } from "@nestjs/graphql";
import { Kind, ValueNode } from "graphql";

@Scalar("JSON")
export class JSONScalar implements CustomScalar<string, object> {
  description = "JSON custom scalar type";

  parseValue(value: string): object {
    return JSON.parse(value);
  }

  serialize(value: object): string {
    return JSON.stringify(value);
  }

  parseLiteral(ast: ValueNode): object {
    if (ast.kind === Kind.STRING) {
      return JSON.parse(ast.value);
    }
    return null;
  }
}
```

### Registering Scalars

```typescript
@Module({
  providers: [DateScalar, JSONScalar],
})
export class CommonModule {}
```

### Using graphql-scalars Library

```typescript
import { GraphQLDateTime, GraphQLJSON } from "graphql-scalars";

GraphQLModule.forRoot<ApolloDriverConfig>({
  resolvers: {
    DateTime: GraphQLDateTime,
    JSON: GraphQLJSON,
  },
})
```

## Field Options

### Common Field Options

```typescript
@Field(() => String, {
  // Description shown in schema
  description: "User's email address",

  // Allow null values
  nullable: true,

  // Deprecation notice
  deprecationReason: "Use `primaryEmail` instead",

  // Query complexity cost
  complexity: 1,

  // Default value for input fields
  defaultValue: "default",

  // Custom name in schema
  name: "emailAddress",
})
email: string;
```

### Array Fields

```typescript
// Non-nullable array with non-nullable items: [String!]!
@Field(() => [String])
tags: string[];

// Nullable array items: [String]!
@Field(() => [String], { nullable: "items" })
tags: (string | null)[];

// Nullable array: [String!]
@Field(() => [String], { nullable: true })
tags?: string[];

// Both nullable: [String]
@Field(() => [String], { nullable: "itemsAndList" })
tags?: (string | null)[] | null;
```

## Type Composition Patterns

### Base Entity Type

```typescript
@ObjectType({ isAbstract: true })
export abstract class BaseEntity {
  @Field(() => ID)
  id: string;

  @Field(() => Date)
  createdAt: Date;

  @Field(() => Date)
  updatedAt: Date;
}

@ObjectType()
export class User extends BaseEntity {
  @Field()
  email: string;
}
```

### Pagination Types

```typescript
@ObjectType()
export class PageInfo {
  @Field(() => Boolean)
  hasNextPage: boolean;

  @Field(() => Boolean)
  hasPreviousPage: boolean;

  @Field(() => String, { nullable: true })
  startCursor?: string;

  @Field(() => String, { nullable: true })
  endCursor?: string;
}

@ObjectType()
export class UserEdge {
  @Field(() => User)
  node: User;

  @Field(() => String)
  cursor: string;
}

@ObjectType()
export class UserConnection {
  @Field(() => [UserEdge])
  edges: UserEdge[];

  @Field(() => PageInfo)
  pageInfo: PageInfo;

  @Field(() => Int)
  totalCount: number;
}
```

## Best Practices

### 1. Always Add Descriptions

Every type, field, and enum value should have a description:

```typescript
@ObjectType({ description: "A user account in the system" })
export class User {
  @Field(() => ID, { description: "Unique identifier (UUID v4)" })
  id: string;
}
```

### 2. Use Explicit Types

Always specify the GraphQL type explicitly:

```typescript
// Good
@Field(() => Int)
age: number;

// Bad - GraphQL can't infer Int vs Float
@Field()
age: number;
```

### 3. Separate Input and Output Types

Don't reuse ObjectTypes as InputTypes:

```typescript
// Good
@ObjectType()
export class User { }

@InputType()
export class CreateUserInput { }

// Bad
@ObjectType()
@InputType("UserInput")
export class User { }
```

### 4. Use Mapped Types for Updates

```typescript
@InputType()
export class UpdateUserInput extends PartialType(
  OmitType(CreateUserInput, ["password"])
) {}
```
