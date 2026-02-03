# Play Horn Sound Script

## Summary

Write a temporary script that plays a horn sound using macOS system audio, run it, then delete it.

## Approach

1. Create a script at the scratchpad directory that uses macOS `afplay` with a system sound (or `say` command as fallback)
2. Run the script
3. Delete the script

Since macOS doesn't ship a horn sound file by default, we'll use `afplay` with one of the built-in system sounds (e.g., `/System/Library/Sounds/Blow.aiff` which is the closest to a horn) or generate a tone using `say` or `osascript`.

## Tasks

1. Create a bash script in the scratchpad directory that plays a horn-like sound
2. Execute the script
3. Delete the script

## Verification

- Confirm the sound plays (audible output)
- Confirm the script file no longer exists after deletion

## Skills

No skills needed - this is a simple bash operation.

## Sessions

<!-- Auto-maintained by track-plan-sessions.sh -->
| Session ID | First Seen | Phase |
|------------|------------|-------|
| 4ed5f6da-9361-422f-8e3a-ee2e8265afe3 | 2026-02-02T23:48:13Z | plan |
| d90208b2-6569-4682-9a37-80d6f607126c | 2026-02-02T23:52:21Z | plan |
| e157b597-5e7a-4b02-a548-74a78299a23c | 2026-02-02T23:53:02Z | plan |
