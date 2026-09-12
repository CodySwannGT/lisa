/**
 * Reference behavior for split grammar the managed-file guard refuses to infer.
 * @module tests/unit/hooks/env-split-string-reference
 */
import { expect, it } from "vitest";

import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";

const MANAGED = "scripts/lisa-hooks/block-no-verify.sh";

it("checks split-string edge semantics against GNU env when installed", ({
  skip,
}) => {
  const version = boundedSpawnSync({
    label: "GNU env availability",
    command: "/usr/bin/env",
    args: ["--version"],
  });
  if (!version.stdout.includes("GNU coreutils")) skip();
  // Only printf executes: these cases observe GNU's argv without writing
  // the named managed path or guessing environment interpolation.
  for (const [splitString, expected] of [
    [String.raw`tee\_${MANAGED}`, `tee|${MANAGED}|`],
    [String.raw`tee \c ${MANAGED}`, "tee|"],
    [`tee # ignored ${MANAGED}`, "tee|"],
    [String.raw`tee \# ${MANAGED}`, `tee|#|${MANAGED}|`],
    ["tee ${SPLIT_TARGET}", `tee|${MANAGED}|`],
  ]) {
    const result = boundedSpawnSync({
      label: "GNU env split-string reference",
      command: "/usr/bin/env",
      args: ["-vS", `/usr/bin/printf '%s|' ${splitString}`],
      env: { ...process.env, SPLIT_TARGET: MANAGED },
    });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe(expected);
  }
});
