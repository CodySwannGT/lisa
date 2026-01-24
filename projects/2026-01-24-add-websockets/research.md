---
date: 2026-01-24T12:00:00-05:00
status: complete
last_updated: 2026-01-24
---

# Research: Add WebSocket Support

## Summary

Lisa is a Claude Code governance framework that applies guardrails, guidance, and automated enforcement to projects. The brief requests adding WebSocket support for real-time communication. This research examines the existing codebase architecture, identifies relevant patterns from NestJS WebSocket documentation already present in Lisa, and documents the considerations for implementing WebSocket support.

Key findings:
1. **Lisa already has NestJS WebSocket patterns** documented in the `nestjs-graphql` skill for GraphQL subscriptions
2. **Lisa's core is a CLI tool**, not a server - WebSocket support would likely be for **NestJS projects Lisa configures**, not Lisa itself
3. **Existing NestJS skills** exclude `@nestjs/websockets` from Lambda bundles, indicating serverless WebSocket considerations
4. **Testing patterns** use Vitest with clear organization (unit/integration/helpers)
5. **Documentation patterns** follow JSDoc with "why over what" philosophy

## Detailed Findings

### Lisa Core Architecture

Lisa is a TypeScript CLI application that copies configuration files to target projects. It does not run as a persistent server.

**Core Components:**
- `/Users/cody/workspace/lisa/src/core/lisa.ts:42-66` - Main `Lisa` class orchestrator
- `/Users/cody/workspace/lisa/src/core/config.ts:1-130` - Configuration types and project type definitions
- `/Users/cody/workspace/lisa/src/index.ts:1-13` - CLI entry point using Commander

**Key Types:**
```typescript
export type ProjectType =
  | "typescript"
  | "expo"
  | "nestjs"
  | "cdk"
  | "npm-package";
```

**Project Type Hierarchy:** (config.ts:23-31)
```typescript
export const PROJECT_TYPE_HIERARCHY = {
  expo: "typescript",
  nestjs: "typescript",
  cdk: "typescript",
  "npm-package": "typescript",
  typescript: undefined,
};
```

### Existing WebSocket Documentation in NestJS Skills

Lisa already contains comprehensive WebSocket patterns for NestJS projects in the GraphQL subscriptions section.

**Location:** `/Users/cody/workspace/lisa/nestjs/copy-overwrite/.claude/skills/nestjs-graphql/references/advanced-features.md:327-450`

**Key patterns documented:**

1. **Subscriptions for Real-time Updates:**
```typescript
@Subscription(() => Post, {
  description: "Subscribe to new posts",
})
postCreated() {
  return pubSub.asyncIterator(POST_CREATED);
}
```

2. **GraphQL WebSocket Configuration:**
```typescript
GraphQLModule.forRoot<ApolloDriverConfig>({
  subscriptions: {
    "graphql-ws": true, // Modern WebSocket protocol
    "subscriptions-transport-ws": true, // Legacy protocol
  },
})
```

3. **Subscription Authentication:**
```typescript
subscriptions: {
  "graphql-ws": {
    onConnect: (context) => {
      const token = connectionParams?.authorization;
      const user = validateToken(token);
      return { user };
    },
  },
}
```

### Serverless WebSocket Exclusions

In the NestJS rules skill, `@nestjs/websockets` is explicitly excluded from Lambda bundles.

**Location:** `/Users/cody/workspace/lisa/nestjs/copy-overwrite/.claude/skills/nestjs-rules/SKILL.md:260-265`

```yaml
external:
  - "fsevents"
  - "@nestjs/websockets"
  - "@nestjs/microservices"
```

This indicates that NestJS projects configured by Lisa are designed for AWS Lambda, where persistent WebSocket connections require different infrastructure (API Gateway WebSocket APIs).

### NestJS Gateway Pattern from Web Research

NestJS manages WebSocket connections using the **Gateway pattern**, which wraps WebSocket functionality with dependency injection.

**Installation:**
```bash
npm install @nestjs/websockets @nestjs/platform-socket.io
```

**Lifecycle Hooks:**
- `afterInit()` - Gateway initialized
- `handleConnection(client)` - New client connected
- `handleDisconnect(client)` - Client disconnected

**Scalability:** Redis pub/sub is recommended for distributed WebSocket servers to ensure all clients receive broadcasts regardless of which server they're connected to.

## Code References

### Core Lisa Files
- `/Users/cody/workspace/lisa/src/core/lisa.ts` - Main orchestrator class (732 lines)
- `/Users/cody/workspace/lisa/src/core/config.ts` - Configuration types (130 lines)
- `/Users/cody/workspace/lisa/src/cli/index.ts` - CLI setup with Commander

### NestJS WebSocket Skills
- `/Users/cody/workspace/lisa/nestjs/copy-overwrite/.claude/skills/nestjs-graphql/references/advanced-features.md:327-450` - GraphQL subscriptions via WebSocket
- `/Users/cody/workspace/lisa/nestjs/copy-overwrite/.claude/skills/nestjs-rules/SKILL.md:256-289` - Serverless configuration excluding @nestjs/websockets

### Test Files
- `/Users/cody/workspace/lisa/tests/integration/lisa.test.ts` - Integration test patterns (315 lines)
- `/Users/cody/workspace/lisa/tests/unit/strategies/merge.test.ts` - Unit test patterns (229 lines)
- `/Users/cody/workspace/lisa/tests/helpers/test-utils.ts` - Test utilities (152 lines)

## Architecture Documentation

### Lisa Directory Structure

```
lisa/
├── src/
│   ├── core/           # Main orchestrator, config, manifest
│   ├── cli/            # Commander CLI setup, prompts
│   ├── detection/      # Project type detectors
│   ├── strategies/     # File copy strategies (merge, overwrite, etc.)
│   ├── transaction/    # Backup and rollback
│   ├── logging/        # Console and silent loggers
│   ├── errors/         # Custom error types
│   └── utils/          # File and JSON utilities
├── all/                # Applied to all projects
├── typescript/         # TypeScript-specific configs
├── nestjs/             # NestJS-specific configs and skills
├── expo/               # Expo-specific configs
├── cdk/                # CDK-specific configs
└── tests/              # Vitest test suite
```

### Dependency Injection Pattern

Lisa uses constructor injection for dependencies (`LisaDependencies`):

```typescript
export interface LisaDependencies {
  readonly logger: ILogger;
  readonly prompter: IPrompter;
  readonly manifestService: IManifestService;
  readonly backupService: IBackupService;
  readonly detectorRegistry: DetectorRegistry;
  readonly strategyRegistry: StrategyRegistry;
}
```

## Testing Patterns

### Unit Test Patterns
- **Location:** `tests/unit/**/*.test.ts`
- **Framework:** Vitest
- **Example:** `/Users/cody/workspace/lisa/tests/unit/strategies/merge.test.ts`
- **Conventions:**
  - Uses `describe/it/expect` from Vitest
  - `beforeEach/afterEach` for setup/teardown
  - Creates temp directories for file operation tests
  - Helper functions for context creation

### Integration Test Patterns
- **Location:** `tests/integration/*.test.ts`
- **Example:** `/Users/cody/workspace/lisa/tests/integration/lisa.test.ts`
- **Conventions:**
  - Creates mock project structures
  - Tests full Lisa apply/uninstall workflows
  - Uses `SilentLogger` and `AutoAcceptPrompter` for non-interactive testing

### Test Helpers
- **Location:** `/Users/cody/workspace/lisa/tests/helpers/test-utils.ts`
- **Functions:**
  - `createTempDir()` - Creates temp directory for tests
  - `cleanupTempDir(dir)` - Removes temp directory
  - `createTypeScriptProject(dir)` - Creates mock TS project
  - `createNestJSProject(dir)` - Creates mock NestJS project
  - `createMockLisaDir(dir)` - Creates mock Lisa config structure

## Documentation Patterns

### JSDoc Conventions
- **Style:** "Why over what" - explain reasoning, not obvious behavior
- **Example:** `/Users/cody/workspace/lisa/typescript/copy-overwrite/.claude/skills/jsdoc-best-practices/SKILL.md`
- **Required tags:**
  - `@file`, `@description`, `@module` for file preambles
  - `@param` with meaningful descriptions (not just restating name)
  - `@returns` with condition explanations
  - `@remarks` for "why" documentation

### Skill Documentation Format
- YAML frontmatter with `name` and `description`
- Overview section
- When to Use section
- Quick Reference tables
- Code examples with comments

## WebSocket Library Options

Based on web research:

### Option 1: Socket.IO
- **Pros:** Auto-reconnect, rooms/namespaces, fallback polling, large community
- **Cons:** More overhead, not pure WebSocket
- **Best for:** Chat features, collaborative apps needing reliability
- **Links:**
  - [NestJS WebSocket Gateways Documentation](https://docs.nestjs.com/websockets/gateways)
  - [Socket.IO vs WebSocket Comparison](https://www.videosdk.live/developer-hub/websocket/socketio-vs-websocket)

### Option 2: ws (raw WebSocket)
- **Pros:** Lightweight, 50K+ connections/server, fine-grained control
- **Cons:** Manual reconnection, no built-in rooms
- **Best for:** High-performance, low-latency applications
- **Links:**
  - [ws vs Socket.IO Comparison](https://dev.to/alex_aslam/nodejs-websockets-when-to-use-ws-vs-socketio-and-why-we-switched-di9)

### Option 3: GraphQL Subscriptions (already documented)
- **Pros:** Integrated with GraphQL, type-safe, existing documentation
- **Cons:** Requires GraphQL schema, limited to GraphQL use cases
- **Best for:** NestJS GraphQL projects

### Scalability Considerations
- Redis pub/sub for multi-instance deployments
- API Gateway WebSocket APIs for serverless
- Connection state management across Lambda invocations

## Open Questions

<!--
Structure each question with context and impact.
The Answer field must be filled by a human before planning can proceed.
-->

### Q1: Target Context for WebSocket Support
**Question**: Should WebSocket support be added to Lisa itself (as a new project type or feature) or to the NestJS/Expo skills that Lisa applies to target projects?
**Context**: Lisa is a CLI tool that configures projects. The brief says "add web sockets" but doesn't clarify if this means Lisa should detect and configure WebSocket projects, or if Lisa itself needs WebSocket capabilities.
**Impact**: Determines whether implementation involves new detectors/strategies or skill/template enhancements.
**Answer**: _[Human fills this in before running /project:plan]_

### Q2: Real-time Use Cases
**Question**: What specific real-time features are needed? (e.g., live updates, notifications, chat, collaboration)
**Context**: The brief mentions "define use cases and events to support" but doesn't specify which ones. Different use cases require different patterns (Socket.IO for chat, GraphQL subscriptions for data updates, etc.)
**Impact**: Affects library selection, authentication patterns, and skill documentation scope.
**Answer**: _[Human fills this in before running /project:plan]_

### Q3: Library Preference
**Question**: Should Lisa standardize on a specific WebSocket library (Socket.IO, ws, graphql-subscriptions) or provide templates for multiple options?
**Context**: Each library has tradeoffs (see WebSocket Library Options section). Socket.IO is easier but heavier; ws is lightweight but requires more boilerplate.
**Impact**: Determines skill content, package.json merge templates, and configuration examples.
**Answer**: _[Human fills this in before running /project:plan]_

### Q4: Deployment Environment
**Question**: Is WebSocket support needed for serverless (Lambda + API Gateway WebSocket) or traditional long-running servers?
**Context**: The existing NestJS skills explicitly exclude @nestjs/websockets for Lambda deployment. Serverless WebSocket requires API Gateway WebSocket APIs with different patterns.
**Impact**: Affects architecture documentation, connection management patterns, and Redis pub/sub recommendations.
**Answer**: _[Human fills this in before running /project:plan]_

### Q5: Authentication Requirements
**Question**: How should WebSocket connections be authenticated? (JWT tokens, session cookies, API Gateway authorizers)
**Context**: The existing NestJS GraphQL skill shows `onConnect` token validation. Different auth mechanisms require different patterns.
**Impact**: Determines security documentation, middleware examples, and connection context patterns.
**Answer**: _[Human fills this in before running /project:plan]_

## Sources

- [NestJS WebSocket Gateways Documentation](https://docs.nestjs.com/websockets/gateways)
- [Scalable WebSockets with NestJS and Redis - LogRocket Blog](https://blog.logrocket.com/scalable-websockets-with-nestjs-and-redis/)
- [Socket.IO vs ws Comparison - DEV Community](https://dev.to/alex_aslam/nodejs-websockets-when-to-use-ws-vs-socketio-and-why-we-switched-di9)
- [Socket.IO vs WebSocket Comparison - VideoSDK](https://www.videosdk.live/developer-hub/websocket/socketio-vs-websocket)
- [NestJS WebSocket Testing Guide - DEV Community](https://dev.to/jfrancai/demystifying-nestjs-websocket-gateways-a-step-by-step-guide-to-effective-testing-1a1f)
