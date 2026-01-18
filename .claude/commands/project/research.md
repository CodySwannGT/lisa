---
description: Conducts research of your code base and the web relevant to your project and compiles it for the planning phase
argument-hint: <project-directory>
---

# Research Codebase

You are tasked with conducting comprehensive research across the codebase and web that will help create an implementation plan for the brief in $ARGUMENTS

Goals:

1. Determine what existing documentation in the codebase will be needed to fulfill the spec
2. Determine any gaps in the spec that would prevent a developer from fulfilling the acceptance criteria
3. Determine any potential pitfalls that should be considered such as performance or security concerns
4. Determine what code, functions, and modules currently exist within the codebase that could be reused during implementation
5. Determine testing patterns and locations in the codebase (frameworks, conventions, examples to follow)
6. Determine documentation patterns in the codebase (JSDoc conventions, DB comment conventions, GraphQL description conventions)

Note: Task-specific concerns (acceptance criteria, specific tests to write, specific documentation to create) are determined during the Planning phase on a per-task basis.

## Step 0: MANDATORY SETUP

Create workflow tracking todos:
- Step 1: Read mentioned files
- Step 2: Analyze and decompose
- Step 3: Spawn research agents
- Step 4: Wait and synthesize
- Step 5: Generate document
- Step 6: Commit

⚠️ **CRITICAL**: DO NOT STOP until all 6 todos are marked completed.

## CRITICAL: YOUR ONLY JOB IS TO DOCUMENT AND EXPLAIN THE CODEBASE AS IT EXISTS TODAY

- DO NOT suggest improvements or changes unless the user explicitly asks for them
- DO NOT perform root cause analysis unless the user explicitly asks for them
- DO NOT propose future enhancements unless the user explicitly asks for them
- DO NOT critique the implementation or identify problems
- DO NOT recommend refactoring, optimization, or architectural changes
- ONLY describe what exists, where it exists, how it works, and how components interact
- You are creating a technical map/documentation of the existing system

## Step 1: Read Mentioned Files
Mark "Step 1: Read mentioned files" as in_progress.

**Read any directly mentioned files first:**
- If the user mentions specific files (tickets, docs, JSON), read them FULLY first
- **IMPORTANT**: Use the Read tool WITHOUT limit/offset parameters to read entire files
- **CRITICAL**: Read these files yourself in the main context before spawning any sub-tasks
- This ensures you have full context before decomposing the research

Mark "Step 1: Read mentioned files" as completed. Proceed to Step 2.

## Step 2: Analyze and Decompose
Mark "Step 2: Analyze and decompose" as in_progress.

**Analyze and decompose the research question:**
- Break down the brief into composable research areas
- Take time to ultrathink about the underlying patterns, connections, and architectural implications
- Identify specific components, patterns, or concepts to investigate
- Create a research plan using TodoWrite to track all subtasks
- Consider which directories, files, or architectural patterns are relevant

Mark "Step 2: Analyze and decompose" as completed. Proceed to Step 3.

## Step 3: Spawn Research Agents
Mark "Step 3: Spawn research agents" as in_progress.

**Spawn parallel sub-agent tasks for comprehensive research:**
- Create multiple Task agents to research different aspects concurrently
- We now have specialized agents that know how to do specific research tasks:

**For codebase research:**
- Use the **codebase-locator** agent to find WHERE files and components live
- Use the **codebase-analyzer** agent to understand HOW specific code works (without critiquing it)
- Use the **codebase-pattern-finder** agent to find examples of existing patterns (without evaluating them)
- Use the **git-history-analyzer** agent to understand what changes the file has undergone that may affect the implementation plan

**For e2e test research:**
- Use the **codebase-locator** agent to find existing e2e tests in `e2e/` or `tests/` directories that relate to the feature being modified
- Use the **codebase-analyzer** agent to document what scenarios each relevant test covers
- Identify tests that will need modification due to UI/flow changes
- Identify tests that may need to be removed if features are deprecated
- Identify gaps where new tests will be needed for new functionality
- Document the test file paths and what each test validates

**IMPORTANT**: All agents are documentarians, not critics. They will describe what exists without suggesting improvements or identifying issues.

**For web research:**
- Use the **web-search-researcher** agent for external documentation and resources
- IF you use web-research agents, instruct them to return LINKS with their findings, and please INCLUDE those links in your final report

The key is to use these agents intelligently:
- Start with locator agents to find what exists
- Then use analyzer agents on the most promising findings to document how they work
- Run multiple agents in parallel when they're searching for different things
- Each agent knows its job - just tell it what you're looking for
- Don't write detailed prompts about HOW to search - the agents already know
- Remind agents they are documenting, not evaluating or improving

Mark "Step 3: Spawn research agents" as completed. Proceed to Step 4.

## Step 4: Wait and Synthesize
Mark "Step 4: Wait and synthesize" as in_progress.

**Wait for all sub-agents to complete and synthesize findings:**
- ⚠️ **CRITICAL**: Wait for ALL sub-agent tasks to complete before proceeding
- DO NOT proceed to Step 5 until every spawned Task has returned
- Compile all sub-agent results (both codebase and thoughts findings)
- Prioritize live codebase findings as primary source of truth
- Connect findings across different components
- Include specific file paths and line numbers for reference
- Highlight patterns, connections, and architectural decisions
- Include any frameworks used such as Ruby on Rails, NestJs, Expo, React, React Native, Vue, etc
- If a framework is used, identify what portions of the framework are relevant to the given project (i.e. ActiveRecord, NestJs Service's, dependency injection, etc)

Mark "Step 4: Wait and synthesize" as completed. Proceed to Step 5.

## Step 5: Generate Document
Mark "Step 5: Generate document" as in_progress.

**Generate research document:**
- Structure the document with YAML frontmatter followed by content:

  ```markdown
  ---
  date: [Current date and time with timezone in ISO format]
  status: complete
  last_updated: [Current date in YYYY-MM-DD format]
  ---

  # Research

  ## Summary

  [High-level documentation of what was found]

  ## Detailed Findings

  ### [Component/Area 1]

  - Description of what exists ([file.ext:line](link))
  - How it connects to other components
  - Current implementation details (without evaluation)

  ### [Component/Area 2]

  ...

  ## Code References

  - `path/to/file.py:123` - Description of what's there
  - `another/file.ts:45-67` - Description of the code block

  ## Architecture Documentation

  [Current patterns, conventions, and design implementations found in the codebase]

  ## Testing Patterns

  ### Unit Test Patterns
  - **Location**: `src/**/__tests__/*.test.ts` (or actual pattern found)
  - **Framework**: Jest/Vitest/etc.
  - **Example to follow**: `path/to/example.test.ts:line-range`
  - **Conventions**: [Describe naming, structure, mock patterns]

  ### Integration Test Patterns
  - **Location**: `src/**/*.integration.test.ts` (or actual pattern found)
  - **Example to follow**: `path/to/example.integration.test.ts`
  - **Conventions**: [Describe setup, teardown, database handling]

  ### E2E Test Patterns
  - **Location**: `e2e/*.spec.ts` (or actual pattern found)
  - **Framework**: Playwright/Cypress/Maestro/etc.
  - **Example to follow**: `path/to/example.spec.ts`
  - **Conventions**: [Describe page objects, fixtures, assertions]

  ## Documentation Patterns

  ### JSDoc Conventions
  - **Style**: [Describe the JSDoc style used in this codebase]
  - **Example**: `path/to/well-documented-file.ts:line-range`
  - **Required tags**: [@param, @returns, @throws, etc.]

  ### Database Comments (Backend Only)
  - **Convention**: [How tables/columns are documented]
  - **Example**: `path/to/entity.ts` or migration file
  - **Required for**: [New tables, new columns, complex relationships]

  ### GraphQL Descriptions (Backend Only)
  - **Convention**: [How types/fields are documented]
  - **Example**: `path/to/resolver.ts` or schema file
  - **Required for**: [Public API fields, complex types]

  ## Open Questions

  <!--
  Structure each question with context and impact.
  The Answer field must be filled by a human before planning can proceed.
  -->

  ### Q1: [Short Question Title]
  **Question**: [Full question]
  **Context**: [Why this question arose, what in the brief is unclear]
  **Impact**: [What parts of implementation this affects]
  **Answer**: _[Human fills this in before running /project:plan]_

  <!-- Add more questions as needed using the same format -->
  <!-- If no questions, replace this section with: [None identified] -->
  ```

- Save the research document as `research.md` in the $ARGUMENTS directory

Mark "Step 5: Generate document" as completed. Proceed to Step 6.

## Step 6: Commit
Mark "Step 6: Commit" as in_progress.

Run /git:commit

Mark "Step 6: Commit" as completed.

## Important notes:

- Always use parallel Task agents to maximize efficiency and minimize context usage
- Always run fresh codebase research - never rely solely on existing research documents
- Focus on finding concrete file paths and line numbers for developer reference
- Research documents should be self-contained with all necessary context
- Each sub-agent prompt should be specific and focused on read-only documentation operations
- Document cross-component connections and how systems interact
- Include temporal context (when the research was conducted)
- Keep the main agent focused on synthesis, not deep file reading
- Have sub-agents document examples and usage patterns as they exist
- **CRITICAL**: You and all sub-agents are documentarians, not evaluators
- **REMEMBER**: Document what IS, not what SHOULD BE
- **NO RECOMMENDATIONS**: Only describe the current state of the codebase
- **File reading**: Always read mentioned files FULLY (no limit/offset) before spawning sub-tasks
- **Critical ordering**: Follow the numbered steps exactly
  - ALWAYS read mentioned files first before spawning sub-tasks (step 1)
  - ALWAYS wait for all sub-agents to complete before synthesizing (step 4)
  - ALWAYS gather metadata before writing the document (step 5 before step 6)
  - NEVER write the research document with placeholder values
- **Frontmatter consistency**:
  - Always include frontmatter at the beginning of research documents
  - Keep frontmatter fields consistent across all research documents
  - Update frontmatter when adding follow-up research
  - Use snake_case for multi-word field names (e.g., `last_updated`)
  - Tags should be relevant to the research topic and components studied
