---
name: project-research
description: This skill should be used when conducting comprehensive research across the codebase and web relevant to a project. It spawns parallel research agents, documents existing code patterns, testing patterns, and architecture, and compiles findings into a research.md file for the planning phase.
allowed-tools: ["Read", "Write", "Bash", "Glob", "Grep", "Task", "TaskCreate", "TaskUpdate", "TaskList", "WebSearch", "WebFetch"]
argument-hint: "<project-directory>"
---

# Research Codebase

Conduct comprehensive research across the codebase and web to help create an implementation plan for the brief in $ARGUMENTS.

## Goals

1. Determine what existing documentation in the codebase will be needed
2. Determine any gaps in the spec that would prevent fulfilling acceptance criteria
3. Determine potential pitfalls (performance, security concerns)
4. Determine reusable code, functions, and modules in the codebase
5. Determine testing patterns and locations (frameworks, conventions, examples)
6. Determine documentation patterns (JSDoc, DB comments, GraphQL descriptions)

## Critical Rule

**THE ONLY JOB IS TO DOCUMENT AND EXPLAIN THE CODEBASE AS IT EXISTS TODAY**

- DO NOT suggest improvements or changes
- DO NOT perform root cause analysis
- DO NOT propose future enhancements
- DO NOT critique or identify problems
- ONLY describe what exists, where it exists, how it works, and how components interact

## Workflow Tasks

Create workflow tracking tasks with `metadata: { "project": "<project-name>", "phase": "research" }`:

1. Read mentioned files
2. Analyze and decompose
3. Spawn research agents
4. Wait and synthesize
5. Generate document
6. Commit

## Step 1: Read Mentioned Files

Read any directly mentioned files FULLY first (no limit/offset). This ensures full context before spawning sub-tasks.

## Step 2: Analyze and Decompose

- Break down the brief into composable research areas
- Identify specific components, patterns, or concepts to investigate
- Consider which directories, files, or architectural patterns are relevant

## Step 3: Spawn Research Agents

Spawn parallel sub-agent tasks for comprehensive research:

**For codebase research:**
- **codebase-locator**: Find WHERE files and components live
- **codebase-analyzer**: Understand HOW specific code works
- **codebase-pattern-finder**: Find examples of existing patterns
- **git-history-analyzer**: Understand file change history

**For e2e test research:**
- Find existing e2e tests in `e2e/` or `tests/` directories
- Document what scenarios each test covers
- Identify tests needing modification or gaps for new functionality

**For web research:**
- **web-search-researcher**: External documentation and resources
- Include LINKS with findings in the final report

Run multiple agents in parallel when searching for different things.

## Step 4: Wait and Synthesize

**CRITICAL**: Wait for ALL sub-agent tasks to complete before proceeding.

- Compile all sub-agent results
- Prioritize live codebase findings as primary source of truth
- Connect findings across different components
- Include specific file paths and line numbers
- Note any frameworks used (Rails, NestJS, Expo, React, etc.)

## Step 5: Generate Document

Create `$ARGUMENTS/research.md` with this structure:

```markdown
---
date: [ISO format with timezone]
status: complete
last_updated: [YYYY-MM-DD]
---

# Research

## Summary
[High-level documentation of findings]

## Detailed Findings
### [Component/Area]
- Description of what exists ([file.ext:line](link))
- How it connects to other components

## Code References
- `path/to/file.py:123` - Description

## Reusable Code
### Existing Functions/Modules
- `path/to/utils.ts:45` - `functionName()` - description of what it does and how it can be reused
- `path/to/service.ts:120` - `ClassName` - description of reusable functionality

### Existing Patterns to Follow
- Similar feature implemented in `path/to/feature/` - follow same structure
- Existing implementation of X in `path/to/file.ts` - can be extended/adapted

## Architecture Documentation
[Patterns, conventions, design implementations]

## Testing Patterns
### Unit Test Patterns
- **Location**: pattern found
- **Framework**: Jest/Vitest/etc.
- **Example to follow**: path:line-range
- **Conventions**: naming, structure, mocks

### Integration Test Patterns
[Similar structure]

### E2E Test Patterns
[Similar structure]

## Impacted Tests
### Tests Requiring Modification
- `tests/example.spec.ts` - tests X functionality, will need updates for Y
- `e2e/feature.spec.ts` - may need new assertions for Z

### Test Gaps
- No existing tests for X functionality - will need new test file
- Missing edge case coverage for Y scenario

## Documentation Patterns
### JSDoc Conventions
### Database Comments (Backend)
### GraphQL Descriptions (Backend)

## Open Questions

### Q1: [Short Title]
**Question**: [Full question]
**Context**: [Why this arose]
**Impact**: [What it affects]
**Recommendation**: [Researcher's best recommendation based on findings]
**Answer**: _[Human fills before /project-plan]_
```

## Step 6: Commit

Run `/git-commit`

## Important Notes

- Always use parallel Task agents to maximize efficiency
- Always run fresh codebase research - never rely solely on existing documents
- Focus on finding concrete file paths and line numbers
- Each sub-agent prompt should be specific and focused on read-only documentation
- **REMEMBER**: Document what IS, not what SHOULD BE
