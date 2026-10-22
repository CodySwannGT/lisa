/**
 * Tests for judging ABSENT required checks against the pull request's BASE
 * branch rather than the cross-branch union (CodySwannGT/lisa#4484).
 *
 * `required_contexts` is the UNION of what every protected branch requires —
 * the host refresh writes it that way and the declaration's own readme says
 * so. The absent arm walked that union, so a repository whose rulesets differ
 * by branch got a false `absent_required_check` on every pull request into a
 * branch that does not require one of the union's members.
 *
 * MEASURED in a caller repository of this fleet: `🌙 Nightly E2E Health / 🌙
 * Gate` and `🔒 Destructive Stage Guard` are required on `dev` only, and the
 * nightly workflow triggers only on `branches: [dev]`. Four consecutive
 * staging-base pull requests were green on every context staging requires and
 * each still failed the evidence job with exactly one finding — the nightly
 * gate, "ruleset-required but did not report". `gh api
 * repos/<o>/<r>/rules/branches/staging` lists three rulesets, none containing
 * it. Every staging pull request rendered red, so operators learned to ignore
 * the check, which is the "required-and-vacuous" detection this file exists to
 * provide, defeated by its own false positive.
 *
 * The fix is option (a) on the issue: the declaration MAY carry
 * `required_contexts_by_branch`, and the absent arm selects the set for the
 * base ref. The union remains the fallback, and the fallback is NEVER silent —
 * a run that judged against the union says so, in a named token, on every
 * surface that prints the report. A downstream staging-base run then proves
 * which path it took by the line it prints.
 *
 * Every context name below is byte-exact as the measured rulesets carry it.
 * @module tests/unit/scripts/absent-required-checks-by-branch
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const SCRIPT_REL =
  "typescript/copy-overwrite/scripts/check-skipped-required-checks.mjs";
const CI_WORKFLOW = ".github/workflows/ci.yml";

/** One check row, as both fetch routes normalise them. */
interface CheckRow {
  readonly name: string;
  readonly state: string;
  readonly bucket?: string;
  readonly description?: string;
}

/** One violation. */
interface Violation {
  readonly kind: string;
  readonly token: string | null;
  readonly message: string;
}

/** Which set the absent arm judged against, and why. */
interface RequiredSet {
  readonly source: "branch" | "union";
  readonly base: string | null;
  readonly baseSource: string | null;
  readonly contexts: readonly string[];
  readonly fallback: { readonly kind: string; readonly reason: string } | null;
  readonly line: string;
}

/** The exports this suite consumes. */
interface GuardModule {
  readonly VIOLATIONS: Record<string, string>;
  readonly REQUIRED_SET_FALLBACK: string;
  resolveBaseRef(
    argv: readonly string[],
    env?: Record<string, string | undefined>,
    options?: { pr?: string; repo?: string }
  ): {
    base: string | null;
    source: string | null;
    ignoredEventBase?: string;
  };
  selectRequiredContexts(
    declaration: Record<string, unknown>,
    base: {
      base: string | null;
      source: string | null;
      ignoredEventBase?: string;
    }
  ): RequiredSet;
  evaluateAbsentRequiredChecks(
    declaration: Record<string, unknown>,
    checks: readonly CheckRow[],
    options?: {
      headSha?: string;
      base?: { base: string | null; source: string | null };
    }
  ): {
    violations: Violation[];
    checked: number;
    absent: string[];
    requiredSet: RequiredSet;
  };
  loadDeclaration(rootDir: string): Record<string, unknown>;
  snapshotTrust(declaration: Record<string, unknown>): {
    trusted: boolean;
    reason?: string;
  };
  inspectVacuity(
    argv: readonly string[],
    declaration: Record<string, unknown>,
    options?: Record<string, unknown>
  ):
    | {
        violations: readonly Violation[];
        absent?: readonly string[];
        requiredSet?: RequiredSet;
      }
    | undefined;
}

/** Required on every protected branch. */
const CODERABBIT = "CodeRabbit";
const LINT = "🔍 Quality Checks / 🧹 Lint";

/** Required on `staging` (and `dev`), measured in the staging ruleset. */
const STAGING_ONLY_EXTRA = "🔍 Quality Checks / 🧪 Run Unit Tests";

/** The two contexts the measured `dev` ruleset requires and staging does not. */
const NIGHTLY = "🌙 Nightly E2E Health / 🌙 Gate";
const STAGE_GUARD = "🔒 Destructive Stage Guard";

/** The union the host refresh writes into `required_contexts`. */
const UNION = [CODERABBIT, LINT, STAGING_ONLY_EXTRA, NIGHTLY, STAGE_GUARD];

/** The per-branch sets the host refresh writes from `rules/branches/<b>`. */
const BY_BRANCH = {
  dev: [CODERABBIT, LINT, STAGING_ONLY_EXTRA, NIGHTLY, STAGE_GUARD],
  staging: [CODERABBIT, LINT, STAGING_ONLY_EXTRA],
  main: [CODERABBIT, LINT],
};

const HEAD_SHA = "c".repeat(40);

/** Disables the settle wait, so a unit test never sleeps. */
const NO_WAIT = "--settle-timeout=0";

/** The repository the simulated `pull_request` event belongs to. */
const EVENT_REPO = "owner/name";

/** A different repository, whose PR numbers collide with the event's. */
const OTHER_REPO = "other/name";

/** The fallback token, spelled out so a rename is a visible test change. */
const FALLBACK_TOKEN = "required_contexts_branch_fallback";

/**
 * A declaration carrying the union and, unless overridden, the per-branch sets.
 *
 * @param overrides - Keys merged over the base declaration
 * @returns A declaration object
 */
function declarationWith(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    ruleset: { baseline_fetched_at: "2026-10-22" },
    required_contexts: [...UNION],
    required_contexts_by_branch: BY_BRANCH,
    workflows: [CI_WORKFLOW],
    skip_job_declarations: {},
    evidence_bearing_checks: { [CODERABBIT]: {} },
    ...overrides,
  };
}

/**
 * A declaration written before #4484: the union only, no per-branch sets.
 *
 * @returns A declaration object
 */
function legacyDeclaration(): Record<string, unknown> {
  const { required_contexts_by_branch: _dropped, ...legacy } =
    declarationWith();
  return legacy;
}

/**
 * Rows reporting success for every named context.
 *
 * @param names - Contexts that reported
 * @returns Check rows
 */
function rowsFor(names: readonly string[]): CheckRow[] {
  return names.map(name => ({
    name,
    state: "SUCCESS",
    bucket: "pass",
    description: name === CODERABBIT ? "Review completed" : "",
  }));
}

/** A base ref resolved from GITHUB_BASE_REF, as a `pull_request` run has. */
function base(ref: string): { base: string; source: string } {
  return { base: ref, source: "GITHUB_BASE_REF" };
}

const leases: string[] = [];

afterEach(() => {
  for (const lease of leases.splice(0))
    fs.rmSync(lease, { recursive: true, force: true });
});

/**
 * Writes a `pull_request` event payload, as Actions does at GITHUB_EVENT_PATH.
 *
 * @param number - The event's pull request number
 * @param baseRef - The event's `pull_request.base.ref`
 * @param repo - The event's `repository.full_name`
 * @returns The payload's path
 */
function eventFor(number: number, baseRef: string, repo = EVENT_REPO): string {
  return writeEvent({
    number,
    repository: { full_name: repo },
    pull_request: { number, base: { ref: baseRef } },
  });
}

/**
 * Writes an arbitrary event payload, for the shapes `eventFor` does not build.
 *
 * @param payload - The payload to write
 * @returns The payload's path
 */
function writeEvent(payload: Record<string, unknown>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "by-branch-event-"));
  leases.push(dir);
  const event = path.join(dir, "event.json");
  fs.writeFileSync(event, JSON.stringify(payload));
  return event;
}

/**
 * Writes a throwaway repository carrying one declaration.
 *
 * @param declaration - The declaration to write
 * @returns The repository root
 */
function repoDeclaring(declaration: Record<string, unknown>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "by-branch-"));
  leases.push(root);
  fs.mkdirSync(path.join(root, ".github", "workflows"), { recursive: true });
  fs.writeFileSync(
    path.join(root, CI_WORKFLOW.replace(/\//gu, path.sep)),
    "      skip_jobs: ''"
  );
  fs.writeFileSync(
    path.join(root, ".github", "required-checks.json"),
    JSON.stringify(declaration)
  );
  return root;
}

describe("absent required checks are judged against the PR's base branch (#4484)", () => {
  let mod: GuardModule;

  beforeAll(async () => {
    mod = (await import(
      pathToFileURL(path.join(REPO_ROOT, SCRIPT_REL)).href
    )) as unknown as GuardModule;
  });

  describe("negative controls — the two halves of the fix", () => {
    it("a staging-base PR missing only dev-only contexts PASSES", () => {
      // THE MEASURED DEFECT. Green on every context staging requires; the
      // nightly gate and the stage guard never run on a staging pull request.
      const result = mod.evaluateAbsentRequiredChecks(
        declarationWith(),
        rowsFor(BY_BRANCH.staging),
        { headSha: HEAD_SHA, base: base("staging") }
      );

      expect(result.absent).toEqual([]);
      expect(result.violations).toEqual([]);
      expect(result.checked).toBe(BY_BRANCH.staging.length);
      expect(result.requiredSet.source).toBe("branch");
      expect(result.requiredSet.fallback).toBeNull();
    });

    it("a staging-base PR missing a STAGING-required context still FAILS", () => {
      // The fix must narrow the set, never empty it. A staging context that did
      // not report is exactly what this arm exists to catch.
      const result = mod.evaluateAbsentRequiredChecks(
        declarationWith(),
        rowsFor([CODERABBIT, LINT]),
        { headSha: HEAD_SHA, base: base("staging") }
      );

      expect(result.absent).toEqual([STAGING_ONLY_EXTRA]);
      expect(result.violations).toHaveLength(1);
      expect(result.violations[0]?.kind).toBe(mod.VIOLATIONS.absent);
      expect(result.violations[0]?.message).toContain(HEAD_SHA);
      // The finding names the branch it was judged for, so an operator reading
      // it knows which ruleset to compare against.
      expect(result.violations[0]?.message).toContain("staging");
    });

    it("a dev-base PR missing a dev-only context still FAILS", () => {
      // The per-branch set is not "the smallest set": dev's own contexts are
      // still judged on dev.
      const result = mod.evaluateAbsentRequiredChecks(
        declarationWith(),
        rowsFor(BY_BRANCH.staging),
        { headSha: HEAD_SHA, base: base("dev") }
      );

      expect(result.absent).toEqual([NIGHTLY, STAGE_GUARD]);
      expect(result.requiredSet.source).toBe("branch");
    });
  });

  describe("the union fallback is taken only when it must be, and is REPORTED", () => {
    it("falls back to the union when the base has no per-branch set", () => {
      const result = mod.evaluateAbsentRequiredChecks(
        declarationWith(),
        rowsFor(BY_BRANCH.staging),
        { headSha: HEAD_SHA, base: base("release/9") }
      );

      // Union behaviour, exactly as before #4484 — the fallback does not make
      // the arm more lenient, only louder.
      expect(result.absent).toEqual([NIGHTLY, STAGE_GUARD]);
      expect(result.checked).toBe(UNION.length);
      expect(result.requiredSet.source).toBe("union");
      expect(result.requiredSet.fallback?.kind).toBe(FALLBACK_TOKEN);
      expect(result.requiredSet.fallback?.reason).toContain("release/9");
    });

    it("falls back, and reports it, for a union-only declaration (backward compatible)", () => {
      // A declaration written before #4484 keeps working exactly as it did:
      // same findings, same count. The only new thing is that it now SAYS it
      // judged against the union.
      const result = mod.evaluateAbsentRequiredChecks(
        legacyDeclaration(),
        rowsFor(BY_BRANCH.staging),
        { headSha: HEAD_SHA, base: base("staging") }
      );

      expect(result.absent).toEqual([NIGHTLY, STAGE_GUARD]);
      expect(result.violations.map(v => v.kind)).toEqual([
        mod.VIOLATIONS.absent,
        mod.VIOLATIONS.absent,
      ]);
      expect(result.requiredSet.source).toBe("union");
      expect(result.requiredSet.fallback?.kind).toBe(FALLBACK_TOKEN);
      expect(result.requiredSet.fallback?.reason).toContain(
        "required_contexts_by_branch"
      );
    });

    it.each([
      ["a union-only declaration", legacyDeclaration],
      ["a map with no set for the base", declarationWith],
    ])("names a remedy that needs no host refresh, for %s", (_label, build) => {
      // Lisa ships no refresh, and this script refuses `--remote`, so a
      // consumer of the shipped seed must be told how to record the set by
      // hand. A host refresh is mentioned only as an option.
      const result = mod.evaluateAbsentRequiredChecks(
        build(),
        rowsFor(BY_BRANCH.staging),
        { headSha: HEAD_SHA, base: base("qa") }
      );
      const reason = result.requiredSet.fallback?.reason ?? "";
      expect(reason).toContain("rules/branches/qa");
      expect(reason).toContain("required_contexts_by_branch.qa");
      expect(reason).toMatch(/if this repository has one/u);
    });

    it("says the run's own base was ignored when --pr named another pull request", () => {
      const selected = mod.selectRequiredContexts(declarationWith(), {
        base: null,
        source: null,
        ignoredEventBase: "dev",
      });
      expect(selected.source).toBe("union");
      expect(selected.fallback?.reason).toContain("`dev`");
      expect(selected.fallback?.reason).toContain("--base");
    });

    it("falls back, and reports it, when no base ref could be resolved", () => {
      const result = mod.evaluateAbsentRequiredChecks(
        declarationWith(),
        rowsFor(BY_BRANCH.staging),
        { headSha: HEAD_SHA, base: { base: null, source: null } }
      );

      expect(result.requiredSet.source).toBe("union");
      expect(result.requiredSet.fallback?.kind).toBe(FALLBACK_TOKEN);
      expect(result.requiredSet.fallback?.reason).toContain("--base");
    });

    it("exports the fallback token under a stable name", () => {
      expect(mod.REQUIRED_SET_FALLBACK).toBe(FALLBACK_TOKEN);
    });

    it("treats an EMPTY per-branch set as an answer, not as a missing one", () => {
      // A branch whose rulesets require nothing is a real state. Falling back
      // to the union there would reintroduce the false positive for it.
      const result = mod.evaluateAbsentRequiredChecks(
        declarationWith({
          required_contexts_by_branch: { ...BY_BRANCH, sandbox: [] },
        }),
        [],
        { headSha: HEAD_SHA, base: base("sandbox") }
      );

      expect(result.absent).toEqual([]);
      expect(result.requiredSet.source).toBe("branch");
      expect(result.requiredSet.fallback).toBeNull();
    });
  });

  describe("the selected set is printed, so a downstream run proves its path", () => {
    it("prints the per-branch line with the base and the count", () => {
      const selected = mod.selectRequiredContexts(
        declarationWith(),
        base("staging")
      );
      expect(selected.line).toBe(
        `required contexts: per-branch set for base 'staging' (${BY_BRANCH.staging.length} contexts)`
      );
    });

    it("prints the union-fallback line naming the base that had no set", () => {
      const selected = mod.selectRequiredContexts(
        legacyDeclaration(),
        base("staging")
      );
      expect(selected.line).toBe(
        "required contexts: union fallback (no set for base 'staging')"
      );
    });

    it("prints the union-fallback line when no base was resolved", () => {
      const selected = mod.selectRequiredContexts(declarationWith(), {
        base: null,
        source: null,
      });
      expect(selected.line).toBe(
        "required contexts: union fallback (no base ref resolved)"
      );
    });
  });

  describe("resolving the base ref", () => {
    it("prefers --base over everything", () => {
      expect(
        mod.resolveBaseRef(["--base=main"], { GITHUB_BASE_REF: "staging" })
      ).toEqual({ base: "main", source: "--base" });
    });

    it("reads GITHUB_BASE_REF, which every pull_request run carries", () => {
      expect(mod.resolveBaseRef([], { GITHUB_BASE_REF: "staging" })).toEqual({
        base: "staging",
        source: "GITHUB_BASE_REF",
      });
    });

    it("falls back to the event payload's pull_request.base.ref", () => {
      const event = writeEvent({
        pull_request: { number: 7, base: { ref: "dev" } },
      });
      expect(
        mod.resolveBaseRef([], {
          GITHUB_BASE_REF: "",
          GITHUB_EVENT_PATH: event,
        })
      ).toEqual({ base: "dev", source: "GITHUB_EVENT_PATH" });
    });

    it("strips a refs/heads/ prefix so it matches the declaration's keys", () => {
      expect(mod.resolveBaseRef(["--base", "refs/heads/staging"], {})).toEqual({
        base: "staging",
        source: "--base",
      });
    });

    it("returns null, not a guess, when nothing names the base", () => {
      expect(mod.resolveBaseRef([], {})).toEqual({ base: null, source: null });
    });

    describe("the run's own base belongs to the run's own pull request", () => {
      // A `--pr` that names a different pull request from the event's would
      // otherwise be judged against the EVENT's base: a dev-base PR inspected
      // from a staging-base run could pass while missing a dev-only context.
      it("ignores the event base when --pr names a different pull request", () => {
        const env = {
          GITHUB_BASE_REF: "staging",
          GITHUB_EVENT_PATH: eventFor(7, "staging"),
        };
        expect(mod.resolveBaseRef(["--pr=8"], env, { pr: "8" })).toEqual({
          base: null,
          source: null,
          ignoredEventBase: "staging",
        });
      });

      it("uses the event base when the inspected pull request IS the event's", () => {
        const env = {
          GITHUB_BASE_REF: "staging",
          GITHUB_EVENT_PATH: eventFor(7, "staging"),
        };
        expect(mod.resolveBaseRef(["--pr=7"], env, { pr: "7" })).toEqual({
          base: "staging",
          source: "GITHUB_BASE_REF",
        });
      });

      it("does not trust GITHUB_BASE_REF for a pull request no payload ties it to", () => {
        expect(
          mod.resolveBaseRef(
            ["--pr=1"],
            { GITHUB_BASE_REF: "staging" },
            {
              pr: "1",
            }
          )
        ).toEqual({ base: null, source: null, ignoredEventBase: "staging" });
      });

      it("still lets --base name the base of a foreign pull request", () => {
        const env = {
          GITHUB_BASE_REF: "staging",
          GITHUB_EVENT_PATH: eventFor(7, "staging"),
        };
        expect(
          mod.resolveBaseRef(["--pr=8", "--base=dev"], env, { pr: "8" })
        ).toEqual({ base: "dev", source: "--base" });
      });
    });

    describe("…and to the run's own REPOSITORY", () => {
      // PR numbers are per repository. `--repo=other/name --pr=7` from
      // owner/name's PR #7 run is a different pull request with the same number.
      const env = () => ({
        GITHUB_BASE_REF: "staging",
        GITHUB_EVENT_PATH: eventFor(7, "staging", EVENT_REPO),
      });

      it("ignores the event base when --repo names another repository", () => {
        expect(
          mod.resolveBaseRef(["--repo", OTHER_REPO, "--pr=7"], env(), {
            pr: "7",
            repo: OTHER_REPO,
          })
        ).toEqual({ base: null, source: null, ignoredEventBase: "staging" });
      });

      it("uses the event base when --repo names the event's own repository", () => {
        expect(
          mod.resolveBaseRef(["--repo=OWNER/Name", "--pr=7"], env(), {
            pr: "7",
            repo: "OWNER/Name",
          })
        ).toEqual({ base: "staging", source: "GITHUB_BASE_REF" });
      });

      it("reads the event's repository from GITHUB_REPOSITORY when the payload lacks it", () => {
        const event = writeEvent({
          pull_request: { number: 7, base: { ref: "dev" } },
        });
        const common = { GITHUB_EVENT_PATH: event, GITHUB_BASE_REF: "dev" };
        expect(
          mod.resolveBaseRef(
            [],
            { ...common, GITHUB_REPOSITORY: EVENT_REPO },
            {
              pr: "7",
              repo: EVENT_REPO,
            }
          )
        ).toEqual({ base: "dev", source: "GITHUB_BASE_REF" });
        expect(
          mod.resolveBaseRef(
            [],
            { ...common, GITHUB_REPOSITORY: OTHER_REPO },
            {
              pr: "7",
              repo: EVENT_REPO,
            }
          )
        ).toEqual({ base: null, source: null, ignoredEventBase: "dev" });
      });

      it("still lets --base name the base for a cross-repository inspection", () => {
        expect(
          mod.resolveBaseRef(["--base=main"], env(), {
            pr: "7",
            repo: OTHER_REPO,
          })
        ).toEqual({ base: "main", source: "--base" });
      });
    });
  });

  describe("the declaration's shape", () => {
    it("loads a declaration carrying per-branch sets", () => {
      const loaded = mod.loadDeclaration(repoDeclaring(declarationWith()));
      expect(loaded.required_contexts_by_branch).toEqual(BY_BRANCH);
    });

    it("still loads a union-only declaration", () => {
      expect(() =>
        mod.loadDeclaration(repoDeclaring(legacyDeclaration()))
      ).not.toThrow();
    });

    it.each([
      ["an array", [CODERABBIT]],
      ["a string", "staging"],
      ["a branch whose value is not an array", { staging: CODERABBIT }],
      ["a branch listing a non-string", { staging: [CODERABBIT, 7] }],
    ])("refuses required_contexts_by_branch as %s", (_label, value) => {
      expect(() =>
        mod.loadDeclaration(
          repoDeclaring(declarationWith({ required_contexts_by_branch: value }))
        )
      ).toThrow(/required_contexts_by_branch/u);
    });

    it("refuses a per-branch context the union does not carry", () => {
      // The union is DEFINED as the union of the per-branch sets. A member
      // missing from it means the two were written at different times, and one
      // of them is stale — the guard names it rather than picking one.
      expect(() =>
        mod.loadDeclaration(
          repoDeclaring(
            declarationWith({
              required_contexts_by_branch: {
                ...BY_BRANCH,
                staging: [...BY_BRANCH.staging, "Renamed Check"],
              },
            })
          )
        )
      ).toThrow(/Renamed Check/u);
    });
  });

  describe("cache staleness is unchanged by per-branch sets", () => {
    it("an empty stamp is still untrusted, per-branch sets or not", () => {
      const trust = mod.snapshotTrust(
        declarationWith({ ruleset: { baseline_fetched_at: "" } })
      );
      expect(trust.trusted).toBe(false);
    });

    it("a stamped declaration with per-branch sets is still trusted", () => {
      expect(mod.snapshotTrust(declarationWith()).trusted).toBe(true);
    });
  });

  describe("inspectVacuity selects by the run's base ref", () => {
    it("drops dev-only absences on a staging-base run", () => {
      // The shape `review-evidence.yml` really runs in: no `--pr`, the pull
      // request and its base both read from the event this run carries.
      const inspection = mod.inspectVacuity(
        ["--vacuity", NO_WAIT],
        declarationWith(),
        {
          env: {
            GITHUB_BASE_REF: "staging",
            GITHUB_EVENT_PATH: eventFor(1, "staging"),
          },
          fetch: () => rowsFor(BY_BRANCH.staging),
          headSha: () => HEAD_SHA,
        }
      );

      expect(inspection?.absent).toEqual([]);
      expect(
        inspection?.violations.filter(v => v.kind === mod.VIOLATIONS.absent)
      ).toEqual([]);
      expect(inspection?.requiredSet?.source).toBe("branch");
      expect(inspection?.requiredSet?.base).toBe("staging");
    });

    it("does not judge a foreign --pr against the run's own base", () => {
      // NEGATIVE CONTROL for the cross-PR case: PR #2 is inspected from PR #1's
      // staging-base run. Its base is unknown here, so it is judged against the
      // union — the dev-only absences are still reported — and the fallback
      // says why.
      const inspection = mod.inspectVacuity(
        ["--vacuity", "--pr=2", NO_WAIT],
        declarationWith(),
        {
          env: {
            GITHUB_BASE_REF: "staging",
            GITHUB_EVENT_PATH: eventFor(1, "staging"),
          },
          fetch: () => rowsFor(BY_BRANCH.staging),
          headSha: () => HEAD_SHA,
        }
      );

      expect(inspection?.absent).toEqual([NIGHTLY, STAGE_GUARD]);
      expect(inspection?.requiredSet?.source).toBe("union");
      expect(inspection?.requiredSet?.fallback?.kind).toBe(FALLBACK_TOKEN);
    });

    it("does not judge another repository's same-numbered PR against the run's base", () => {
      // NEGATIVE CONTROL for the cross-repository case: same number, different
      // repository, so a different pull request.
      const inspection = mod.inspectVacuity(
        ["--vacuity", `--repo=${OTHER_REPO}`, "--pr=1", NO_WAIT],
        declarationWith(),
        {
          env: {
            GITHUB_BASE_REF: "staging",
            GITHUB_EVENT_PATH: eventFor(1, "staging", EVENT_REPO),
          },
          fetch: () => rowsFor(BY_BRANCH.staging),
          headSha: () => HEAD_SHA,
        }
      );

      expect(inspection?.absent).toEqual([NIGHTLY, STAGE_GUARD]);
      expect(inspection?.requiredSet?.source).toBe("union");
      expect(inspection?.requiredSet?.fallback?.kind).toBe(FALLBACK_TOKEN);
    });
  });
});

/**
 * Installs a `gh` on PATH that serves one head and its check rows.
 *
 * @param rows - Rows `gh pr checks --json` prints
 * @returns A directory to prepend to PATH
 */
function stubGh(rows: readonly CheckRow[]): string {
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), "by-branch-bin-"));
  leases.push(bin);
  const payload = path.join(bin, "checks.json");
  fs.writeFileSync(payload, `${JSON.stringify(rows)}\n`);
  fs.writeFileSync(
    path.join(bin, "gh"),
    `#!/bin/sh
case "$1:$2" in
  pr:view) printf '%s\\n' ${JSON.stringify(HEAD_SHA)} ;;
  pr:checks) cat ${JSON.stringify(payload)} ;;
  api:*/pulls/*/commits*) printf '%s\\n' '[]' ;;
  api:*/pulls/*/reviews*) printf '%s\\n' '[]' ;;
  api:*/commits/*/pulls*) printf '%s\\n' '[]' ;;
  api:*/pulls/*) printf '%s\\n' '0' ;;
  api:*status*) cat ${JSON.stringify(payload)} ;;
  api:*check-runs*) printf '%s\\n' '[]' ;;
  *) exit 1 ;;
esac
`,
    { mode: 0o755 }
  );
  return bin;
}

/**
 * Runs the shipped CLI against a throwaway repository on a given base.
 *
 * @param root - Repository root
 * @param baseRef - The GITHUB_BASE_REF the run carries
 * @param bin - Directory holding the `gh` stub
 * @returns Exit status and combined output
 */
function runCli(
  root: string,
  baseRef: string,
  bin: string
): { status: number; output: string } {
  const run = boundedSpawnSync({
    label: "check-skipped-required-checks.mjs --vacuity (by branch)",
    command: process.execPath,
    args: [
      path.join(REPO_ROOT, SCRIPT_REL),
      root,
      "--vacuity",
      "--pr=1",
      NO_WAIT,
      "--repo=owner/name",
    ],
    env: {
      ...process.env,
      PATH: `${bin}${path.delimiter}${process.env.PATH ?? ""}`,
      // The pull_request event this run would carry: PR #1 into `baseRef`.
      GITHUB_EVENT_PATH: eventFor(1, baseRef),
      GITHUB_REF: "",
      GITHUB_STEP_SUMMARY: "",
      GITHUB_OUTPUT: "",
      GITHUB_BASE_REF: baseRef,
    },
  });
  return {
    status: run.status ?? -1,
    output: `${run.stdout ?? ""}${run.stderr ?? ""}`,
  };
}

describe("the shipped CLI prints which set it judged against (#4484)", () => {
  it("prints the per-branch line on a staging-base run and passes", () => {
    const root = repoDeclaring(declarationWith());
    const run = runCli(root, "staging", stubGh(rowsFor(BY_BRANCH.staging)));

    expect(run.output).toContain(
      `required contexts: per-branch set for base 'staging' (${BY_BRANCH.staging.length} contexts)`
    );
    expect(run.output).not.toContain("absent_required_check");
    expect(run.output).not.toContain(FALLBACK_TOKEN);
    expect(run.status).toBe(0);
  });

  it("prints the union-fallback line and the named token for a union-only declaration", () => {
    const root = repoDeclaring(legacyDeclaration());
    const run = runCli(root, "staging", stubGh(rowsFor(BY_BRANCH.staging)));

    expect(run.output).toContain(
      "required contexts: union fallback (no set for base 'staging')"
    );
    // Loud: a named annotation, not only a line in the summary.
    expect(run.output).toContain(`::warning title=${FALLBACK_TOKEN}::`);
    // And the union's verdict is unchanged — the dev-only contexts still block.
    expect(run.output).toContain("absent_required_check");
    expect(run.status).not.toBe(0);
  });
});
