/**
 * The runner refuses what `validate` refuses, and still runs what it accepts.
 *
 * `lisa-gates.mjs validate` and `lisa-run-gates.mjs` used to disagree about
 * what a legal configuration is. A deploy-only gate declared at `pull-request`
 * made `validate` exit 1 with "cannot run at" while the runner resolved that
 * same declaration, executed it, and printed `1 proved` — one tree, one config,
 * two opposite verdicts, and which one an operator got depended on which
 * command they happened to type (CodySwannGT/lisa#3042).
 *
 * The measured instance failed in the safe direction: something ran that should
 * not have. Nothing about the divergence made that the direction, though — the
 * mirror image is a declaration `validate` accepts and the runner declines to
 * execute, which is a silent skip reporting green.
 *
 * Three properties are pinned here, and the second is as load-bearing as the
 * first: a runner that refused everything would satisfy the first on its own
 * while being useless.
 *
 * - The ticket's exact fixture is REFUSED, and nothing is reported proved.
 * - A legal declaration still RUNS and is still reported proved.
 * - A gate legitimately not applicable at a moment still says "not
 *   applicable". That is an established verdict — there was nothing to run —
 *   and collapsing it into "blocked" would be a new defect, not a fix.
 * @module tests/unit/scripts/lisa-run-gates-invalid-config
 */

import { describe, expect, it } from "vitest";

import {
  configurationProblems,
  declarationsAt,
  MOMENTS,
  REGISTRY,
} from "../../../all/copy-overwrite/scripts/lisa-gates.mjs";
import { EXIT } from "../../../all/copy-overwrite/scripts/lisa-run-gates.mjs";
import { runCli } from "./lisa-run-gates-fixtures.js";

const PULL_REQUEST = "pull-request";
const PUSH = "push";
const DAST = "runtime-web-vulnerability";
const STYLE = "code-style";
const INTERCEPTED = "destructive-safety";

/**
 * The ticket's fixture, verbatim: a deploy-only gate declared at pull-request,
 * in a project that ships the `security:zap` script the registry aliases that
 * gate onto. The alias is what made this resolve to a real command and run.
 */
const TICKET_CONFIG = JSON.stringify({
  gates: { [DAST]: { [PULL_REQUEST]: "required" } },
});

/** The manifest half of the ticket's fixture. */
const TICKET_PACKAGE = JSON.stringify({
  name: "fixture",
  version: "1.0.0",
  scripts: { "security:zap": "echo scanned" },
});

/**
 * A legal declaration whose prover is `node --eval=0`.
 *
 * Deliberately not a package script: a control asserting that gates STILL RUN
 * must not be able to fail because the box has no npm, and `process.execPath`
 * is the one executable a Node test can be certain of. `code-style` at
 * pull-request is a plainly legal declaration — `validate` reports this exact
 * config valid.
 */
const LEGAL_CONFIG = JSON.stringify({
  gates: {
    runner: "node",
    [STYLE]: { [PULL_REQUEST]: { level: "required", run: "--eval=0" } },
  },
});

/** The same legal config, plus a gate that is enforced by interception. */
const INTERCEPTED_CONFIG = JSON.stringify({
  gates: {
    runner: "node",
    [STYLE]: { [PULL_REQUEST]: { level: "required", run: "--eval=0" } },
    [INTERCEPTED]: { [PULL_REQUEST]: "required" },
  },
});

/** A gate misdeclared at `push`, alongside a legal pull-request declaration. */
const ELSEWHERE_CONFIG = JSON.stringify({
  gates: {
    runner: "node",
    "test-meaningfulness": { [PUSH]: "required" },
    [STYLE]: { [PULL_REQUEST]: { level: "required", run: "--eval=0" } },
  },
});

describe("a configuration validate refuses is never reported proved", () => {
  it("refuses the deploy-only gate declared at pull-request", () => {
    const child = runCli(TICKET_CONFIG, PULL_REQUEST, {
      "package.json": TICKET_PACKAGE,
    });

    expect(child.status).toBe(EXIT.BLOCKED);
    expect(child.stderr).toContain(`cannot run at "${PULL_REQUEST}"`);
  });

  it("does not run the gate command it would have run", () => {
    const child = runCli(TICKET_CONFIG, PULL_REQUEST, {
      "package.json": TICKET_PACKAGE,
    });

    // The fixture's prover echoes this word. Its absence is what says the
    // command never ran, rather than ran and was disregarded.
    expect(`${child.stdout}${child.stderr}`).not.toContain("scanned");
    expect(child.stdout).not.toContain("proved");
  });

  it("tells an operator what is wrong and what to do about it", () => {
    const child = runCli(TICKET_CONFIG, PULL_REQUEST, {
      "package.json": TICKET_PACKAGE,
    });

    // A bare non-zero exit is not a refusal anyone can act on. The file to
    // open, the command that says when the problem is gone, and the fact that
    // nothing was proved all have to be in the text.
    expect(child.stderr).toContain(".lisa.config.json");
    expect(child.stderr).toContain("validate");
    expect(child.stderr).toContain("NOT a pass");
  });
});

describe("what validate accepts still runs — the negative control", () => {
  it("runs a legal declaration and reports it proved", () => {
    const child = runCli(LEGAL_CONFIG, PULL_REQUEST);

    expect(child.status).toBe(EXIT.PROVED);
    expect(child.stdout).toContain("PASSED");
    expect(child.stdout).toContain("1 proved");
  });

  it("still calls an intercepted gate not applicable, not blocked", () => {
    const child = runCli(INTERCEPTED_CONFIG, PULL_REQUEST);

    expect(child.status).toBe(EXIT.PROVED);
    expect(child.stdout).toContain("SKIPPED");
    expect(child.stdout).toContain("1 not applicable here");
  });

  it("continues when the only problem belongs to another moment, and says so", () => {
    const child = runCli(ELSEWHERE_CONFIG, PULL_REQUEST);

    expect(child.status).toBe(EXIT.PROVED);
    expect(child.stdout).toContain("apply at other moments");
  });

  it("refuses that same configuration at the moment it belongs to", () => {
    const child = runCli(ELSEWHERE_CONFIG, PUSH);

    expect(child.status).toBe(EXIT.BLOCKED);
    expect(child.stderr).toContain(`cannot run at "${PUSH}"`);
  });
});

describe("narrowing to one moment loses no refusal", () => {
  // The runner asks the validator about the moment it was asked to run by
  // narrowing the INPUT — `declarationsAt` — rather than by teaching itself
  // which problems are moment-scoped. That is the whole safety of the design,
  // so it is asserted over the entire registry x moments matrix rather than a
  // sampled pair: a projection that dropped a declaration the validator still
  // judges would hide the refusal at exactly the moment it belongs to.
  const pairs = Object.keys(REGISTRY).flatMap((gate: string) =>
    (MOMENTS as string[]).map((moment: string) => ({ gate, moment }))
  );

  it.each(pairs)(
    "reaches the same verdict for $gate at $moment",
    ({ gate, moment }: { gate: string; moment: string }) => {
      const gates = { [gate]: { [moment]: "required" } };
      const read = (declared: object): string[] =>
        configurationProblems({ gates: declared, scripts: null }).blocking;

      expect(read(declarationsAt({ gates, moment }))).toEqual(read(gates));
    }
  );
});

describe("declarationsAt keeps what the moment resolves through", () => {
  it("drops declarations made at other moments", () => {
    expect(
      declarationsAt({
        gates: { [STYLE]: { commit: "required", [PUSH]: "off" } },
        moment: "commit",
      })
    ).toEqual({ [STYLE]: { commit: "required" } });
  });

  it("keeps the gate-level fields the declaration resolves through", () => {
    expect(
      declarationsAt({
        gates: { [STYLE]: { commit: "required", run: "lint", needs: {} } },
        moment: "commit",
      })
    ).toEqual({ [STYLE]: { commit: "required", run: "lint", needs: {} } });
  });

  it("keeps a key that is no moment at all, so a typo stays refused", () => {
    // `pull_request` runs at no moment whatsoever, so it can never be some
    // other moment's problem. Narrowing it away would make a typo legal
    // everywhere.
    expect(
      declarationsAt({
        gates: { [STYLE]: { pull_request: "required" } },
        moment: "commit",
      })
    ).toEqual({ [STYLE]: { pull_request: "required" } });
  });

  it("leaves a block that is not an object alone, so it stays refused", () => {
    expect(
      declarationsAt({ gates: { [STYLE]: "required" }, moment: "commit" })
    ).toEqual({ [STYLE]: "required" });
  });
});
