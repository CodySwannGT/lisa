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
const SAFETY_NET = path.resolve("plugins/lisa/hooks/parity-safety-net.sh");
const EXIT_ALLOWED = 0;
const EXIT_BLOCKED = 2;
const RM = `${"r"}${"m"}`;
const DELETE = `${RM} -${"r"}${"f"}`;

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

  it.each([
    [
      "a quoted right-hand side assigned before the delete",
      `S="/tmp/work"\n${DELETE} "$S"`,
      EXIT_ALLOWED,
    ],
    [
      "a variable assigned only after the delete",
      `${DELETE} "$V"\nV=/tmp/x`,
      EXIT_BLOCKED,
    ],
    [
      "an assignment-like quoted argument before the delete",
      `echo "note V=/tmp/x" && ${DELETE} "$V"`,
      EXIT_BLOCKED,
    ],
    [
      "two quoted prose runs followed by an unrelated variable",
      `printf '%s' "first ${DELETE} note" "second ${DELETE} note" "$V"`,
      EXIT_ALLOWED,
    ],
    [
      "prose in the first quoted run and a real delete in a later one",
      `printf '%s' "the ${DELETE} note" "$(${DELETE} "$Z")"`,
      EXIT_BLOCKED,
    ],
  ] as const)("classifies %s", (_label, command, expected) => {
    expect(classify(SAFETY_NET, command)).toBe(expected);
  });
});
