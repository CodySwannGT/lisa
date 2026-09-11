/** A discovered file is not a usable tool when the operating system cannot run it. */
import { describe, expect, it } from "vitest";

import { preflightTools } from "../../../plugins/src/base/skills/lisa-setup-remote-env/scripts/preflight-tools.mjs";
import { probe } from "../../../plugins/src/base/skills/lisa-setup-remote-env/scripts/setup-remote-env.mjs";
import { planToolchain } from "../../../plugins/src/base/skills/lisa-setup-remote-env/scripts/toolchain.mjs";

const TOOL = "fixture-tool";
const VERSION = "1.0.0";
const PLATFORM = "darwin-arm64";

/**
 * Probe the same error object Node returns when execution is refused.
 * @param code Operating-system error code.
 * @returns The real probe result.
 */
function cannotExecute(code = "EACCES") {
  return probe(TOOL, () => {
    throw Object.assign(new Error("cannot execute"), { code });
  });
}

describe("execution status travels from probe to preflight", () => {
  it.each(["EACCES", "ENOEXEC"])("blocks an unpinned tool after %s", code => {
    const found = cannotExecute(code);
    const result = preflightTools(
      {},
      {
        tools: {
          install: [
            {
              name: TOOL,
              version: VERSION,
              platforms: {
                "linux-x64": { install: "npm-global", package: TOOL },
              },
            },
          ],
        },
      },
      () => found,
      PLATFORM
    );
    expect(found.executable).toBe(false);
    expect(result.blocked).toHaveLength(1);
    expect(result.unverified).toEqual([]);
  });

  it("blocks a required tool without a minimum version when execution failed", () => {
    const result = preflightTools(
      {},
      { tools: { require: [{ name: TOOL }] } },
      () => cannotExecute(),
      PLATFORM
    );
    expect(result.blocked).toHaveLength(1);
    expect(result.blocked[0]?.reason).toContain("cannot be executed");
  });

  it("does not skip provisioning based on a version from an unusable probe", () => {
    for (const version of [VERSION, "2.0.0"]) {
      const plan = planToolchain(
        { install: [{ name: TOOL, version: VERSION }] },
        () => ({ present: true, executable: false, version }),
        "local"
      );
      expect(plan[0]?.action).toBe("install");
    }
  });

  it("preserves a spawned tool that rejects --version but prints its banner", () => {
    const found = probe(TOOL, () => {
      throw Object.assign(new Error("unsupported option"), {
        status: 10,
        stdout: "UnZip 6.00",
        stderr: "",
      });
    });
    expect(found).toEqual({ present: true, executable: true, version: "6.00" });
    expect(
      preflightTools({}, { tools: { require: [{ name: TOOL }] } }, () => found)
        .blocked
    ).toEqual([]);
  });

  it("accepts a successfully executed tool with no version banner", () => {
    const found = probe(TOOL, () => "tool ready");
    expect(found).toEqual({ present: true, executable: true, version: null });
  });

  it("reports a missing binary as neither present nor executable", () => {
    expect(cannotExecute("ENOENT")).toEqual({
      present: false,
      executable: false,
      version: null,
    });
  });

  it("propagates the original timeout instead of reporting availability", () => {
    const timeout = Object.assign(new Error("deadline"), { code: "ETIMEDOUT" });
    expect(() =>
      probe(TOOL, () => {
        throw timeout;
      })
    ).toThrow(timeout);
  });
});
