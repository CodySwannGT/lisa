# Worker transcript fixtures

Sanitized Claude Code (2.1.319) background-session transcripts, in the JSONL
shape written to `<config dir>/projects/<encoded cwd>/<session id>.jsonl`.
The entry shapes were captured from real `claude --bg` sessions; ids, paths,
names and hook text were replaced with placeholders.

- `unknown-command.jsonl`: the first prompt was a slash command Claude Code
  did not know (`system` entries `Unknown command: /…` and
  `Args from unknown skill: …`), and there is no assistant turn.
- `prompt-blocked.jsonl`: a `UserPromptSubmit` hook refused the first prompt
  (a `system` entry with `promptSubmitEnding.ending.kind: "blocked_by_hook"`),
  and there is no assistant turn.
- `healthy.jsonl`: the first prompt ran and the assistant answered.
