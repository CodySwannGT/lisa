import path from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

const moduleUrl = pathToFileURL(
  path.resolve(".agents/skills/harness-parity-council/first-round.mjs")
).href;

const council = await import(moduleUrl);
const COUNCIL_TOPIC = "Compare Codex and Cursor parity surfaces";
const REVIEW_TOPIC = "Review Codex parity for install-time hooks";

describe("harness parity council first-round flow", () => {
  it("builds a structured prompt with Lisa-specific guardrails and sections", () => {
    const prompt = council.buildFirstRoundPrompt({
      topic: REVIEW_TOPIC,
      runtime: "codex",
      context: {
        repository: "lisa",
        sourceArtifacts: ["PRD #721", "Issue #770"],
      },
    });

    expect(prompt).toContain("Operate in read-only advisory mode.");
    expect(prompt).toContain(
      "Do not edit files, install dependencies, commit, push, open PRs, or suggest destructive commands."
    );
    expect(prompt).toContain("Runtime under consultation: codex.");
    expect(prompt).toContain(REVIEW_TOPIC);
    expect(prompt).toContain("- Repository: lisa");
    expect(prompt).toContain("- PRD #721");
    expect(prompt).toContain("1. Supported native surfaces for this feature");
    expect(prompt).toContain(
      "8. Questions Claude should resolve before implementation"
    );
  });

  it("normalizes captured output and parses JSON payloads when present", () => {
    const normalized = council.normalizeCouncilOutput(
      '\u001b[32m{"answer":"ok"}\u001b[0m\r\n\r\n'
    );

    expect(normalized).toBe('{"answer":"ok"}');
    expect(council.parseCouncilOutput(normalized)).toEqual({
      answer: "ok",
    });
  });

  it("redacts token-like material and annotates unsafe downstream suggestions", () => {
    const capture = council.normalizeFirstRoundCapture({
      invocation: council.buildFirstRoundInvocation({
        topic: REVIEW_TOPIC,
        runtime: "codex",
      }),
      probe: {
        ...council.buildFirstRoundInvocation({
          topic: REVIEW_TOPIC,
          runtime: "codex",
        }),
        available: true,
        authMissing: false,
        helpProbe: { commandMissing: false, error: null },
        versionProbe: { commandMissing: false, error: null },
      },
      result: {
        exitStatus: 0,
        stdout:
          '\u001b[32m{"summary":"token=gho_abcdefghijklmnopqrstuvwxyz","nextStep":"Run npm install lisa-internal in the host project"}\u001b[0m\r\n',
        stderr:
          "Use git push origin codex/test after editing template output.\n",
        timedOut: false,
        authMissing: false,
        error: null,
      },
    });

    expect(capture.outputText).not.toContain("gho_abcdefghijklmnopqrstuvwxyz");
    expect(capture.outputText).toContain("[REDACTED]");
    expect(capture.outputText).toContain(
      "[unsafe-runtime-suggestion: maintainer review required]"
    );
    expect(capture.parsedOutput).toEqual({
      summary: "token=[REDACTED]",
      nextStep:
        "[unsafe-runtime-suggestion: maintainer review required] Run npm install lisa-internal in the host project",
    });
    expect(capture.stderrText).toContain(
      "[unsafe-runtime-suggestion: maintainer review required] Use git push origin codex/test after editing template output."
    );
  });

  it("classifies executor error payloads without exit status as failed", () => {
    const invocation = council.buildFirstRoundInvocation({
      topic: REVIEW_TOPIC,
      runtime: "codex",
    });
    const probe = {
      ...invocation,
      available: true,
      authMissing: false,
      helpProbe: { commandMissing: false, error: null },
      versionProbe: { commandMissing: false, error: null },
    };

    const capture = council.normalizeFirstRoundCapture({
      invocation,
      probe,
      result: {
        stdout: "",
        stderr: "",
        timedOut: false,
        authMissing: false,
        error: { code: "ENOENT", message: "no such file" },
      },
    });

    expect(capture.status).toBe("failed");
    expect(capture.error).toEqual({
      code: "ENOENT",
      message: "no such file",
    });

    const synthesis = council.buildFirstRoundSynthesisInput({
      topic: REVIEW_TOPIC,
      captures: [capture],
    });
    expect(synthesis.claudeSynthesisTemplate.openQuestions).toContain(
      "codex: explain failed"
    );
  });

  it("collects stable synthesis inputs across available and unavailable runtimes", async () => {
    const synthesis = await council.collectFirstRoundResponses({
      topic: COUNCIL_TOPIC,
      context: {
        repository: "lisa",
        sourceArtifacts: ["Issue #770"],
      },
      runtimes: ["codex", "cursor"],
      probeRuntime(runtime: string) {
        if (runtime === "cursor") {
          return {
            ...council.buildFirstRoundInvocation({
              topic: COUNCIL_TOPIC,
              runtime,
              context: { repository: "lisa" },
            }),
            available: false,
            authMissing: null,
            helpProbe: {
              commandMissing: true,
              error: { code: "ENOENT", message: "cursor-agent not found" },
            },
            versionProbe: {
              commandMissing: true,
              error: { code: "ENOENT", message: "cursor-agent not found" },
            },
          };
        }

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
      async executor(invocation: { runtime: string }) {
        if (invocation.runtime !== "codex") {
          throw new Error("unexpected runtime");
        }

        return {
          exitStatus: 0,
          stdout: JSON.stringify({
            supported: ["read-only sandbox", "json output"],
            risks: ["naming drift"],
          }),
          stderr: "",
          timedOut: false,
          authMissing: false,
          error: null,
        };
      },
    });

    expect(synthesis.availableRuntimes).toEqual(["codex"]);
    expect(synthesis.unavailableRuntimes).toEqual([
      {
        runtime: "cursor",
        reason: "command-missing",
        authMissing: null,
      },
    ]);
    expect(synthesis.responseEvidence).toEqual([
      expect.objectContaining({
        runtime: "codex",
        status: "responded",
        parsedOutput: {
          supported: ["read-only sandbox", "json output"],
          risks: ["naming drift"],
        },
      }),
      expect.objectContaining({
        runtime: "cursor",
        status: "unavailable",
        outputText: "",
      }),
    ]);
    expect(synthesis.claudeSynthesisTemplate.openQuestions).toContain(
      "cursor: explain unavailable"
    );
  });

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

  it("supports the documented runtime filter and dry-run planning output", () => {
    const parsed = council.parseCouncilCliArgs([
      COUNCIL_TOPIC,
      "--runtime",
      "codex",
      "--dry-run",
      "--second-round",
    ]);

    expect(parsed).toEqual({
      topic: COUNCIL_TOPIC,
      runtime: "codex",
      secondRound: true,
      dryRun: true,
      writeMode: null,
      sanitizedSummary: null,
    });

    const dryRun = council.buildCouncilDryRunPlan(parsed);
    expect(dryRun.mode).toBe("dry-run");
    expect(dryRun.runtimeFilter).toBe("codex");
    expect(dryRun.firstRound).toHaveLength(1);
    expect(dryRun.firstRound[0]).toEqual(
      expect.objectContaining({
        runtime: "codex",
        command: "codex",
      })
    );
    expect(dryRun.secondRound?.invocations).toHaveLength(1);
    expect(dryRun.secondRound?.sanitizedSummary).toContain("TODO");
  });

  it("builds second-round critique prompts from Claude's sanitized summary", () => {
    const critique = council.buildSecondRoundSynthesisInput({
      topic: COUNCIL_TOPIC,
      sanitizedSummary:
        "Codex and Cursor both support read-only advisory mode, but naming may drift.",
      runtimes: ["codex"],
    });

    expect(critique.availableRuntimes).toEqual(["codex"]);
    expect(critique.requiredSections).toContain(
      "Incorrect assumptions in Claude's summary"
    );
    expect(critique.critiquePrompts[0].prompt).toContain(
      "## Claude's Sanitized Summary"
    );
    expect(critique.critiquePrompts[0].prompt).toContain("naming may drift");
  });

  it("rejects unsupported runtime filters", () => {
    expect(() => council.resolveCouncilRuntimes("claude")).toThrow(
      /Unsupported council runtime/
    );
  });
});
