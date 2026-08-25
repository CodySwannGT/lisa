/**
 * Tests for the two properties that let the skipped-required-check guard be
 * WIRED INTO A SHIPPED WORKFLOW rather than left for adopters to invoke by hand.
 *
 * Sibling of `skipped-required-checks.test.ts`, which covers the guard's
 * coherence rules; these cover what changes once it runs unattended in every
 * repository:
 *
 *  - `enforcement` (#2426) — the adoption ramp. A seed cannot know which
 *    contexts a given repository's ruleset requires, so a seeded-but-unreviewed
 *    repo must be able to report findings without going red on the day Lisa
 *    installs the job. A gate that reddens a repository on arrival gets
 *    deleted, not fixed.
 *  - snapshot trust (#2476) — `required_contexts` is a CACHE of a live ruleset
 *    fetch, and an unstamped cache is not an answer. The seed Lisa shipped was
 *    measured wrong: it claimed a context was required that no ruleset
 *    required, and omitted six that were. A guard reading that would clear a
 *    genuinely-skipped required check and flag a non-required one — worse than
 *    a guard nobody runs, because it teaches people to trust it.
 *  - `whitespace_in_skip_token` (#2427) — GitHub Actions expression syntax has
 *    no string-replace, so `skip_jobs: 'test, test:e2e'` cannot be normalized
 *    in the workflow. It fails CLOSED (the job runs), so nothing unverified
 *    ships — but the skip silently did not happen, and until the guard ran in
 *    CI nothing anywhere could say so.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const SCRIPT_REL =
  "typescript/copy-overwrite/scripts/check-skipped-required-checks.mjs";
const CI_WORKFLOW = ".github/workflows/ci.yml";
const DECLARATION_REL = path.join(".github", "required-checks.json");
const EMPTY_SKIP_JOBS = "      skip_jobs: ''";
const REQUIRED = "🔍 Quality Checks / 🧪 Run E2E Tests";

/** One violation. */
interface Violation {
  readonly kind: string;
  readonly token: string | null;
  readonly message: string;
}

/** What the guard exports, as this suite consumes it. */
interface GuardModule {
  readonly VIOLATIONS: Record<string, string>;
  readonly SNAPSHOT_MAX_AGE_DAYS: number;
  snapshotTrust(
    declaration: Record<string, unknown>,
    now?: number
  ): { trusted: boolean; reason: string };
  evaluateSkippedRequiredChecks(
    declaration: Record<string, unknown>,
    skipped: readonly string[],
    options?: { trustRequiredContexts?: boolean }
  ): { violations: Violation[]; checked: number };
  readSkipJobs(
    contents: string,
    sourcePath: string,
    options?: { preserveWhitespace?: boolean }
  ): string[];
  loadDeclaration(rootDir: string): Record<string, unknown>;
  collectSkipJobTokens(
    rootDir: string,
    workflows: readonly string[]
  ): { tokens: string[]; violations: Violation[] };
  runGuard(argv: readonly string[]): {
    violations: Violation[];
    enforcement: string;
    trust: { trusted: boolean; reason: string };
  };
}

const DAY_MS = 86_400_000;

/**
 * Creates a throwaway repository with a `.github/workflows` directory.
 *
 * @param prefix - Temp-directory prefix
 * @returns The repository root
 */
function emptyRepo(prefix: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  fs.mkdirSync(path.join(root, ".github", "workflows"), { recursive: true });
  return root;
}

/**
 * Builds a repo whose declaration has never been transcribed.
 *
 * @param enforcement - Optional `enforcement` value to write
 * @returns The repository root
 */
function untranscribedRepo(enforcement?: string): string {
  const root = emptyRepo("skipreq-untranscribed-");
  fs.writeFileSync(
    path.join(root, CI_WORKFLOW.replace(/\//gu, path.sep)),
    EMPTY_SKIP_JOBS
  );
  fs.writeFileSync(
    path.join(root, DECLARATION_REL),
    JSON.stringify({
      ...(enforcement === undefined ? {} : { enforcement }),
      ruleset: { repo: "", ids: [], baseline_fetched_at: "" },
      required_contexts: [],
      workflows: [CI_WORKFLOW],
      skip_job_declarations: {},
    })
  );
  return root;
}

describe("check-skipped-required-checks, as a shipped CI job", () => {
  let mod: GuardModule;

  beforeAll(async () => {
    mod = (await import(
      pathToFileURL(path.join(REPO_ROOT, SCRIPT_REL)).href
    )) as unknown as GuardModule;
  });

  describe("a skip token written with whitespace (#2427)", () => {
    /**
     * Builds a repo whose ci.yml carries one `skip_jobs` value.
     *
     * @param value - The raw scalar to write after `skip_jobs:`
     * @returns The repo root
     */
    const repoSkipping = (value: string): string => {
      const root = emptyRepo("skipreq-ws-");
      fs.writeFileSync(
        path.join(root, CI_WORKFLOW.replace(/\//gu, path.sep)),
        ["jobs:", "  quality:", "    with:", `      skip_jobs: ${value}`].join(
          "\n"
        )
      );
      return root;
    };

    it("reads tokens EXACTLY as written when asked to preserve whitespace", () => {
      // Trimming is what erases the evidence: once normalized, a spaced token
      // looks identical to a correctly written one.
      expect(
        mod.readSkipJobs("      skip_jobs: 'test, test:e2e'", "w.yml", {
          preserveWhitespace: true,
        })
      ).toEqual(["test", " test:e2e"]);
    });

    it("reports `test, test:e2e` — the space makes the token match NOTHING", () => {
      const collected = mod.collectSkipJobTokens(
        repoSkipping("'test, test:e2e'"),
        [CI_WORKFLOW]
      );
      expect(collected.violations.map(violation => violation.kind)).toEqual([
        mod.VIOLATIONS.whitespace,
      ]);
      expect(collected.violations[0].token).toBe("test:e2e");
      expect(collected.violations[0].message).toContain("fails closed");
    });

    it("reports a lone ` test ` padded on both sides", () => {
      const collected = mod.collectSkipJobTokens(repoSkipping("' test '"), [
        CI_WORKFLOW,
      ]);
      expect(collected.violations.map(violation => violation.kind)).toEqual([
        mod.VIOLATIONS.whitespace,
      ]);
      expect(collected.violations[0].token).toBe("test");
    });

    it("still carries the TRIMMED token forward — over-report, never under-report", () => {
      // The job is not actually skipped, so this over-reports. That is the safe
      // direction, and the whitespace violation beside it explains why the
      // token showed up at all.
      expect(
        mod.collectSkipJobTokens(repoSkipping("'test, test:e2e'"), [
          CI_WORKFLOW,
        ]).tokens
      ).toEqual(["test", "test:e2e"]);
    });

    it("says nothing about a correctly written list", () => {
      const collected = mod.collectSkipJobTokens(
        repoSkipping("'test,test:e2e'"),
        [CI_WORKFLOW]
      );
      expect(collected.violations).toEqual([]);
      expect(collected.tokens).toEqual(["test", "test:e2e"]);
    });
  });

  describe("an untranscribed `required_contexts` is NOT AN ANSWER (#2476)", () => {
    const REQUIRED_RULES = ["skipped_required_check"];

    it("refuses an EMPTY `baseline_fetched_at` — the state Lisa's seeds ship in", () => {
      const trust = mod.snapshotTrust({ ruleset: { baseline_fetched_at: "" } });
      expect(trust.trusted).toBe(false);
      // The reason has to name the measured failure, or the next person
      // "fixes" the refusal by deleting the check.
      expect(trust.reason).toContain("measured WRONG");
    });

    it("refuses a MISSING ruleset block, and a stamp it cannot parse", () => {
      expect(mod.snapshotTrust({}).trusted).toBe(false);
      expect(
        mod.snapshotTrust({ ruleset: { baseline_fetched_at: "last tuesday" } })
          .trusted
      ).toBe(false);
    });

    it("trusts a fresh stamp and EXPIRES an old one", () => {
      const now = Date.parse("2026-08-13T00:00:00Z");
      const at = (days: number): Record<string, unknown> => ({
        ruleset: {
          baseline_fetched_at: new Date(now - days * DAY_MS).toISOString(),
        },
      });
      expect(mod.snapshotTrust(at(1), now).trusted).toBe(true);
      expect(
        mod.snapshotTrust(at(mod.SNAPSHOT_MAX_AGE_DAYS - 1), now).trusted
      ).toBe(true);
      expect(
        mod.snapshotTrust(at(mod.SNAPSHOT_MAX_AGE_DAYS + 1), now).trusted
      ).toBe(false);
    });

    it("SUPPRESSES every rule that reads `required_contexts` when untrusted", () => {
      // The false-green rule would otherwise fire off a fabricated list — the
      // exact "confident wrong answer" #2476 measured.
      const declaration = {
        required_contexts: [REQUIRED],
        workflows: [CI_WORKFLOW],
        skip_job_declarations: {
          "test:e2e": {
            suppressed_contexts: [REQUIRED],
            ruleset_required: true,
          },
        },
      };
      expect(
        mod
          .evaluateSkippedRequiredChecks(declaration, ["test:e2e"])
          .violations.map(violation => violation.kind)
      ).toEqual(REQUIRED_RULES);
      expect(
        mod.evaluateSkippedRequiredChecks(declaration, ["test:e2e"], {
          trustRequiredContexts: false,
        }).violations
      ).toEqual([]);
    });

    it("KEEPS the rules that do not read it — an undeclared token is still undeclared", () => {
      const violations = mod.evaluateSkippedRequiredChecks(
        {
          required_contexts: [REQUIRED],
          workflows: [CI_WORKFLOW],
          skip_job_declarations: {},
        },
        ["surprise"],
        { trustRequiredContexts: false }
      ).violations;
      expect(violations.map(violation => violation.kind)).toEqual([
        mod.VIOLATIONS.undeclared,
      ]);
    });

    it("reports the refusal through runGuard rather than a clean verdict", () => {
      const result = mod.runGuard([untranscribedRepo()]);
      expect(result.trust.trusted).toBe(false);
      expect(result.violations).toEqual([]);
    });

    it("the CLI prints NOT CHECKED, never a ✅, and exits non-zero", () => {
      const run = boundedSpawnSync({
        label: "check-skipped-required-checks.mjs",
        command: process.execPath,
        args: [path.join(REPO_ROOT, SCRIPT_REL), untranscribedRepo()],
      });
      expect(run.stdout).toContain("NOT CHECKED");
      expect(run.stdout).not.toContain("✅");
      expect(run.status).toBe(1);
    });

    it("`enforcement: warn` keeps the refusal loud but exits 0", () => {
      // A fresh install must not redden a whole fleet on arrival — that is how
      // a gate gets deleted instead of transcribed. It still never says ✅.
      const run = boundedSpawnSync({
        label: "check-skipped-required-checks.mjs (enforcement: warn)",
        command: process.execPath,
        args: [path.join(REPO_ROOT, SCRIPT_REL), untranscribedRepo("warn")],
      });
      expect(run.stdout).toContain("NOT CHECKED");
      expect(run.stdout).not.toContain("✅");
      expect(run.status).toBe(0);
    });
  });

  describe("the shipped seeds ship UNTRANSCRIBED (#2476)", () => {
    it.each([
      "expo/create-only",
      "nestjs/create-only",
      "typescript/create-only",
    ])("%s ships no guessed required_contexts and no stamp", seedDir => {
      const seed = JSON.parse(
        fs.readFileSync(path.join(REPO_ROOT, seedDir, DECLARATION_REL), "utf-8")
      ) as Record<string, never>;
      expect(seed.required_contexts).toEqual([]);
      expect(seed.ruleset.baseline_fetched_at).toBe("");
      expect(mod.snapshotTrust(seed).trusted).toBe(false);
    });
  });

  describe("`enforcement`, the adoption ramp (#2426)", () => {
    /**
     * Writes a declaration carrying one `enforcement` value.
     *
     * @param enforcement - The value to write, or undefined to omit the key
     * @returns The repo root
     */
    const repoDeclaring = (enforcement?: unknown): string => {
      const root = emptyRepo("skipreq-mode-");
      fs.writeFileSync(
        path.join(root, CI_WORKFLOW.replace(/\//gu, path.sep)),
        EMPTY_SKIP_JOBS
      );
      fs.writeFileSync(
        path.join(root, DECLARATION_REL),
        JSON.stringify({
          ...(enforcement === undefined ? {} : { enforcement }),
          ruleset: { baseline_fetched_at: new Date().toISOString() },
          required_contexts: [REQUIRED],
          workflows: [CI_WORKFLOW],
          skip_job_declarations: {},
        })
      );
      return root;
    };

    it("ENFORCES when the key is absent — a hand-written declaration is an opt-in", () => {
      expect(mod.runGuard([repoDeclaring()]).enforcement).toBe("error");
    });

    it("carries `warn` through so the caller can downgrade its findings", () => {
      expect(mod.runGuard([repoDeclaring("warn")]).enforcement).toBe("warn");
    });

    it("REFUSES an unrecognised mode rather than silently enforcing or not", () => {
      // A typo that quietly downgrades this guard to advice is the fail-open
      // shape the whole file exists to refuse.
      expect(() => mod.loadDeclaration(repoDeclaring("warning"))).toThrow(
        /`enforcement` must be one of/u
      );
    });
  });

  describe("review-evidence vocabulary validation", () => {
    /**
     * Writes one evidence-bearing vocabulary value into a complete declaration.
     *
     * @param list - Vocabulary key under test
     * @param value - Value to validate
     * @returns The repo root
     */
    const repoWithVocabulary = (list: string, value: unknown): string => {
      const root = emptyRepo("review-vocabulary-");
      fs.writeFileSync(
        path.join(root, CI_WORKFLOW.replace(/\//gu, path.sep)),
        EMPTY_SKIP_JOBS
      );
      fs.writeFileSync(
        path.join(root, DECLARATION_REL),
        JSON.stringify({
          ruleset: { baseline_fetched_at: new Date().toISOString() },
          required_contexts: ["CodeRabbit"],
          workflows: [CI_WORKFLOW],
          skip_job_declarations: {},
          evidence_bearing_checks: {
            CodeRabbit: { [list]: value },
          },
        })
      );
      return root;
    };

    it.each([
      ["satisfy", "Review completed"],
      ["waive", 5],
      ["satisfy", {}],
      ["waive", ["Review rate limited", 7]],
    ])(
      "REFUSES malformed %s vocabulary before it can be consumed",
      (list, value) => {
        expect(() =>
          mod.loadDeclaration(repoWithVocabulary(list, value))
        ).toThrow(
          new RegExp(
            `evidence_bearing_checks\\.CodeRabbit\\.${list}.*array`,
            "u"
          )
        );
      }
    );

    it.each(["satisfy", "waive"])(
      "accepts a valid %s vocabulary without changing its entries",
      list => {
        const declaration = mod.loadDeclaration(
          repoWithVocabulary(list, ["One exact phrase"])
        ) as {
          evidence_bearing_checks: Record<
            string,
            Record<string, readonly string[]>
          >;
        };
        expect(declaration.evidence_bearing_checks.CodeRabbit[list]).toEqual([
          "One exact phrase",
        ]);
      }
    );
  });
});
