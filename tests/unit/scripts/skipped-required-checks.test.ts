/**
 * Tests for the skipped-required-check guard.
 *
 * The defect it refuses: **GitHub counts a `skipped` required status check as
 * SATISFIED.** A job named in `skip_jobs` still reports a green checkmark
 * against its required context having run zero steps, so the merge gate can
 * never be red and therefore can never block anything — a repository that looks
 * fully gated while shipping past a check nobody ran. Measured in acmeorgd
 * (TUN-402) and in gemini, where a ruleset required
 * `🔍 Quality Checks / 🎭 Playwright E2E Tests` while `ci.yml` skipped it
 * unconditionally.
 *
 * The guard rests on two REVIEWED SNAPSHOTS that police each other, so most of
 * what is proven here is the coherence between them.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const SCRIPT_REL =
  "typescript/copy-overwrite/scripts/check-skipped-required-checks.mjs";

/** One violation. */
interface Violation {
  readonly kind: string;
  readonly token: string | null;
  readonly message: string;
}

/** What the guard exports, as this suite consumes it. */
interface GuardModule {
  readonly DECLARATION_PATH: string;
  readonly VIOLATIONS: Record<string, string>;
  readSkipJobs(contents: string, sourcePath: string): string[];
  unquoteScalar(raw: string): string;
  loadDeclaration(rootDir: string): Record<string, unknown>;
  collectSkipJobTokens(
    rootDir: string,
    workflows: readonly string[]
  ): { tokens: string[] };
  evaluateSkippedRequiredChecks(
    declaration: Record<string, unknown>,
    skipped: readonly string[]
  ): { violations: Violation[]; checked: number };
}

const REQUIRED = "🔍 Quality Checks / 🧪 Run E2E Tests";
const CI_WORKFLOW = ".github/workflows/ci.yml";
const NOT_REQUIRED = "🔍 Quality Checks / 🕷️ OWASP ZAP Baseline";

describe("check-skipped-required-checks", () => {
  let mod: GuardModule;

  beforeAll(async () => {
    mod = (await import(
      pathToFileURL(path.join(REPO_ROOT, SCRIPT_REL)).href
    )) as unknown as GuardModule;
  });

  describe("reading `skip_jobs` out of a workflow", () => {
    it("reads a quoted, a double-quoted and a bare inline list", () => {
      expect(mod.readSkipJobs("      skip_jobs: 'a,b'", "w.yml")).toEqual([
        "a",
        "b",
      ]);
      expect(mod.readSkipJobs('      skip_jobs: "a, b"', "w.yml")).toEqual([
        "a",
        "b",
      ]);
      expect(mod.readSkipJobs("      skip_jobs: a,b", "w.yml")).toEqual([
        "a",
        "b",
      ]);
    });

    it("IGNORES a `skip_jobs` quoted inside a comment", () => {
      // The `^` anchor is load-bearing: workflow headers routinely quote
      // `skip_jobs` in prose, and an unanchored regex really does harvest
      // tokens out of documentation.
      const contents = [
        "# We used to pass skip_jobs: 'evil_token' here.",
        "      skip_jobs: 'real'",
      ].join("\n");
      expect(mod.readSkipJobs(contents, "w.yml")).toEqual(["real"]);
    });

    it("keeps a `#` that is DATA inside a quoted scalar", () => {
      expect(mod.unquoteScalar("'a#b'")).toBe("a#b");
    });

    it("strips a trailing comment after a quoted scalar", () => {
      expect(mod.unquoteScalar("'a,b' # note")).toBe("a,b");
    });

    it("REFUSES a value it cannot read inline rather than reading it as empty", () => {
      // "Nothing is skipped" is a silent pass, not a check.
      for (const value of ["skip_jobs: >-", "skip_jobs: |", "skip_jobs:"]) {
        expect(() => mod.readSkipJobs(`      ${value}`, "w.yml")).toThrow(
          /cannot read the `skip_jobs` value/
        );
      }
    });

    it("reads an expression CONSERVATIVELY, ignoring comparison operands", () => {
      // `schedule` is the condition's operand, not a skip token: reporting it
      // would be a false alarm whose obvious fix is to weaken the guard.
      const line =
        "      skip_jobs: ${{ github.event_name == 'schedule' && 'a,b' || 'a' }}";
      expect(mod.readSkipJobs(line, "w.yml")).toEqual(["a", "b"]);
    });

    it("de-duplicates across multiple declarations", () => {
      const contents = ["  skip_jobs: 'a,b'", "  skip_jobs: 'b,c'"].join("\n");
      expect(mod.readSkipJobs(contents, "w.yml")).toEqual(["a", "b", "c"]);
    });
  });

  describe("the coherence rules between the two snapshots", () => {
    /**
     * Builds a declaration around one token.
     *
     * @param token - The skip token
     * @param entry - Its declaration
     * @param required - The required-context snapshot
     * @returns A declaration document
     */
    const declaration = (
      token: string,
      entry: Record<string, unknown>,
      required: readonly string[] = [REQUIRED]
    ): Record<string, unknown> => ({
      required_contexts: required,
      workflows: [CI_WORKFLOW],
      skip_job_declarations: { [token]: entry },
    });

    it("an UNDECLARED skip token is a violation — nobody reviewed it", () => {
      const result = mod.evaluateSkippedRequiredChecks(
        declaration("known", {
          suppressed_contexts: [],
          ruleset_required: false,
        }),
        ["known", "surprise"]
      );
      expect(result.violations.map(violation => violation.kind)).toContain(
        mod.VIOLATIONS.undeclared
      );
    });

    it("a token that silences a REQUIRED context is the false green, and fails", () => {
      const result = mod.evaluateSkippedRequiredChecks(
        declaration("test:e2e", {
          suppressed_contexts: [REQUIRED],
          ruleset_required: true,
        }),
        ["test:e2e"]
      );
      expect(result.violations).toHaveLength(1);
      expect(result.violations[0].kind).toBe(mod.VIOLATIONS.suppressesRequired);
      expect(result.violations[0].message).toContain(
        "counts a SKIPPED required check as SATISFIED"
      );
    });

    it("a declaration UNDERSTATING the requirement is caught by the other snapshot", () => {
      const result = mod.evaluateSkippedRequiredChecks(
        declaration("test:e2e", {
          suppressed_contexts: [REQUIRED],
          ruleset_required: false,
        }),
        ["test:e2e"]
      );
      expect(result.violations.map(violation => violation.kind)).toContain(
        mod.VIOLATIONS.incoherent
      );
    });

    it("a declaration OVERSTATING the requirement is caught too (renamed/de-required)", () => {
      const result = mod.evaluateSkippedRequiredChecks(
        declaration("zap", {
          suppressed_contexts: [NOT_REQUIRED],
          ruleset_required: true,
        }),
        ["zap"]
      );
      expect(result.violations.map(violation => violation.kind)).toContain(
        mod.VIOLATIONS.stale
      );
    });

    it("a skip that silences NOTHING required is fine", () => {
      const result = mod.evaluateSkippedRequiredChecks(
        declaration("zap", {
          suppressed_contexts: [NOT_REQUIRED],
          ruleset_required: false,
        }),
        ["zap"]
      );
      expect(result.violations).toEqual([]);
    });

    it("an exemption with a real ticket permits the skip", () => {
      const result = mod.evaluateSkippedRequiredChecks(
        declaration("test:e2e", {
          suppressed_contexts: [REQUIRED],
          ruleset_required: true,
          exemption: { ticket: "TUN-375", reason: "fix-vs-de-require is open" },
        }),
        ["test:e2e"]
      );
      expect(result.violations).toEqual([]);
    });

    it("an exemption without a valid ticket does NOT permit the skip", () => {
      // An exemption is a decision someone owns; without a ticket it is just a
      // way to silence this guard.
      const result = mod.evaluateSkippedRequiredChecks(
        declaration("test:e2e", {
          suppressed_contexts: [REQUIRED],
          ruleset_required: true,
          exemption: { reason: "later" },
        }),
        ["test:e2e"]
      );
      expect(result.violations[0].kind).toBe(mod.VIOLATIONS.badExemption);
    });

    it("an ORPHANED exemption is a violation — a fiction the list keeps telling", () => {
      const result = mod.evaluateSkippedRequiredChecks(
        declaration("test:e2e", {
          suppressed_contexts: [REQUIRED],
          ruleset_required: true,
          exemption: { ticket: "TUN-375", reason: "…" },
        }),
        []
      );
      expect(result.violations.map(violation => violation.kind)).toEqual([
        mod.VIOLATIONS.orphaned,
      ]);
    });

    it("compares by EXACT string equality — confusable pairs must not collide", () => {
      // An external app's required `SonarCloud Code Analysis` sits beside a
      // skippable, NOT-required in-workflow `🔍 Static Security Analysis`.
      // These two no longer LOOK alike — the job was renamed off the vendor —
      // and the case is kept exactly for that reason: the guard must still
      // refuse to relate them, and a fuzzy matcher reintroduced later would
      // find `Analysis` in both. The natural fix for a false alarm is to
      // delete the guard, so the guard has to not raise one.
      const result = mod.evaluateSkippedRequiredChecks(
        {
          required_contexts: ["SonarCloud Code Analysis"],
          workflows: ["w"],
          skip_job_declarations: {
            sonarcloud: {
              suppressed_contexts: [
                "🔍 Quality Checks / 🔍 Static Security Analysis",
              ],
              ruleset_required: false,
            },
          },
        },
        ["sonarcloud"]
      );
      expect(result.violations).toEqual([]);
    });
  });

  describe("refusing to report a clean bill of health for nothing", () => {
    let root: string;

    beforeAll(() => {
      root = fs.mkdtempSync(path.join(os.tmpdir(), "skipreq-"));
      fs.mkdirSync(path.join(root, ".github", "workflows"), {
        recursive: true,
      });
    });

    it("fails when the declaration file is absent", () => {
      expect(() => mod.loadDeclaration(root)).toThrow(/does not exist/);
    });

    it("REFUSES a malformed declaration entry rather than treating it as harmless", () => {
      // `"test:e2e": true` reads as "declared" at the point of use, then yields
      // no suppressed contexts and therefore no violation — the guard becomes a
      // no-op for exactly the token someone was documenting.
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "skipreq-bad-"));
      fs.mkdirSync(path.join(dir, ".github"), { recursive: true });
      for (const bad of [
        true,
        "not required",
        ["x"],
        { ruleset_required: false },
      ]) {
        fs.writeFileSync(
          path.join(dir, ".github", "required-checks.json"),
          JSON.stringify({
            required_contexts: [REQUIRED],
            workflows: [CI_WORKFLOW],
            skip_job_declarations: { "test:e2e": bad },
          })
        );
        expect(() => mod.loadDeclaration(dir)).toThrow(
          /malformed|suppressed_contexts/
        );
      }
    });

    it("fails when a declared workflow does not exist", () => {
      expect(() =>
        mod.collectSkipJobTokens(root, [".github/workflows/ghost.yml"])
      ).toThrow(/clean bill of health for a repository it never looked at/);
    });
  });

  describe("the shipped seeds are coherent against the shipped ci.yml templates", () => {
    it.each([
      ["expo", "expo/create-only", "expo/create-only"],
      ["nestjs", "nestjs/create-only", "nestjs/create-only"],
      ["typescript", "typescript/create-only", "typescript/create-only"],
    ])(
      "%s: its required-checks.json declares every token its ci.yml skips",
      (_type, declarationDir, workflowDir) => {
        const declaration = JSON.parse(
          fs.readFileSync(
            path.join(
              REPO_ROOT,
              declarationDir,
              ".github/required-checks.json"
            ),
            "utf-8"
          )
        ) as Record<string, unknown>;
        const tokens = mod.readSkipJobs(
          fs.readFileSync(
            path.join(REPO_ROOT, workflowDir, CI_WORKFLOW),
            "utf-8"
          ),
          "ci.yml"
        );
        const result = mod.evaluateSkippedRequiredChecks(declaration, tokens);
        expect(result.violations).toEqual([]);
      }
    );
  });
});
