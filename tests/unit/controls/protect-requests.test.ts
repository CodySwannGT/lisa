/**
 * The one door every request of `lisa controls protect` goes through.
 *
 * A run that may only read must be unable to send a write, whatever a later
 * step asks for, every request must be on the record, and every request
 * must name the host it is for, so that none goes wherever `gh` would send
 * it by default (CodySwannGT/lisa#4993).
 */
import { describe, expect, it, vi } from "vitest";

import type { GhResult } from "../../../src/controls/protect-modules.js";
import {
  onHost,
  readRulesetsBack,
  recordRequests,
  requestMethod,
} from "../../../src/controls/protect-requests.js";

const REPO = "example-owner/example-repo";
const HOST = "github.com";
const HOST_FLAG = "--hostname";
/** How every call the door passes on begins. */
const TO_HOST = ["api", HOST_FLAG, HOST] as const;
const RULESETS = `repos/${REPO}/rulesets`;
const RULESET_LIST = `${RULESETS}?per_page=100`;
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
    const log = recordRequests(gh, HOST);

    expect(log.read(["api", RULESETS])).toBe(OK);
    expect(gh).toHaveBeenCalledTimes(1);
    expect(log.requests()).toEqual([
      { method: "GET", path: RULESETS, sent: true },
    ]);
  });

  it("does not send a write through the read runner, and records the refusal", () => {
    const gh = vi.fn(() => OK);
    const log = recordRequests(gh, HOST);

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
    const log = recordRequests(gh, HOST);
    const args = ["api", "-X", "POST", RULESETS, "--input", "-"];

    log.write(args, { input: "{}" });

    expect(gh).toHaveBeenCalledWith(onHost(args, HOST), { input: "{}" });
    expect(log.requests()).toEqual([
      { method: "POST", path: RULESETS, sent: true },
    ]);
  });
});

describe("the host a request is sent to", () => {
  it("is named in every call, read or write, right after the subcommand", () => {
    const sent: (readonly string[])[] = [];
    const log = recordRequests(args => {
      sent.push(args);
      return OK;
    }, HOST);

    log.read(["api", RULESETS]);
    log.read(["api", "-X", "GET", `${RULESETS}/7`]);
    log.write(["api", "-X", "PUT", `${RULESETS}/7`, "--input", "-"], {
      input: "{}",
    });

    expect(sent).toEqual([
      [...TO_HOST, RULESETS],
      [...TO_HOST, "-X", "GET", `${RULESETS}/7`],
      [...TO_HOST, "-X", "PUT", `${RULESETS}/7`, "--input", "-"],
    ]);
  });

  it("is the host the door was built for, whatever that is", () => {
    const gh = vi.fn(() => OK);

    recordRequests(gh, "example.invalid").read(["api", RULESETS]);

    expect(gh).toHaveBeenCalledWith(
      ["api", HOST_FLAG, "example.invalid", RULESETS],
      undefined
    );
  });

  it("is never left to gh: a call that could not carry it is not sent", () => {
    const gh = vi.fn(() => OK);
    const log = recordRequests(gh, HOST);

    const answered = log.write(["repo", "view", "--json", "nameWithOwner"]);

    expect(gh).not.toHaveBeenCalled();
    expect(answered.ok).toBe(false);
    expect(answered.stderr).toMatch(/Not sent/u);
    expect(log.requests()).toEqual([expect.objectContaining({ sent: false })]);
  });
});

describe("reading the rulesets back", () => {
  it("lists the rulesets and reads each one, through the runner it is given", async () => {
    const detail = { name: "quality checks", target: "branch", rules: [] };
    const log = recordRequests(
      args =>
        args.at(-1) === RULESET_LIST
          ? { ok: true, stdout: JSON.stringify([{ id: 7 }]), stderr: "" }
          : { ok: true, stdout: JSON.stringify(detail), stderr: "" },
      HOST
    );

    const back = await readRulesetsBack(log.read, REPO, process.cwd());

    expect(back).toMatchObject({ ok: true, rulesets: [detail] });
    expect(log.requests()).toEqual([
      { method: "GET", path: RULESET_LIST, sent: true },
      { method: "GET", path: `${RULESETS}/7`, sent: true },
    ]);
  });

  it("answers the platform's reason when a read fails", async () => {
    const log = recordRequests(
      () => ({
        ok: false,
        stdout: "",
        stderr: "gh: Not Found (HTTP 404)",
      }),
      HOST
    );

    const back = await readRulesetsBack(log.read, REPO, process.cwd());

    expect(back).toEqual({ ok: false, reason: "gh: Not Found (HTTP 404)" });
  });

  it("does not take a list cut off at the page for the whole list", async () => {
    const page = Array.from({ length: 100 }, (_, index) => ({ id: index + 1 }));
    const log = recordRequests(
      args =>
        args.at(-1) === RULESET_LIST
          ? { ok: true, stdout: JSON.stringify(page), stderr: "" }
          : {
              ok: true,
              stdout: JSON.stringify({ name: "one", rules: [] }),
              stderr: "",
            },
      HOST
    );

    const back = await readRulesetsBack(log.read, REPO, process.cwd());

    expect(back.ok).toBe(false);
    expect(log.requests()).toEqual([
      { method: "GET", path: RULESET_LIST, sent: true },
    ]);
  });
});
