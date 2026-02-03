# [Project Name]

Developers write specs and answer questions. Agents implement, test, verify, question, and document.

## About This Project

> Ask Claude: "What is the purpose of this project and how does it work?"

## Step 1: Install Claude Code

```bash
brew install claude-code
# Or: npm install -g @anthropic-ai/claude-code
```

## Step 2: Set Up This Project

> Ask Claude: "I just cloned this repo. Walk me through the full setup including installing dependencies, environment variables, and any other configuration."

## Step 3: Verify the Infrastructure

> Ask Claude: "How do I synthesize the CDK stacks and verify the templates are valid?"

## Step 4: Work on a Feature

> Ask Claude: "I have Jira ticket [TICKET-ID]. Research the codebase, create a plan, and implement it."

Or break it down:

- `/project:setup` - Set up the project from a spec or ticket
- `/project:research` - Research the codebase
- `/project:plan` - Create an implementation plan
- `/project:implement` - Execute the plan
- `/project:review` - Review the changes

## Common Tasks

### Code Review

> Ask Claude: "Review the changes on this branch and suggest improvements."

### Submit a PR

> Ask Claude: "Commit my changes and open a pull request."

### Fix Lint Errors

> Ask Claude: "Run the linter and fix all errors."

### Add Test Coverage

> Ask Claude: "Increase test coverage for the files I changed."

### Synthesize CloudFormation Templates

> Ask Claude: "Run CDK synth and verify the CloudFormation templates are generated correctly."

### Diff Against Deployed Stacks

> Ask Claude: "Run CDK diff to show what changes would be deployed compared to the current stacks."

### Deploy

> Ask Claude: "Walk me through deploying this project."

## Project Standards

> Ask Claude: "What coding standards and conventions does this project follow?"

## Architecture

> Ask Claude: "Explain the architecture of this project, including key components and how they interact."

## Troubleshooting

> Ask Claude: "I'm having an issue with [describe problem]. Help me debug it."
