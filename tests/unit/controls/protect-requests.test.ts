/**
 * The one door every request of `lisa controls protect` goes through.
 *
 * A run that may only read must be unable to send a write, whatever a later
 * step asks for, and every request must be on the record
 * (CodySwannGT/lisa#4993).
 */
import { describe, expect, it, vi } from "vitest";

import type { GhResult } from "../../../src/controls/protect-modules.js";
import {
  readRulesetsBack,
  recordRequests,
  requestMethod,
} from "../../../src/controls/protect-requests.js";

const REPO = "example-owner/example-repo";
const RULESETS = `repos/${REPO}/rulesets`;
const OK: GhResult = { ok: true, stdout: "[]", stderr: "" };

describe("the method of a request", () => {
  it.each([
    [["api", RULESETS], "GET"],
    [["api", "-X", "GET", RULESETS], "GET"],
    [["api", "-X", "put", `${RULESETS}/7`, "--input", "-"], "PUT"],
    [["api", "--method", "DELETE", `${RULESETS}/7`], "DELETE"],
    [["api", RULESETS, "--input", "-"], "POST"],
    [["api", RULESETS, "-f", "name=x"], "POST"],
  ])("%j is %s", (args, method) => {
    expect(requestMethod(args)).toBe(method);
  });
});

describe("the recording request runner", () => {
  it("sends a read and records it", () => {
    const gh = vi.fn(() => OK);
    const log = recordRequests(gh);

    expect(log.read(["api", RULESETS])).toBe(OK);
    expect(gh).toHaveBeenCalledTimes(1);
    expect(log.requests()).toEqual([
      { method: "GET", path: RULESETS, sent: true },
    ]);
  });

  it("does not send a write through the read runner, and records the refusal", () => {
    const gh = vi.fn(() => OK);
    const log = recordRequests(gh);

    const answered = log.read(
      ["api", "-X", "PUT", `${RULESETS}/7`, "--input", "-"],
      { input: "{}" }
    );

    expect(gh).not.toHaveBeenCalled();
    expect(answered.ok).toBe(false);
    expect(answered.stderr).toMatch(/Not sent/u);
    expect(log.requests()).toEqual([
      { method: "PUT", path: `${RULESETS}/7`, sent: false },
    ]);
  });

  it("sends a write through the write runner, with its body", () => {
    const gh = vi.fn(() => OK);
    const log = recordRequests(gh);
    const args = ["api", "-X", "POST", RULESETS, "--input", "-"];

    log.write(args, { input: "{}" });

    expect(gh).toHaveBeenCalledWith(args, { input: "{}" });
    expect(log.requests()).toEqual([
      { method: "POST", path: RULESETS, sent: true },
    ]);
  });
});

describe("reading the rulesets back", () => {
  it("lists the rulesets and reads each one, through the runner it is given", async () => {
    const detail = { name: "quality checks", target: "branch", rules: [] };
    const log = recordRequests(args =>
      args.at(-1) === RULESETS
        ? { ok: true, stdout: JSON.stringify([{ id: 7 }]), stderr: "" }
        : { ok: true, stdout: JSON.stringify(detail), stderr: "" }
    );

    const back = await readRulesetsBack(log.read, REPO, process.cwd());

    expect(back).toMatchObject({ ok: true, rulesets: [detail] });
    expect(log.requests()).toEqual([
      { method: "GET", path: RULESETS, sent: true },
      { method: "GET", path: `${RULESETS}/7`, sent: true },
    ]);
  });

  it("answers the platform's reason when a read fails", async () => {
    const log = recordRequests(() => ({
      ok: false,
      stdout: "",
      stderr: "gh: Not Found (HTTP 404)",
    }));

    const back = await readRulesetsBack(log.read, REPO, process.cwd());

    expect(back).toEqual({ ok: false, reason: "gh: Not Found (HTTP 404)" });
  });
});
