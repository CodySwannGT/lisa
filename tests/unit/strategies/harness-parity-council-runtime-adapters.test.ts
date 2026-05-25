import path from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

const moduleUrl = pathToFileURL(
  path.resolve(".agents/skills/harness-parity-council/runtime-adapters.mjs")
).href;

const adapters = await import(moduleUrl);

describe("harness parity council runtime adapter planning", () => {
  it("resolves env overrides without losing the default command mapping", () => {
    expect(adapters.resolveRuntimeCommand("codex", {})).toBe("codex");
    expect(
      adapters.resolveRuntimeCommand("cursor", {
        LISA_CURSOR_CLI: "cursor-agent-beta",
      })
    ).toBe("cursor-agent-beta");
  });

  it("defines read-only-safe invocation plans per runtime", () => {
    expect(adapters.describeRuntimePlan("codex").safeInvocation.args).toEqual([
      "exec",
      "--sandbox",
      "read-only",
      "--skip-git-repo-check",
      "--json",
    ]);
    expect(adapters.describeRuntimePlan("cursor").safeInvocation.args).toEqual([
      "--print",
      "--output-format",
      "json",
    ]);
    expect(
      adapters.describeRuntimePlan("copilot").safeInvocation.args
    ).toContain("--deny-tool=write");
    expect(
      adapters.describeRuntimePlan("antigravity").safeInvocation.args
    ).toEqual(["--sandbox", "read-only"]);
  });

  it("flags auth-missing output heuristically across runtime-specific wording", () => {
    expect(
      adapters.detectAuthMissing("No saved session is found. Please sign in.")
    ).toBe(true);
    expect(
      adapters.detectAuthMissing(
        "Missing API key. Run cursor-agent login first."
      )
    ).toBe(true);
    expect(adapters.detectAuthMissing("usage: codex exec [options]")).toBe(
      false
    );
  });

  it("keeps the local probe entrypoint inside the Lisa-only skill tree", async () => {
    const runtimePath = path.resolve(
      ".agents/skills/harness-parity-council/runtime-adapters.mjs"
    );
    expect(runtimePath).toContain(".agents/skills/harness-parity-council");
  });
});
