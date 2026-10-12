---
name: jira-add-journey
description: "Add a Validation Journey section to an existing JIRA ticket by reading the ticket description, understanding the feature, and generating the journey steps and assertions."
---

# Add Validation Journey to Existing JIRA Ticket

Read an existing JIRA ticket, understand the feature or fix it describes, analyze the codebase to determine the verification approach, and append a Validation Journey section to the ticket description.

## Arguments

`$ARGUMENTS`: `<TICKET_ID>`

- `TICKET_ID` (required): JIRA ticket key (e.g., `PROJ-123`)

## Prerequisites

- `JIRA_API_TOKEN` environment variable set
- `jira-cli` configured. Prefer the config Lisa writes at
  `.lisa/jira-cli/.config.yml` (the `setup-jira-cli` SessionStart hook writes it
  from `JIRA_SERVER` / `JIRA_LOGIN` / `JIRA_PROJECT` on a project whose
  `tracker` is `jira`), and pass it explicitly with `--config`. A developer's
  own `~/.config/.jira/.config.yml` still works as jira-cli's default when no
  `--config` is given.

## Workflow

### Step 1: Read the Ticket

Use the Atlassian MCP or jira-cli to read the full ticket details:

```bash
# Run from the project root. --config pins jira-cli to the file Lisa's
# setup-jira-cli hook wrote, instead of the machine's own ~/.config/.jira.
# jira-cli resolves --config > JIRA_CONFIG_FILE > ~/.config/.jira/.config.yml,
# and a --config path that does not exist fails closed with "Missing
# configuration file." rather than silently using the default.
jira --config .lisa/jira-cli/.config.yml issue view <TICKET_ID>
```

If `.lisa/jira-cli/.config.yml` does not exist, drop `--config` to fall back to
the machine's own jira-cli config — but say so in your report rather than
letting the Lisa-written config go quietly unused.

Extract: title, description, acceptance criteria, components, labels, linked tickets.

### Step 2: Check for Existing Journey

Run the parser to see if a Validation Journey already exists:

```bash
python3 .claude/skills/jira-journey/scripts/parse-plan.py <TICKET_ID> 2>&1
```

If the parser succeeds and returns steps, the ticket already has a journey. Report this to the user and stop.

### Step 3: Analyze the Feature

Based on the ticket description and acceptance criteria, determine the appropriate verification approach. Stack-specific overrides provide the analysis logic.

### Step 4: Draft the Validation Journey

Compose the journey following the Validation Journey format with: Prerequisites, Steps (with evidence markers), and Assertions.

### Step 5: Present to User for Approval

Display the drafted Validation Journey to the user and ask for confirmation before appending it to the ticket.

### Step 6: Append to Ticket Description

After user approval, use the JIRA REST API to append the Validation Journey to the existing ticket description.

### Step 7: Verify

Run the parser again to confirm the journey was added correctly:

```bash
python3 .claude/skills/jira-journey/scripts/parse-plan.py <TICKET_ID>
```
