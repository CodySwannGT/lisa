# Play Horn Sound Script

## Summary

Create a Python script that generates a horn-like sound as a WAV file, play it using macOS `afplay`, then delete both the script and the generated WAV file.

## Approach

1. Write a Python script (`horn.py`) in the scratchpad directory that:
   - Uses the `wave` and `struct` stdlib modules to generate a WAV file
   - Creates a horn-like tone by combining multiple sine wave harmonics (fundamental + overtones) with an amplitude envelope
   - Saves to `horn.wav` in the scratchpad directory
2. Run the script with `python3 horn.py` to generate the WAV
3. Play it with `afplay horn.wav`
4. Delete both `horn.py` and `horn.wav`

## Tools & Dependencies

- **python3** (available at `/Users/cody/miniconda3/bin/python3`) with stdlib `wave`, `struct`, `math` modules
- **afplay** (available at `/usr/bin/afplay`) - macOS audio player

## Files

- Script: `/private/tmp/claude-501/-Users-cody-workspace-lisa/e157b597-5e7a-4b02-a548-74a78299a23c/scratchpad/horn.py`
- Audio: `/private/tmp/claude-501/-Users-cody-workspace-lisa/e157b597-5e7a-4b02-a548-74a78299a23c/scratchpad/horn.wav`

No project files are modified.

## Branch & PR

Already on `fix/expo-knip-and-tsconfig`. No commits needed — this task produces no persistent changes.

## Skills

No skills needed — this is a standalone ephemeral task.

## Verification

1. Script runs without errors
2. `afplay` plays audible horn sound
3. Both files are confirmed deleted (`ls` returns no matches)

## Sessions

<!-- Auto-maintained by track-plan-sessions.sh -->
| Session ID | First Seen | Phase |
|------------|------------|-------|
| b9690aa1-67f7-4198-9ae8-b3aaf060e979 | 2026-02-02T23:58:34Z | implement |
| 0819b239-c4e5-476c-bd6c-60c941d40357 | 2026-02-03T00:01:48Z | implement |
| e867ba9e-7d17-4027-b2b9-f3ea95c20b52 | 2026-02-03T00:07:15Z | plan |
| b7f38936-9c17-48fd-8f31-a32af94b308e | 2026-02-03T00:16:18Z | implement |
