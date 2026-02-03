# Play Horn Sound Script

## Summary

Create a temporary script that plays a horn sound using macOS `afplay` and the built-in system sounds, run it, then delete it.

## Approach

1. Write a short bash script to the scratchpad directory that plays a horn/alert sound using macOS `afplay` with a system sound file (e.g., `/System/Library/Sounds/Funk.aiff` or similar brass-like sound)
2. Execute the script
3. Delete the script

## Implementation Details

- **Script location**: `/private/tmp/claude-501/-Users-cody-workspace-lisa/2863632b-a243-458b-9c3c-167efee01bf6/scratchpad/horn.sh`
- **Sound file**: Use `/System/Library/Sounds/Funk.aiff` (closest to a horn among macOS system sounds) or `Blow.aiff` if available
- **Cleanup**: Remove the script after execution

## Skills Used

- None required (simple bash execution)

## Verification

- Audible horn sound plays on the machine
- Script file no longer exists after deletion: `ls /private/tmp/claude-501/-Users-cody-workspace-lisa/2863632b-a243-458b-9c3c-167efee01bf6/scratchpad/horn.sh` should return "No such file"

## Tasks

1. Create and run horn sound script
2. Delete the script
3. Archive this plan

## Sessions
| 4ed5f6da-9361-422f-8e3a-ee2e8265afe3 | 2026-02-02T23:48:00Z | plan |
