---
name: lisa-jsdoc-best-practices
description: Enforces JSDoc documentation standards for this TypeScript project. This skill should be used when writing or reviewing TypeScript code to ensure proper documentation with file preambles, function docs, interface docs, and the critical distinction between documenting "what" vs "why". Use this skill to understand the project's JSDoc ESLint rules and established patterns.
---

# JSDoc Best Practices

## Overview

This skill defines the JSDoc documentation standards for this project. The core principle is that **documentation should explain "why", not just "what"**. Code already shows what it does—good documentation explains the reasoning, context, and non-obvious details that help developers understand and maintain the code.

## Core Philosophy: Why Over What

### The Problem with "What" Documentation

```typescript
// Bad: Just restates the code
/**
 * Gets the user by ID
 * @param id - The ID
 * @returns The user
 */
function getUserById(id: string): User { ... }
```

This documentation adds no value—the function name already tells us it gets a user by ID.

### The Solution: Document "Why"

```typescript
// Good: Explains context, constraints, and non-obvious behavior
/**
 * Retrieves a user by their unique identifier
 * @param id - The user's UUID (not the legacy numeric ID)
 * @returns The user if found, null if not found or soft-deleted
 * @remarks Used by DataLoader for batching - maintains input order
 */
function getUserById(id: string): User | null { ... }
```

This documentation adds value by explaining:
- What kind of ID (UUID vs legacy)
- What happens when not found
- Why this specific implementation exists (DataLoader batching)

## ESLint Enforcement

The project enforces JSDoc through `eslint-plugin-jsdoc` with these rules:

### Required Documentation

| Rule | Setting | What It Enforces |
|------|---------|------------------|
| `jsdoc/require-jsdoc` | error | JSDoc on function declarations, interfaces, type aliases, and PascalCase arrow functions |
| `jsdoc/require-param-description` | error | All `@param` tags must have descriptions |
| `jsdoc/require-returns-description` | error | All `@returns` tags must have descriptions |
| `jsdoc/require-property-description` | error | All `@property` tags must have descriptions |

### Allowed Tags

| Rule | Setting | Effect |
|------|---------|--------|
| `jsdoc/check-tag-names` | `definedTags: ["remarks"]` | Allows `@remarks` for "why" documentation |
| `jsdoc/no-types` | off | TypeScript types in JSDoc are optional |
| `jsdoc/require-param-type` | off | Types come from TypeScript, not JSDoc |
| `jsdoc/require-returns-type` | off | Types come from TypeScript, not JSDoc |

### What Requires Documentation

Per `jsdoc/require-jsdoc` configuration:

```javascript
{
  require: {
    FunctionDeclaration: true,      // function foo() {}
    MethodDefinition: false,        // class methods (optional)
    ClassDeclaration: false,        // classes (optional but recommended)
    ArrowFunctionExpression: false, // const foo = () => {} (optional)
    FunctionExpression: false,      // const foo = function() {} (optional)
  },
  contexts: [
    "TSInterfaceDeclaration",       // interface Foo {}
    "TSTypeAliasDeclaration",       // type Foo = ...
    // PascalCase arrow functions (React components, factories):
    "VariableDeclaration[declarations.0.init.type='ArrowFunctionExpression']:has([id.name=/^[A-Z]/])"
  ]
}
```

## Documentation Patterns

### File Preambles

Every file should have a preamble comment at the top:

```typescript
/**
 * @file complexity.plugin.ts
 * @description Apollo Server plugin for query complexity analysis and limiting
 * @module graphql
 */
```

| Tag | Purpose |
|-----|---------|
| `@file` | The filename (for navigation and search) |
| `@description` | What this file provides |
| `@module` | The feature module this belongs to |

### Service Documentation

```typescript
/**
 * Service for managing user accounts
 * @description Provides CRUD operations for user entities
 * @remarks
 * - All methods are idempotent
 * - Throws NotFoundException for missing resources
 * - Uses DataLoader batching for bulk operations
 */
@Injectable()
export class UserService { ... }
```

### Method Documentation

```typescript
/**
 * Batch loads entities by IDs (for DataLoader)
 * @param ids - Array of entity IDs to load
 * @returns Promise resolving to array of entities in same order as input
 * @remarks Used by DataLoader for batching - maintains input order
 */
async findByIds(ids: readonly string[]): Promise<Entity[]> { ... }
```

### Interface Documentation

```typescript
/**
 * Interface for authentication services
 * @description Defines the contract for both Cognito and Local auth implementations.
 * This interface ensures both AuthService (production) and LocalAuthService
 * (local development) provide the same public API for authentication operations.
 */
export interface IAuthService {
  /**
   * Initiates the sign-in flow by sending an OTP to the user
   * @param input - The sign-in input containing the user identifier (phone/email)
   * @returns A promise resolving to the sign-in result with session and challenge info
   */
  signIn(input: SignInInput): Promise<SignInResult>;
}
```

### Type/Constant Documentation

```typescript
/**
 * Default complexity configuration
 * @description Tune these values based on your server capacity
 */
const COMPLEXITY_CONFIG = {
  /** Maximum allowed query complexity */
  maxComplexity: 100,
  /** Default complexity for fields without explicit complexity */
  defaultComplexity: 1,
} as const;
```

## The @remarks Tag

Use `@remarks` to document the "why" and important context:

### When to Use @remarks

| Use Case | Example |
|----------|---------|
| Design decisions | `@remarks Uses closure pattern to cache between Lambda invocations` |
| Usage constraints | `@remarks Call getLoaders() once per GraphQL request in context factory` |
| Non-obvious behavior | `@remarks Maintains input order for DataLoader compatibility` |
| Important caveats | `@remarks All methods are idempotent - safe to retry` |
| Integration details | `@remarks Connects on module initialization, disconnects on destruction` |

### @remarks Format

Use bullet points for multiple remarks:

```typescript
/**
 * Apollo Server plugin that calculates and limits query complexity
 * @description Prevents expensive queries from overwhelming the server
 * @remarks
 * - Uses field extensions estimator for custom complexity values
 * - Falls back to simple estimator with default complexity of 1
 * - Rejects queries that exceed the configured maximum complexity
 */
```

Use inline for single remarks:

```typescript
/**
 * Creates all DataLoader instances for a single request
 * @returns Object containing all typed DataLoaders
 * @remarks Called in GraphQL context factory - creates fresh instances per request
 */
```

## Parameter Descriptions

### Bad: Restating the Name

```typescript
/**
 * @param id - The id
 * @param name - The name
 * @param options - The options
 */
```

### Good: Adding Value

```typescript
/**
 * @param id - The user's UUID (not the legacy numeric ID from v1 API)
 * @param name - Display name, max 50 characters, sanitized for XSS
 * @param options - Configuration for the query, see QueryOptions type
 */
```

### Parameter Description Guidelines

| Include | Avoid |
|---------|-------|
| Valid value ranges | Restating the parameter name |
| Format requirements | Restating the type |
| Default behavior | Obvious information |
| Edge cases | Implementation details |
| Units (ms, bytes, etc.) | Internal variable names |

## Return Value Descriptions

### Bad: Restating the Type

```typescript
/**
 * @returns The user
 * @returns A promise
 * @returns The result
 */
```

### Good: Explaining Behavior

```typescript
/**
 * @returns The user if found, null if not found or soft-deleted
 * @returns Promise resolving to array of entities in same order as input
 * @returns Authentication tokens on success, error message on failure
 */
```

## Anti-Patterns to Avoid

### Don't Document the Obvious

```typescript
// Wrong: Adds no value
/**
 * Constructor
 */
constructor() {}

/**
 * Gets the name
 * @returns The name
 */
getName(): string { return this.name; }
```

### Don't Duplicate TypeScript Types

```typescript
// Wrong: Type is already in signature
/**
 * @param id - {string} The user ID
 * @returns {Promise<User>} The user
 */
async getUser(id: string): Promise<User> { ... }

// Correct: Description only, type from TypeScript
/**
 * @param id - The user's UUID identifier
 * @returns The user entity with populated relations
 */
async getUser(id: string): Promise<User> { ... }
```

### Don't Write Implementation Comments

```typescript
// Wrong: Documents how, not why
/**
 * Loops through users and filters by active status
 */
const activeUsers = users.filter(u => u.active);

// Correct: Self-documenting code needs no comment
// If explanation is needed, explain WHY:
// Active users are filtered first to avoid unnecessary permission checks
const activeUsers = users.filter(u => u.active);
```

## Escaping @ Symbols in JSDoc

When documenting code that contains TypeScript/NestJS decorators (like `@Injectable()`, `@Processor('queue-name')`), JSDoc will interpret the `@` as a tag marker. This causes lint errors because JSDoc sees `@Processor('qpr-v2')` as a single unknown tag name (including the parentheses and arguments).

**The problem:** Adding decorator names to `definedTags` doesn't help because JSDoc parses the entire string `@Processor('qpr-v2')` as the tag name, not just `@Processor`.

### Solution 1: Backticks in Prose

When mentioning decorators in description text, wrap them in backticks:

```typescript
/**
 * Queue processor for QPR calculations
 * @description Handles jobs from the `@Processor('qpr-v2')` queue
 * @remarks Uses `@Injectable()` scope for request isolation
 */
```

### Solution 2: Escape in @example Blocks

In `@example` blocks, use fenced code blocks and escape `@` as `\@`:

```typescript
/**
 * Creates a queue processor
 * @example
 * ```typescript
 * \@Processor('my-queue')
 * export class MyProcessor {
 *   \@Process()
 *   async handle(job: Job) { ... }
 * }
 * ```
 */
```

### Path Examples Must Not Contain the Block Terminator

A path written as an example inside a doc comment **ends the comment** if it
contains `*/` — a glob such as `sandbox-*/`, or any real directory whose
name ends in an asterisk. Everything below that point is then parsed as source:
path segments become identifiers, and the separator between them becomes
division.

**Write the wildcard as a placeholder, not a glob:**

```typescript
// WRONG — the comment ends inside the path, mid-line
/**
 * Debris lands at `.stryker-tmp/bite-guard-intact/sandbox-*/rails/scripts/foo.sh`
 * and this line is no longer a comment.
 */

// RIGHT — a placeholder cannot terminate the block
/**
 * Debris lands at `.stryker-tmp/bite-guard-intact/sandbox-<id>/rails/scripts/foo.sh`
 * and this line is still a comment.
 */
```

`<id>`, `<name>`, `<n>` — the same placeholder convention used everywhere else
in Lisa's docs. Escaping (`*\/`) also works but produces an example nobody can
copy and paste, which defeats the point of writing one.

### What it looks like when you get it wrong

The build goes red immediately — `bun run typecheck`, `bun run lint` and the
test run all fail — but **none of them mentions a comment**, and every line
they report sits *below* the real cause. Measured, with the true cause on
line 89:

```text
src/configs/repo-scan.ts(90,9):  error TS1005: ';' expected.
src/configs/repo-scan.ts(90,20): error TS1443: Module declaration names may only use ' or " quoted strings.
src/configs/repo-scan.ts(94,1):  error TS1160: Unterminated template literal.
```

Errors naming identifiers you never wrote — `Cannot find name 'mutation'`,
`Cannot find name 'src'` — are the giveaway: those are backtick contents from
inside the comment, now being read as code. **Look upward for a doc comment
before looking for a missing import.**

Lisa's gate runner says this for you. When a gate fails, it scans the files the
failure named and reports the closed comment by name:

```text
a doc comment in src/configs/repo-scan.ts ends early, on line 89 — every error
reported below that line is downstream of it, not a fault of its own
  ↳ src/configs/repo-scan.ts:89 — the block opened on line 87 ends at the
    terminator INSIDE this line, not on line 92
```

It is a text scan rather than a lint rule on purpose: the file does not parse,
so ESLint reports `Parsing error` and runs zero rules on it.

## Quick Reference for Escaping

| Context | Approach | Example |
|---------|----------|---------|
| Prose/description | Wrap in backticks | `` `@Injectable()` `` |
| @example block | Escape with backslash | `\@Processor('name')` |
| Code comments | No escaping needed | `// Uses @Injectable` |

## Quick Reference

### Required Structure for Services

```typescript
/**
 * @file feature.service.ts
 * @description Service providing feature functionality
 * @module feature
 */

/**
 * Service for feature operations
 * @description Brief description of what this service handles
 * @remarks
 * - Important architectural decisions
 * - Usage patterns or constraints
 */
@Injectable()
export class FeatureService {
  /**
   * Brief description of what this method does
   * @param paramName - What this parameter represents and any constraints
   * @returns What is returned and under what conditions
   * @remarks Any non-obvious behavior or usage notes
   */
  methodName(paramName: Type): ReturnType { ... }
}
```

### Required Structure for Interfaces

```typescript
/**
 * Interface for feature operations
 * @description Explains the contract this interface defines
 */
export interface IFeature {
  /**
   * Method description
   * @param param - Parameter description with constraints
   * @returns Return description with conditions
   */
  method(param: Type): ReturnType;
}
```

### Required Structure for Types

```typescript
/**
 * Represents a feature configuration
 * @description Used to configure feature behavior at initialization
 */
export type FeatureConfig = {
  /** Maximum retry attempts before failing */
  maxRetries: number;
  /** Timeout in milliseconds */
  timeoutMs: number;
};
```

## Verification Checklist

Before committing code, verify:

1. **File preamble exists**: `@file`, `@description`, `@module`
2. **Function declarations have JSDoc**: Required by ESLint
3. **Interfaces have JSDoc**: Required by ESLint
4. **Type aliases have JSDoc**: Required by ESLint
5. **Parameters have meaningful descriptions**: Not just restating the name
6. **Returns have meaningful descriptions**: Explain conditions and edge cases
7. **@remarks used for "why"**: Design decisions, constraints, non-obvious behavior
8. **No TypeScript types in JSDoc**: Types come from the signature
