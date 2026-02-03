# Play Horn Sound Script

## Summary

Create a temporary bash script that plays a horn sound using macOS built-in audio, run it to verify it works, then delete the script. This is an ephemeral task with no lasting codebase changes.

## Branch Strategy

Currently on `feat/add-task-spec-to-plan-rules` (non-protected branch) with open PR #139 to `main`. No commits needed — the script is created, run, and deleted without any git changes.

## Skills to Use

- `/coding-philosophy`

## Implementation Plan

1. **Create a bash script** in the scratchpad directory (`/private/tmp/claude-501/-Users-cody-workspace-lisa/68a7b384-a3cc-4e42-9077-c40c76e70232/scratchpad/play-horn.sh`) that uses `afplay` to play the macOS system sound `Hero.aiff` from `/System/Library/Sounds/` — the most horn-like built-in sound.
2. **Run the script** to play the sound.
3. **Delete the script** immediately after execution.

### Reusable Code / Existing Patterns

No existing code to reuse — this is a standalone ephemeral script.

### Third-Party Libraries / Versions

None needed. Uses macOS built-in `afplay` command and system sound files.

## Task List

Create the following tasks using `TaskCreate`. Tasks should be executed sequentially.

### Task 1: Create, run, and delete horn sound script

- **subject**: "Create, run, and delete horn sound script"
- **activeForm**: "Creating, running, and deleting horn sound script"
- **description**:

**Type:** Task

**Description:** Create a bash script that plays a horn-like sound using macOS system sounds, execute it to verify audio plays, then delete the script.

**Acceptance Criteria:**
- [ ] Script is created in the scratchpad directory
- [ ] Script plays a horn-like sound when executed
- [ ] Script is deleted after execution
- [ ] No files remain after task completion

**Relevant Research:** macOS provides system sounds at `/System/Library/Sounds/`. `afplay` can play `.aiff` files. `Hero.aiff` is the most horn-like system sound available.

**Skills to Invoke:** `/coding-philosophy`

**Implementation Details:**
- Create file: `scratchpad/play-horn.sh` with content:
  ```bash
  #!/bin/bash
  afplay /System/Library/Sounds/Hero.aiff
  ```
- Make executable: `chmod +x play-horn.sh`
- Run: `bash play-horn.sh`
- Delete: `rm play-horn.sh`

**Testing Requirements:** N/A (ephemeral script)

**Verification:**
- Type: `manual-check`
- Command: `ls /private/tmp/claude-501/-Users-cody-workspace-lisa/68a7b384-a3cc-4e42-9077-c40c76e70232/scratchpad/play-horn.sh 2>&1`
- Expected: `No such file or directory` (confirming deletion)

**Learnings:** On task completion, use `TaskUpdate` to save discoveries: `metadata: { learnings: ["Learning 1", ...] }`

**Metadata:**
```json
{
  "plan": "play-horn-sound-script",
  "type": "task",
  "skills": ["/coding-philosophy"],
  "verification": {
    "type": "manual-check",
    "command": "ls /private/tmp/claude-501/-Users-cody-workspace-lisa/68a7b384-a3cc-4e42-9077-c40c76e70232/scratchpad/play-horn.sh 2>&1",
    "expected": "No such file or directory"
  }
}
```

### Task 2: Update/add/remove tests

N/A — no tests needed for an ephemeral script with no codebase changes.

### Task 3: Update/add/remove documentation

N/A — no documentation changes needed for an ephemeral script.

### Task 4: Archive the plan

- **subject**: "Archive play-horn-sound-script plan"
- **activeForm**: "Archiving play-horn-sound-script plan"
- **description**:

**Type:** Task

**Description:** Archive the plan after all other tasks are completed.

**Acceptance Criteria:**
- [ ] Create folder `play-horn-sound-script` in `./plans/completed`
- [ ] Rename this plan to `play-horn-sound-script.md`
- [ ] Move it into `./plans/completed/play-horn-sound-script/`
- [ ] Read session IDs from `./plans/completed/play-horn-sound-script/play-horn-sound-script.md`
- [ ] For each session ID, move `~/.claude/tasks/<session-id>` directory to `./plans/completed/play-horn-sound-script/tasks`

**Relevant Research:** Standard plan archival process per plan mode rules.

**Skills to Invoke:** `/coding-philosophy`

**Implementation Details:**
- `mkdir -p ./plans/completed/play-horn-sound-script`
- `mv ./plans/greedy-toasting-stearns.md ./plans/completed/play-horn-sound-script/play-horn-sound-script.md`
- Read session IDs from the `## Sessions` section of the plan file
- Move task directories accordingly

**Testing Requirements:** N/A

**Verification:**
- Type: `manual-check`
- Command: `ls ./plans/completed/play-horn-sound-script/play-horn-sound-script.md`
- Expected: File exists at that path

**Learnings:** On task completion, use `TaskUpdate` to save discoveries: `metadata: { learnings: ["Learning 1", ...] }`

**Metadata:**
```json
{
  "plan": "play-horn-sound-script",
  "type": "task",
  "skills": ["/coding-philosophy"],
  "verification": {
    "type": "manual-check",
    "command": "ls ./plans/completed/play-horn-sound-script/play-horn-sound-script.md",
    "expected": "File exists"
  }
}
```

## Sessions
| dfab6b2b-6cf6-48ed-88bb-7f85c2f647d8 | 2026-02-03T16:00:00Z | implementation |
