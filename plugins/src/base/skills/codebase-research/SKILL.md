---
name: codebase-research
description: "Codebase exploration and architecture analysis. Read files, trace data flow, identify modification points, map dependencies, find reusable code, evaluate design patterns."
---

# Codebase Research

Systematically explore and analyze a codebase to understand its architecture, trace data flow, and identify how to make changes safely.

## Analysis Process

Follow these steps in order. Do not skip steps or propose changes to code you have not read.

### 1. Read Referenced Files

- Read every file that is directly relevant to the task
- Understand the current architecture before proposing changes
- Read imports and dependencies to understand the module graph
- Check for configuration files that affect behavior (tsconfig, eslint, webpack, etc.)

### 2. Trace Data Flow

- Follow the path from entry point to output for the affected feature
- Identify every transformation the data undergoes
- Map inputs, intermediate states, and outputs
- Note where data crosses boundaries (API calls, database queries, message queues)

### 3. Identify Modification Points

- Determine which files, functions, and interfaces need changes
- Note the exact lines where modifications are required
- Identify any type definitions, schemas, or contracts that must be updated
- Check for generated code that may need regeneration

### 4. Map Dependencies

- Identify what depends on the code being changed (downstream consumers)
- Identify what the code being changed depends on (upstream providers)
- Determine the safe modification order to avoid breaking intermediate states
- Flag any circular dependencies

### 5. Check for Reusable Code

- Search for existing utilities, helpers, or patterns that apply to the task
- Check shared libraries and common modules
- Look for similar implementations elsewhere in the codebase that can be referenced
- Prefer reusing existing code over creating new abstractions

### 6. Evaluate Design Patterns

- Match the codebase's existing patterns -- do not introduce new architectural patterns without reason
- Check naming conventions, file organization, and code style
- Identify any patterns that are partially implemented and should be completed
- Note anti-patterns that should not be propagated

## Output Format

```
## Architecture Analysis

### Files to Create
- `path/to/file.ts` -- purpose

### Files to Modify
- `path/to/file.ts:L42-L68` -- what changes and why

### Dependency Graph
- [file A] -> [file B] -> [file C] (modification order)

### Design Decisions
| Decision | Choice | Rationale |
|----------|--------|-----------|

### Reusable Code
- `path/to/util.ts:functionName` -- how it applies

### Risks
- [risk description] -- [mitigation]
```

## Rules

- Always read files before recommending changes to them
- Follow existing patterns in the codebase -- do not introduce new architectural patterns unless explicitly required
- Include file:line references for all recommendations
- Flag breaking changes explicitly
- Keep the modification surface area as small as possible
