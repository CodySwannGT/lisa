/**
 * Regression coverage for shell shapes that are valid but easy for a text
 * guard to misclassify.
 *
 * These cases share one cause: the parser must preserve shell ordering and
 * quote context instead of treating every matching word as equivalent prose.
 * @module tests/unit/hooks/generated-shell-parsing-regressions
 */
import path from "node:path";

import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";

const BLOCK_NO_VERIFY = path.resolve("plugins/lisa/hooks/block-no-verify.sh");
const EXIT_ALLOWED = 0;

/**
 * Classify a proposed Bash command without executing it.
 * @param hook - Guard script to invoke.
 * @param command - Proposed shell command.
 * @returns The guard process's exit status.
 */
const classify = (hook: string, command: string): number | null =>
  boundedSpawnSync({
    label: path.basename(hook),
    command: "/bin/bash",
    args: [hook],
    input: JSON.stringify({ tool_name: "Bash", tool_input: { command } }),
  }).status;

describe("generated shell parsing regressions", () => {
  it("recognizes an explicitly empty heredoc delimiter", () => {
    const command =
      "gh issue create --body-file - <<''\n" +
      "Mention --no-verify in prose.\n\n";

    expect(classify(BLOCK_NO_VERIFY, command)).toBe(EXIT_ALLOWED);
  });
});
