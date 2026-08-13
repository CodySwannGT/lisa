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

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const SCRIPT_REL =
  "typescript/copy-overwrite/scripts/check-skipped-required-checks.mjs";
const CI_WORKFLOW = ".github/workflows/ci.yml";
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
  };
}

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
        "      skip_jobs: ''"
      );
      fs.writeFileSync(
        path.join(root, ".github", "required-checks.json"),
        JSON.stringify({
          ...(enforcement === undefined ? {} : { enforcement }),
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
});
