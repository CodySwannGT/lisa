/**
 * Executable contract for the unconfigured Node-suite fallback report.
 *
 * The registry is imported statically so the mutation resolver includes this
 * suite. The assertion then resets Vitest's module cache and imports the
 * registry inside the test, after Stryker activates a mutant. An assertion
 * over only the already-imported module instance observes pre-activation data.
 * @module tests/unit/scripts/lisa-gates-test-node-fallback
 */
import { describe, expect, it, vi } from "vitest";

import * as gates from "../../../all/copy-overwrite/scripts/lisa-gates.mjs";

/** Exact supervised fallback reported to an unconfigured consumer. */
const SUPERVISED_NODE_FALLBACK =
  "lisa-test-run --profile <stack-or-node> --adapter direct -- " +
  "node <lisa>/scripts/lisa-test-node.mjs";

describe("the unconfigured Node-suite fallback report", () => {
  it("reports the executable supervised direct-runner contract", async () => {
    const imported = gates.HARDCODED_INVOCATIONS.find(
      entry => entry.job === "test_node_suites"
    );
    vi.resetModules();
    const activated =
      await import("../../../all/copy-overwrite/scripts/lisa-gates.mjs");
    const findings = activated.unconfiguredAt({
      gates: {},
      moment: "pull-request",
      gate: "test-node-suites",
      surface: "quality-workflow",
    });

    expect(imported?.command).toBe(SUPERVISED_NODE_FALLBACK);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.gate).toBe("test-node-suites");
    expect(findings[0]?.command).toBe(SUPERVISED_NODE_FALLBACK);
  });
});
