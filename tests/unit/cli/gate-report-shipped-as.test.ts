/**
 * `lisa doctor`'s gate report agrees with the runner about what will run.
 *
 * The report resolves a cell's task with its own copy of the source ladder
 * rather than by calling `resolveMoment` — deliberately, because it names WHICH
 * source won and the resolver only returns the winner's task. The cost of that
 * duplication is that a fifth source added to one and not the other makes the
 * report describe a command the runner will not execute.
 *
 * That is exactly the shape #2916 was filed against, one surface over: after
 * `shippedAs` became load-bearing, a project shipping `security:zap` runs
 * `security:zap`, and a report still printing `security:dast` with
 * `commandExists: false` would be telling an operator their gate is broken
 * while it passes.
 * @module tests/unit/cli/gate-report-shipped-as
 */

import { describe, expect, it } from "vitest";

import { cell, reportFor } from "./gate-report-fixtures.js";

/** The deploy moment the aliased gates are legal at. */
const DEPLOY = "pre-deploy:production";

/** The gate whose default resolves nowhere and whose alias ships on two stacks. */
const DAST = "runtime-web-vulnerability";

/** A gates block declaring that gate at the production deploy moment. */
const DECLARED = { gates: { [DAST]: { [DEPLOY]: "required" } } };

/** The manifest of a project that ships the scanner but not the concern name. */
const SHIPS_ALIAS = { "security:zap": "zap-baseline.py" };

describe("a gate whose only prover is the one the template ships", () => {
  it("reports the shipped script as the command, and as existing", async () => {
    const built = await reportFor({
      config: DECLARED,
      scripts: SHIPS_ALIAS,
    });
    const deploy = cell(built, DAST, DEPLOY);

    expect(deploy.task).toBe("security:zap");
    expect(deploy.command).toBe("npm run security:zap");
    expect(deploy.commandExists).toEqual({ state: "verified", value: true });
  });

  it("names the shipped-script source rather than claiming the project chose it", async () => {
    const built = await reportFor({
      config: DECLARED,
      scripts: SHIPS_ALIAS,
    });

    expect(cell(built, DAST, DEPLOY).provenance).toBe("registry-shipped-as");
  });
});

describe("the report does not invent a prover", () => {
  it("keeps the concern name when the project ships neither script", async () => {
    const built = await reportFor({ config: DECLARED, scripts: {} });
    const deploy = cell(built, DAST, DEPLOY);

    expect(deploy.task).toBe("security:dast");
    expect(deploy.provenance).toBe("registry-task");
    expect(deploy.commandExists).toEqual({ state: "verified", value: false });
  });

  it("keeps the project's own run: whatever the template ships", async () => {
    const built = await reportFor({
      config: { gates: { [DAST]: { run: "scan:mine", [DEPLOY]: "required" } } },
      scripts: SHIPS_ALIAS,
    });
    const deploy = cell(built, DAST, DEPLOY);

    expect(deploy.task).toBe("scan:mine");
    expect(deploy.provenance).toBe("gate-run");
  });
});
