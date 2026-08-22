/**
 * `shippedAs` is load-bearing: the alias resolves, or nothing does.
 *
 * The registry has recorded, since #2907, that a working prover for seven
 * concerns already sits in the consumer's own `package.json` under a vendor's
 * name — `security:zap` for `security:dast`, `k6:load` for `perf:load`,
 * `maestro:test` for `test:e2e:native`. Measured on `main` @ `eb9dee054`, the
 * only readers of that field were a TypeScript interface and a drift test:
 * `resolveMoment` built its command from `entry.run`, `gate.run`,
 * `taskAt[family]`, and `task`, and `shippedAs` was not among them. So the
 * knowledge was present and inert, and every operator surface still resolved
 * to a concern name that fails as `Missing script`.
 *
 * The mechanism here is a FALLBACK, never a rename. `task` keeps naming the
 * concern — that is what stops a tool swap becoming a branch-protection
 * migration — and the alias is consulted only when three things are true at
 * once: the project declared no prover of its own, the concern-named script is
 * absent from this project, and the alias is present. Any other combination
 * resolves exactly as it did before.
 *
 * Two failure paths are pinned here as hard as the success path, because a
 * resolver that silently resolves MORE than it should is the same defect one
 * direction over:
 *
 * - a gate with no prover anywhere still resolves to its concern name, so the
 *   runner still executes it and still reports `FAILED` on the missing script;
 * - a project's own `run:` is never overridden, whatever the registry knows.
 * @module tests/unit/scripts/lisa-gates-shipped-as
 */

import { describe, expect, it } from "vitest";

import { resolveMoment } from "../../../all/copy-overwrite/scripts/lisa-gates.mjs";
import { PRE_DEPLOY_PROD, PULL_REQUEST } from "./lisa-gates-fixtures.js";

/** The runner every assertion below prefixes its command with. */
const RUNNER = "npm run";

/** The concern name the DAST gate defaults to, which no npm stack ships. */
const DAST_TASK = "security:dast";

/** The three deploy-family gates #2832 is blocked on, and their aliases. */
const DAST = "runtime-web-vulnerability";
const LOAD = "load-capacity";
const NATIVE = "e2e-native";

/** A `scripts` block shaped like the one an expo project ends up with. */
const EXPO_SCRIPTS = Object.freeze({
  "security:zap": "zap-baseline.py -t http://localhost:8081",
  "maestro:test": "maestro test .maestro",
  lint: "oxlint",
});

/** A `scripts` block shaped like the one a nestjs project ends up with. */
const NESTJS_SCRIPTS = Object.freeze({
  "security:zap": "zap-baseline.py -t http://localhost:3000",
  "k6:load": "k6 run load.js",
});

/**
 * Resolve one gate declared `required` at one moment.
 * @param id - Registry gate id
 * @param options - Declaration and project inputs
 * @param options.moment - The moment to declare and resolve at
 * @param options.scripts - The project's package scripts, or undefined
 * @param options.declare - Extra keys merged onto the gate declaration
 * @returns The single resolved entry
 */
function resolveOne(
  id: string,
  options: {
    moment: string;
    scripts?: Record<string, string> | null;
    declare?: Record<string, unknown>;
  }
): Record<string, unknown> {
  const { moment, scripts, declare = {} } = options;
  const resolved = resolveMoment({
    gates: { [id]: { [moment]: "required", ...declare } },
    moment,
    runner: RUNNER,
    scripts,
  }) as Record<string, unknown>[];
  return resolved[0] as Record<string, unknown>;
}

describe("shippedAs resolves the prover the project actually ships", () => {
  it("runs security:zap for a DAST gate on a project that ships only the alias", () => {
    // The measurement that makes this issue real: before this change the same
    // call produced `npm run security:dast`, which no stack ships.
    const gate = resolveOne(DAST, {
      moment: PRE_DEPLOY_PROD,
      scripts: EXPO_SCRIPTS,
    });

    expect(gate.task).toBe("security:zap");
    expect(gate.command).toBe("npm run security:zap");
  });

  it("runs k6:load for the load-capacity gate on a project that ships it", () => {
    const gate = resolveOne(LOAD, {
      moment: PRE_DEPLOY_PROD,
      scripts: NESTJS_SCRIPTS,
    });

    expect(gate.command).toBe("npm run k6:load");
  });

  it("runs maestro:test for the native e2e gate on a project that ships it", () => {
    const gate = resolveOne(NATIVE, {
      moment: PULL_REQUEST,
      scripts: EXPO_SCRIPTS,
    });

    expect(gate.command).toBe("npm run maestro:test");
  });

  it("says which script proved it, and which concern name it stands in for", () => {
    // Option 1's stated cost in #2916: two scripts can now back one gate, so
    // "what proved this" has to be reportable rather than inferred.
    const gate = resolveOne(DAST, {
      moment: PRE_DEPLOY_PROD,
      scripts: EXPO_SCRIPTS,
    });

    expect(gate.alias).toEqual({ from: DAST_TASK, to: "security:zap" });
  });
});

describe("the alias never widens what resolves", () => {
  it("leaves a gate with no prover anywhere resolving to its concern name", () => {
    // The fail-closed control. `accessibility` carries no `shippedAs` at all,
    // and a project shipping nothing must still get a command the runner
    // executes and reports FAILED on — not a silent null that reads as
    // "nothing to prove".
    const gate = resolveOne("accessibility", {
      moment: PRE_DEPLOY_PROD,
      scripts: {},
    });

    expect(gate.command).toBe("npm run a11y:check");
    expect(gate.alias).toBeNull();
  });

  it("leaves an aliased gate failing closed when the alias is absent too", () => {
    const gate = resolveOne(LOAD, {
      moment: PRE_DEPLOY_PROD,
      scripts: { lint: "oxlint" },
    });

    expect(gate.command).toBe("npm run perf:load");
    expect(gate.alias).toBeNull();
  });

  it("keeps the concern name when the project ships the concern name", () => {
    const gate = resolveOne(DAST, {
      moment: PRE_DEPLOY_PROD,
      scripts: { [DAST_TASK]: "own-scanner", "security:zap": "zap" },
    });

    expect(gate.command).toBe(`npm run ${DAST_TASK}`);
    expect(gate.alias).toBeNull();
  });

  it("never overrides a prover the gate declares for itself", () => {
    const gate = resolveOne(DAST, {
      moment: PRE_DEPLOY_PROD,
      scripts: EXPO_SCRIPTS,
      declare: { run: "security:mine" },
    });

    expect(gate.command).toBe("npm run security:mine");
    expect(gate.alias).toBeNull();
  });

  it("never overrides a prover declared for one moment", () => {
    const resolved = resolveMoment({
      gates: {
        [DAST]: {
          [PRE_DEPLOY_PROD]: { level: "required", run: "security:mine" },
        },
      },
      moment: PRE_DEPLOY_PROD,
      runner: RUNNER,
      scripts: EXPO_SCRIPTS,
    }) as Record<string, unknown>[];

    expect(resolved[0]?.command).toBe("npm run security:mine");
  });
});

describe("an unknown package.json is not an excuse to guess", () => {
  it("resolves exactly as before when no scripts are supplied", () => {
    // Every caller that has not been taught to read the project's manifest
    // keeps today's answer. Silence must not become a behaviour change.
    const gate = resolveOne(DAST, { moment: PRE_DEPLOY_PROD });

    expect(gate.command).toBe(`npm run ${DAST_TASK}`);
    expect(gate.alias).toBeNull();
  });

  it("resolves exactly as before when the manifest could not be read", () => {
    const gate = resolveOne(DAST, {
      moment: PRE_DEPLOY_PROD,
      scripts: null,
    });

    expect(gate.command).toBe(`npm run ${DAST_TASK}`);
    expect(gate.alias).toBeNull();
  });
});
