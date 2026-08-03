/**
 * Contract tests for `executionEnv` routing and Codex Cloud dispatch.
 *
 * Two failures matter more than the rest here. A silently ignored
 * `executionEnv` runs work locally while the operator believes it went remote,
 * and nothing downstream contradicts that belief. And a dispatch whose task
 * identifier was never captured leaves remote work nobody can reconcile, where
 * a retry duplicates it.
 * @module tests/unit/secrets/remote-dispatch
 */
import { describe, expect, it } from "vitest";

import {
  EXECUTION_ENVS,
  buildCodexArgs,
  extractTaskId,
  parseInvocation,
  resolveExecutionEnv,
  splitSkillFlag,
} from "../../../plugins/src/base/skills/lisa-remote-dispatch/scripts/dispatch.mjs";

/** The skill name callers target by default. */
const DEFAULT_SKILL = "lisa-plan";

/** A representative invocation payload. */
const INVOCATION = "executionEnv=codex-cloud SE-45434";

/** A minimally valid surface binding. */
const SURFACE = { environmentId: "env-123", repository: "org/repo" };

describe("skill flag splitting", () => {
  it("keeps the whole payload when no --skill is passed", () => {
    // Regression: the obvious index-filter version drops argv[0] here, because
    // indexOf returns -1 and the filter excludes index 0. The bug is invisible
    // — a swallowed payload parses as no parameters, resolves to `local`, and
    // looks exactly like an ordinary local run.
    const { skill, raw } = splitSkillFlag([INVOCATION]);
    expect(raw).toBe(INVOCATION);
    expect(skill).toBe("lisa-implement");
  });

  it("removes the flag and its value from the payload", () => {
    const { skill, raw } = splitSkillFlag(["SE-1", "--skill", DEFAULT_SKILL]);
    expect(skill).toBe(DEFAULT_SKILL);
    expect(raw).toBe("SE-1");
  });

  it("handles the flag appearing before the payload", () => {
    const { skill, raw } = splitSkillFlag(["--skill", DEFAULT_SKILL, "SE-1"]);
    expect(skill).toBe(DEFAULT_SKILL);
    expect(raw).toBe("SE-1");
  });

  it("rejects a dangling --skill rather than reading undefined", () => {
    expect(() => splitSkillFlag(["SE-1", "--skill"])).toThrow(
      /requires a skill name/i
    );
  });
});

describe("invocation parsing", () => {
  it("separates parameters from the caller's payload", () => {
    const { params, rest } = parseInvocation(INVOCATION);
    expect(params.executionEnv).toBe("codex-cloud");
    expect(rest).toBe("SE-45434");
  });

  it("passes a multi-word payload through untouched", () => {
    // The payload is the caller's business. This dispatcher has no licence to
    // interpret, reorder, or normalise it.
    const { rest } = parseInvocation(
      "executionEnv=local fix the login redirect"
    );
    expect(rest).toBe("fix the login redirect");
  });

  it("handles a payload with no parameters at all", () => {
    const { params, rest } = parseInvocation("SE-45434");
    expect(params).toEqual({});
    expect(rest).toBe("SE-45434");
  });

  it("tolerates an empty invocation", () => {
    expect(parseInvocation("")).toEqual({ params: {}, rest: "" });
  });
});

describe("executionEnv resolution", () => {
  it("defaults to local when absent", () => {
    expect(resolveExecutionEnv({})).toBe("local");
  });

  it("accepts every declared surface", () => {
    for (const surface of EXECUTION_ENVS) {
      expect(resolveExecutionEnv({ executionEnv: surface })).toBe(surface);
    }
  });

  it("rejects an unknown surface rather than falling back to local", () => {
    // Falling back would run the work locally while the operator believes it
    // went remote — a wrong outcome that looks exactly like a right one.
    //
    // This case used "claude-web" as its unknown surface until that surface was
    // implemented. A placeholder that can become real is a test which quietly
    // stops asserting anything, so this one names a surface no vendor has.
    expect(() =>
      resolveExecutionEnv({ executionEnv: "nowhere-cloud" })
    ).toThrow(/unknown executionEnv/i);
  });

  it("names the supported surfaces in the rejection", () => {
    expect(() => resolveExecutionEnv({ executionEnv: "nope" })).toThrow(
      /codex-cloud/
    );
  });
});

describe("codex argument construction", () => {
  it("always passes branch explicitly", () => {
    // `codex cloud exec` defaults to the *current* branch. A dispatcher's
    // incidental checkout state must never decide where work runs.
    const args = buildCodexArgs(SURFACE, "$lisa-implement SE-1");
    expect(args).toContain("--branch");
    expect(args[args.indexOf("--branch") + 1]).toBe("main");
  });

  it("honours a configured branch over the default", () => {
    const args = buildCodexArgs({ ...SURFACE, branch: "develop" }, "prompt");
    expect(args[args.indexOf("--branch") + 1]).toBe("develop");
  });

  it("passes the model through -c, since there is no --model flag", () => {
    const args = buildCodexArgs({ ...SURFACE, model: "some-model" }, "prompt");
    expect(args).toContain("-c");
    expect(args[args.indexOf("-c") + 1]).toBe('model="some-model"');
    expect(args).not.toContain("--model");
  });

  it("omits the model override entirely when none is configured", () => {
    expect(buildCodexArgs(SURFACE, "prompt")).not.toContain("-c");
  });

  it("passes attempts only when set, since it multiplies consumption", () => {
    expect(buildCodexArgs(SURFACE, "prompt")).not.toContain("--attempts");
    const args = buildCodexArgs({ ...SURFACE, attempts: 3 }, "prompt");
    expect(args[args.indexOf("--attempts") + 1]).toBe("3");
  });

  it("puts the prompt last so it is never read as a flag value", () => {
    const args = buildCodexArgs(
      { ...SURFACE, attempts: 2 },
      "$lisa-implement X"
    );
    expect(args.at(-1)).toBe("$lisa-implement X");
  });

  it("targets the configured environment", () => {
    const args = buildCodexArgs(SURFACE, "prompt");
    expect(args[args.indexOf("--env") + 1]).toBe("env-123");
  });
});

describe("task identifier capture", () => {
  it("finds an identifier in surrounding output", () => {
    const out = "Submitted.\n  task_e_abababababababababababababababab\nDone.";
    expect(extractTaskId(out)).toBe("task_e_abababababababababababababababab");
  });

  it("finds an identifier embedded in a URL", () => {
    const out =
      "https://chatgpt.com/codex/tasks/task_e_cdcdcdcdcdcdcdcdcdcdcdcd";
    expect(extractTaskId(out)).toBe("task_e_cdcdcdcdcdcdcdcdcdcdcdcd");
  });

  it("returns null when none is present, so the caller can fail the dispatch", () => {
    // A dispatch with no identifier is a failed dispatch even on exit zero:
    // nothing can reconcile the task, and a retry would duplicate it.
    expect(extractTaskId("submitted successfully")).toBeNull();
  });

  it("tolerates empty or absent output", () => {
    expect(extractTaskId("")).toBeNull();
    expect(extractTaskId(undefined)).toBeNull();
  });
});
