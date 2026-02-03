# Plan: Play Horn Sound Script

## Summary

Write a temporary shell script that plays a horn sound using macOS `afplay` and a system sound file, run it to verify it works, then delete the script.

## Branch

Current branch: `fix/expo-knip-and-tsconfig` (non-protected). No new branch needed for this throwaway task.

## Steps

1. **Create the script** — Write a bash script `play-horn.sh` in the project root that uses `afplay` to play a system sound (e.g., `/System/Library/Sounds/Funk.aiff` or similar horn-like sound available on macOS).
2. **Run the script** — Execute it and verify audible output.
3. **Delete the script** — Remove `play-horn.sh` from disk.

## Files

| Action | File |
|--------|------|
| Create | `play-horn.sh` |
| Delete | `play-horn.sh` |

## Task List

Create tasks using TaskCreate:

1. **Write and run horn sound script** — Create `play-horn.sh`, execute it, verify sound plays.
2. **Delete the script** — Remove `play-horn.sh` after verification.
3. **Archive the plan** — After all tasks complete:
   - Create folder `play-horn-sound` in `./plans/completed`
   - Rename this plan to a name befitting the actual plan contents
   - Move it into `./plans/completed/play-horn-sound`
   - Read the session IDs from `./plans/completed/play-horn-sound`
   - For each session ID, move `~/.claude/tasks/<session-id>` to `./plans/completed/play-horn-sound/tasks`

## Skills

- `/git:commit` for committing the plan archive

## Verification

- **Sound plays**: Audible confirmation when script runs (manual check)
- **Script deleted**: `ls play-horn.sh` returns "No such file or directory"

## Sessions
| b9690aa1-67f7-4198-9ae8-b3aaf060e979 | 2026-02-02T23:58:50Z | plan |
