/**
 * Substitute authorship through the real third-party evidence CLI
 * (CodySwannGT/lisa#4628).
 *
 * The unit suite injects the permission reader; this one does not. The prover
 * reads each comment author's permission from
 * `repos/{repo}/collaborators/{login}/permission` through a journaling `gh`
 * that answers from raw payloads, so the parsing of the real response, the
 * login pattern, and the fail-closed read are all exercised as they ship.
 * @module tests/integration/third-party-review-substitute-authors-cli
 */
import { describe, expect, it } from "vitest";

import { useIoLatencyBudget } from "../helpers/io-latency-budget.js";
import {
  HEAD,
  onlyReading,
  permissionRoute,
  RATE_LIMITED_RUN,
  REVIEWER,
  routesRead,
  runThirdPartyReviewCli,
  substituteComment,
  type Observations,
} from "../helpers/third-party-review-cli-fixture.js";

useIoLatencyBudget();

/** The reasons the prover prints, in the issue's words. */
const NO_WRITE_ACCESS = "no write access";
const PERMISSION_UNREADABLE = "permission unreadable";
const WRITER = "maintainer";

/**
 * Run the real CLI against one scenario in this suite's environment.
 * @param observations - The scenario's raw GitHub observations
 * @returns The run
 */
const run = (observations: Observations) =>
  runThirdPartyReviewCli(observations, process.env);

/**
 * One rate-limited head with a single first-line substitute by `login`.
 * @param login - The comment author
 * @param permission - The raw permission response for that author
 * @returns The run
 */
const substituteBy = (login: string, permission: unknown) =>
  run({
    checkRuns: [RATE_LIMITED_RUN],
    comments: [substituteComment(REVIEWER, HEAD, login)],
    permissions: { [login]: permission },
  });

describe("a writer's first-line substitute counts", () => {
  it.each(["write", "maintain", "admin"])(
    "counts an author holding %s",
    permission => {
      const result = substituteBy(WRITER, { permission });

      expect(result.status).toBe(0);
      expect(result.verdict.outcome).toBe("substituted");
      expect(onlyReading(result).substituteRefusals).toEqual([]);
      expect(routesRead(result)).toContain(permissionRoute(WRITER));
    }
  );
});

describe("everyone else's marker is refused, by name", () => {
  it.each(["read", "triage", "none"])(
    "refuses an author holding %s",
    permission => {
      const result = substituteBy("drive-by", { permission });

      expect(result.status).toBe(1);
      expect(result.verdict.outcome).toBe("unsatisfied");
      expect(onlyReading(result).substituteRefusals).toEqual([
        { author: "drive-by", reason: NO_WRITE_ACCESS },
      ]);
    }
  );

  it("fails closed when the permission read is refused", () => {
    const result = substituteBy(WRITER, {
      __refuse__: "HTTP 403: Resource not accessible by integration",
    });

    expect(result.status).toBe(1);
    expect(onlyReading(result).substituteRefusals).toEqual([
      { author: WRITER, reason: PERMISSION_UNREADABLE },
    ]);
  });

  it("fails closed when the permission response has no permission", () => {
    const result = substituteBy(WRITER, { message: "Not Found" });

    expect(result.status).toBe(1);
    expect(onlyReading(result).substituteRefusals).toEqual([
      { author: WRITER, reason: PERMISSION_UNREADABLE },
    ]);
  });

  it("asks about a bot, as the gate does, and a bot is no collaborator", () => {
    const bot = "github-actions[bot]";
    const result = substituteBy(bot, {
      __refuse__: "HTTP 404: github-actions[bot] is not a user",
    });

    expect(result.status).toBe(1);
    expect(routesRead(result)).toContain(permissionRoute(bot));
    expect(onlyReading(result).substituteRefusals).toEqual([
      { author: bot, reason: PERMISSION_UNREADABLE },
    ]);
  });

  it("never asks about a login outside the gate's pattern", () => {
    const result = run({
      checkRuns: [RATE_LIMITED_RUN],
      comments: [substituteComment(REVIEWER, HEAD, "someone_emu")],
      permissions: {},
    });

    expect(result.status).toBe(1);
    expect(onlyReading(result).substituteRefusals).toEqual([
      { author: "someone_emu", reason: NO_WRITE_ACCESS },
    ]);
  });

  it("refuses a writer's marker that is not the first line without asking", () => {
    const quoted = substituteComment(REVIEWER, HEAD);
    const result = run({
      checkRuns: [RATE_LIMITED_RUN],
      comments: [{ ...quoted, body: `Paste this:\n${String(quoted.body)}` }],
      permissions: {},
    });

    expect(result.status).toBe(1);
    expect(onlyReading(result).substituteRefusals).toEqual([
      { author: WRITER, reason: "not the first line" },
    ]);
  });
});
