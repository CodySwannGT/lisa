# Plan: Horn Sound Script

## Summary

Write a short Python script that generates a horn sound as a WAV file, play it using macOS `afplay`, then delete the script and generated WAV file.

## Context

- **Branch**: `fix/expo-knip-and-tsconfig` (non-protected, no changes to commit)
- **Platform**: macOS (Darwin) with `afplay` and Python 3 `wave`/`struct`/`math` modules available
- This is a throwaway task — no commits, no PRs, no tests needed

## Implementation

### Step 1: Write the script

Create `horn.py` in the scratchpad directory (`/private/tmp/claude-501/-Users-cody-workspace-lisa/0819b239-c4e5-476c-bd6c-60c941d40357/scratchpad/horn.py`).

The script will:
1. Use Python's `wave`, `struct`, and `math` modules (no dependencies)
2. Generate a ~1.5 second horn-like sound by layering a fundamental frequency (~220 Hz) with harmonics and applying an amplitude envelope (attack + sustain + decay)
3. Write it to `horn.wav` in the same scratchpad directory
4. Print "Horn sound generated" on completion

### Step 2: Run the script and play the sound

```bash
python3 /private/tmp/.../scratchpad/horn.py && afplay /private/tmp/.../scratchpad/horn.wav
```

### Step 3: Delete everything

```bash
rm /private/tmp/.../scratchpad/horn.py /private/tmp/.../scratchpad/horn.wav
```

## Task List

Create tasks using TaskCreate:

1. **Write and run horn sound script** — Write `horn.py`, execute it, play the WAV with `afplay`
2. **Delete the script and WAV file** — Remove `horn.py` and `horn.wav` from the scratchpad
3. **Archive the plan** — Create `plans/completed/horn-sound-script/`, rename and move this plan there, read session IDs, move `~/.claude/tasks/<session-id>` directories into `plans/completed/horn-sound-script/tasks`

## Verification

- **Sound plays**: `afplay` exits 0 and audible horn sound is heard
- **Cleanup**: `ls` of the scratchpad confirms both files are deleted

## Sessions
