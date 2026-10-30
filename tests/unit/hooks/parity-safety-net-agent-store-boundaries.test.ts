/**
 * Additional store-component and uncertainty boundaries for #4544. Every shell
 * string below is JSON input to the hook, never a command to execute. No target
 * store is created, opened, copied or enumerated by this test harness.
 * @module tests/unit/hooks/parity-safety-net-agent-store-boundaries
 */
import * as path from "node:path";

import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";

const HOOKS = [
  "plugins/src/base/hooks/parity-safety-net.sh",
  "plugins/lisa/hooks/parity-safety-net.sh",
].map(file => path.resolve(file));

const STORES = [
  "cat ~/.codex/auth.json.bak",
  "cat ~/.codex/auth.toml",
  "cat ~/.codex/auth.md",
  "cat ~/.claude/.credentials.json",
  "cat ~/.claude/credentials/private-cache",
  "cat ~/.claude/tokens/session.json",
  "cat ~/.codex/auth/cache.bin",
  "cat ~/.cursor/state/auth.token",
  "cat ~/.gemini/oauth_creds.json",
  "cat ~/.copilot/access_token.json",
  "cat ~/.antigravity/refresh-token.json",
  "cat ~/.codex/artifacts/auth.json",
  "cat ~/.claude/artifacts/.credentials.json",
  "cat ~/.codex/artifacts/report.md ~/.codex/auth.json",
  "cat ~/.codex/auth.json ~/.codex/artifacts/report.md",
];

const UNCERTAIN = [
  "cat ~/.codex/$STORE",
  "cat ~/.claude/${STORE}",
  "cat ~/.cursor/cache/$STORE/auth.json",
  "cat ~/.copilot/*",
  "cat ~/.gemini/?.json",
  "cat ~/.antigravity/[at]*",
  "cat ~/.codex/artifacts/$NAME.md",
];

const DESCRIPTIVE = [
  "cat ~/.codex/artifacts/research/auth-design.json",
  "cat ~/.claude/research/authorization-notes.txt",
  "cat ~/.cursor/notes/token-budget-notes.yaml",
  "cat ~/.copilot/artifacts/credentials-policy.toml",
  "cat ~/.gemini/research/operator-resume-authority-v1.md",
];

/**
 * Classify only: Bash argv names the hook, not the proposed input.
 * @param hook Actual canonical or emitted hook path.
 * @param command Synthetic proposed command supplied as JSON data.
 * @returns The actual bounded classifier child outcome.
 */
function classify(hook: string, command: string) {
  return boundedSpawnSync({
    label: "agent-store component boundary",
    command: "/bin/bash",
    args: [hook],
    input: JSON.stringify({
      tool_name: "Bash",
      tool_input: { command },
      cwd: process.cwd(),
    }),
    env: { ...process.env },
  });
}

describe.each(HOOKS)("agent-store precise boundaries: %s", hook => {
  it.each(STORES)("retains-store-component: %s", command => {
    const result = classify(hook, command);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain(
      "coding-agent or package-registry credential store"
    );
  });

  it.each(UNCERTAIN)("refuses-unresolved-agent-target: %s", command => {
    const result = classify(hook, command);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("credential directory");
  });

  it.each(DESCRIPTIVE)("allows-descriptive-component: %s", command => {
    const result = classify(hook, command);
    expect(result.status).toBe(0);
    expect(result.stderr).not.toContain("credential store");
  });
});
