import path from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

const moduleUrl = pathToFileURL(
  path.resolve(".agents/skills/harness-parity-council/first-round.mjs")
).href;

const council = await import(moduleUrl);
const COUNCIL_TOPIC = "Compare Codex and Cursor parity surfaces";

describe("harness parity council first-round executor handling", () => {
  // Test hardened to kill mutant M001 (Risk Factor: Resilience / exception normalization)
  it("records executor exceptions as failed captures and continues", async () => {
    const synthesis = await council.collectFirstRoundResponses({
      topic: COUNCIL_TOPIC,
      runtimes: ["codex", "cursor"],
      probeRuntime(runtime: string) {
        return {
          ...council.buildFirstRoundInvocation({
            topic: COUNCIL_TOPIC,
            runtime,
          }),
          available: true,
          authMissing: false,
          helpProbe: { commandMissing: false, error: null },
          versionProbe: { commandMissing: false, error: null },
        };
      },
      async executor(invocation: { runtime: string }) {
        if (invocation.runtime === "codex") {
          throw new Error("codex executor failed");
        }

        return {
          exitStatus: 0,
          stdout: "cursor answered",
          stderr: "",
          timedOut: false,
          authMissing: false,
          error: null,
        };
      },
    });

    expect(synthesis.availableRuntimes).toEqual(["codex", "cursor"]);
    expect(synthesis.responseEvidence).toEqual([
      expect.objectContaining({
        runtime: "codex",
        status: "failed",
        outputText: "",
        error: {
          code: "EXECUTOR_EXCEPTION",
          message: "codex executor failed",
        },
      }),
      expect.objectContaining({
        runtime: "cursor",
        status: "responded",
        outputText: "cursor answered",
      }),
    ]);
    expect(synthesis.claudeSynthesisTemplate.openQuestions).toContain(
      "codex: explain failed"
    );
  });

  it("labels available runtimes as not executed when no executor is provided", async () => {
    const synthesis = await council.collectFirstRoundResponses({
      topic: COUNCIL_TOPIC,
      runtimes: ["codex"],
      probeRuntime(runtime: string) {
        return {
          ...council.buildFirstRoundInvocation({
            topic: COUNCIL_TOPIC,
            runtime,
            context: { repository: "lisa" },
          }),
          available: true,
          authMissing: false,
          helpProbe: { commandMissing: false, error: null },
          versionProbe: { commandMissing: false, error: null },
        };
      },
    });

    expect(synthesis.responseEvidence).toEqual([
      expect.objectContaining({
        runtime: "codex",
        status: "not_executed",
        outputText: expect.stringContaining(
          "runtime consultation was not executed"
        ),
      }),
    ]);
    expect(synthesis.claudeSynthesisTemplate.openQuestions).toContain(
      "codex: explain not executed"
    );
  });
});
