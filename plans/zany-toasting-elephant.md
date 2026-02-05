# Plan: Play Horn Sound Script

**Branch:** `feat/add-task-spec-to-plan-rules`
**PR:** https://github.com/CodySwannGT/lisa/pull/139

## Overview

Create a short script that plays a horn sound on macOS, run it to verify, then delete the script. Since macOS doesn't have a built-in horn sound file, we'll generate a horn-like tone using Python's `wave` and `struct` modules (both stdlib — no dependencies needed) and play it with `afplay`.

## Approach

1. Write a Python script (`scripts/horn.py`) that:
   - Generates a horn-like tone (low frequency ~200Hz with harmonics, ~1 second duration)
   - Writes it to a temporary WAV file
   - Plays it via `afplay`
   - Cleans up the WAV file on exit

2. Run the script to verify it produces sound

3. Delete the script file

## Files

- `scripts/horn.py` — created then deleted (net zero changes)

## Task List (TaskCreate)

Create the following tasks:

1. **Write the horn sound script**
   - subject: "Write horn sound Python script"
   - activeForm: "Writing horn sound Python script"
   - Type: Task
   - Description: Create `scripts/horn.py` that generates a horn-like WAV tone using Python stdlib (`wave`, `struct`, `math`) and plays it with `afplay`
   - Verification: `python3 scripts/horn.py` — should produce audible horn sound and exit 0
   - Skills: `/coding-philosophy`
   - metadata: `{ "plan": "play-horn-sound-script", "type": "task", "verification": { "type": "manual-check", "command": "python3 scripts/horn.py", "expected": "Audible horn sound, exit code 0" } }`

2. **Run the horn sound script**
   - subject: "Run the horn sound script"
   - activeForm: "Running the horn sound script"
   - Type: Task
   - Description: Execute `python3 scripts/horn.py` and confirm it plays a sound
   - Verification: `python3 scripts/horn.py && echo "success"` — prints "success"
   - Skills: `/coding-philosophy`
   - blockedBy: task 1
   - metadata: `{ "plan": "play-horn-sound-script", "type": "task", "verification": { "type": "manual-check", "command": "python3 scripts/horn.py && echo success", "expected": "Audible horn sound, prints success" } }`

3. **Delete the horn sound script**
   - subject: "Delete the horn sound script"
   - activeForm: "Deleting the horn sound script"
   - Type: Task
   - Description: Remove `scripts/horn.py` after successful execution
   - Verification: `test ! -f scripts/horn.py && echo "deleted"` — prints "deleted"
   - Skills: `/coding-philosophy`
   - blockedBy: task 2
   - metadata: `{ "plan": "play-horn-sound-script", "type": "task", "verification": { "type": "manual-check", "command": "test ! -f scripts/horn.py && echo deleted", "expected": "prints deleted" } }`

4. **Review code with CodeRabbit**
   - subject: "Review code with CodeRabbit"
   - activeForm: "Reviewing code with CodeRabbit"
   - Type: Task
   - Description: Run `/coderabbit:review` on changes. Since the net change is zero (file created then deleted), this may be a no-op.
   - blockedBy: task 3
   - metadata: `{ "plan": "play-horn-sound-script", "type": "task", "skills": ["/coderabbit:review"] }`

5. **Review code with local code review**
   - subject: "Review code with local code review"
   - activeForm: "Reviewing code with local code review"
   - Type: Task
   - Description: Run `/project-local-code-review` on changes
   - blockedBy: task 3
   - metadata: `{ "plan": "play-horn-sound-script", "type": "task", "skills": ["/project-local-code-review"] }`

6. **Implement valid review suggestions**
   - subject: "Implement valid review suggestions"
   - activeForm: "Implementing review suggestions"
   - Type: Task
   - Description: Apply any valid suggestions from CodeRabbit and local code review
   - blockedBy: tasks 4, 5
   - metadata: `{ "plan": "play-horn-sound-script", "type": "task" }`

7. **Simplify implemented code**
   - subject: "Simplify implemented code with code simplifier"
   - activeForm: "Simplifying code"
   - Type: Task
   - Description: Run code simplifier agent on any remaining changes
   - blockedBy: task 6
   - metadata: `{ "plan": "play-horn-sound-script", "type": "task" }`

8. **Update/add/remove tests**
   - subject: "Update tests if needed"
   - activeForm: "Updating tests"
   - Type: Task
   - Description: No tests needed — this is a throwaway script with zero net file changes
   - blockedBy: task 6
   - metadata: `{ "plan": "play-horn-sound-script", "type": "task" }`

9. **Update documentation**
   - subject: "Update documentation if needed"
   - activeForm: "Updating documentation"
   - Type: Task
   - Description: No documentation updates needed — zero net file changes
   - blockedBy: task 6
   - metadata: `{ "plan": "play-horn-sound-script", "type": "task" }`

10. **Verify all task verification metadata**
    - subject: "Verify all task verification metadata"
    - activeForm: "Verifying task metadata"
    - Type: Task
    - Description: Run each task's verification command and confirm expected output
    - blockedBy: task 6
    - metadata: `{ "plan": "play-horn-sound-script", "type": "task" }`

11. **Archive the plan**
    - subject: "Archive the plan"
    - activeForm: "Archiving the plan"
    - Type: Task
    - Description:
      - Create folder `./plans/completed/play-horn-sound-script`
      - Rename this plan to match its contents and move to `./plans/completed/play-horn-sound-script/`
      - Read session IDs from `./plans/completed/play-horn-sound-script/`
      - For each session ID, move `~/.claude/tasks/<session-id>` to `./plans/completed/play-horn-sound-script/tasks`
      - Update any "in_progress" tasks to "completed"
      - Commit changes
      - Push changes to PR #139
    - blockedBy: all other tasks
    - metadata: `{ "plan": "play-horn-sound-script", "type": "task" }`

## Verification

- Horn sound is audible when script runs
- Script is deleted after execution
- `git status` shows no untracked `scripts/horn.py`

## Sessions
| 735799c3-e210-4831-8ccf-1f13ecf8ca52 | 2026-02-03T15:52:30Z | plan |
| 721ceb02-5896-4abe-91c0-f4ffd55d8453 | 2026-02-03T16:11:58Z | implement |
| 5dbba6ba-2af7-4bc5-894d-ddbb17d98766 | 2026-02-03T16:17:06Z | plan |
| cf8d8d28-17b1-41ff-bf90-8af5c1a81d8a | 2026-02-03T17:00:53Z | implement |
| b90bc57f-322f-4258-afe1-47232af02f74 | 2026-02-03T17:43:36Z | plan |
| d85c2941-bfe7-4eef-a8e3-24d473e33647 | 2026-02-03T18:14:39Z | implement |
| 331cac60-90e0-4edc-aeb4-bfa5b34edb06 | 2026-02-03T18:20:39Z | implement |
| 501cb606-88b3-4719-9ad7-e76f5055e003 | 2026-02-03T20:09:33Z | plan |
| 83cfb592-8503-4263-90f0-cacdbb697fcb | 2026-02-03T20:58:19Z | plan |
| e06b4735-1e60-4ceb-a935-14528b5600c1 | 2026-02-03T21:28:38Z | implement |
| 361bc5b7-8f1d-4db5-b06a-1be2847c76fe | 2026-02-04T00:07:06Z | plan |
| cc26846e-84e3-46a3-a118-dbaff58d62aa | 2026-02-05T11:28:00Z | implement |
| 70fa984e-f0ff-4c93-a80b-2ce43a2152b0 | 2026-02-05T15:45:27Z | plan |
