/**
 * Proof that every `.mjs` file Lisa INSTALLS into a consumer PASSES the ESLint
 * config Lisa installs alongside it.
 *
 * The sibling suite (`eslint-shipped-mjs-coverage.test.ts`) proves the shipped
 * scripts are INSIDE the shipped config — that `--print-config` answers with
 * rules instead of nothing. Coverage is not cleanliness, and the difference
 * shipped: once `scripts/**` came out of the ignore list, a consumer that
 * updated Lisa inherited errors in files Lisa itself wrote and overwrites. A
 * host cannot fix those. Editing a managed file forks it from upstream and
 * stops future refreshes, so the only local remedy is to put the ignore back —
 * re-hiding every one of these files, which is the defect the ignore removal
 * existed to end.
 *
 * Lisa's own `eslint .` cannot catch this, and cannot be made to. Its
 * project-local config globally ignores the template trees (`all/**`,
 * `typescript/**`, `expo/**`, …) because they are payloads copied into other
 * repositories rather than this monorepo's source, and ESLint cannot unignore
 * a file inside an ignored DIRECTORY — the same measured limitation
 * `src/configs/eslint/base.ts` records for `!scripts/**\/*.mjs`. So the
 * enforcement surface for "the payload passes the ruleset that ships with it"
 * is this test, and only this test.
 *
 * The shipped set is DISCOVERED, never listed: a new `<stack>/copy-overwrite`
 * tree carrying `.mjs` files inherits these assertions with nobody remembering
 * to add it.
 *
 * It is discovered from the git INDEX, not from the disk. This gate is required
 * at push, and a push carries what is committed — so "what is on disk" is the
 * wrong authority for what it may block on. CodySwannGT/lisa#2824: an untracked
 * scratch `.mjs` in a shipped tree blocked a DIFFERENT agent sharing the
 * checkout, naming a file absent from their `git status`, absent from their
 * diff, and unattributable from their side. Untracked files under a shipped
 * tree are still linted and still reported here — see the `beforeAll` note —
 * they simply cannot fail the gate.
 */
import * as fs from "node:fs";
import * as path from "node:path";

import { ESLint } from "eslint";
import { beforeAll, describe, expect, it } from "vitest";

import { getTypescriptConfig } from "../../../src/configs/eslint/typescript.js";
import { ioLatencyBudgetMs } from "../../helpers/io-latency-budget.js";
import {
  shippedMjsRoster,
  untrackedFindingNote,
} from "../../helpers/shipped-mjs-roster.js";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

/**
 * Linting the whole shipped payload is slower than a unit test's default.
 *
 * Calibrated rather than fixed, for the reason CodySwannGT/lisa#2822 records: a
 * fixed wall-clock budget over a subprocess measures the machine. A per-case
 * budget also overrides the file-level one silently (CodySwannGT/lisa#2894).
 */
const LINT_TIMEOUT_MS = ioLatencyBudgetMs(300_000);

/**
 * The ReDoS rule the shipped scripts profile switches OFF for host scripts.
 *
 * Kept ON here, deliberately, for the files LISA ships. The profile's
 * rationale — these regexes read files already inside the checkout — is a
 * statement about a host's own maintenance scripts, and it is a suppression:
 * it depends on this exact rule ID resolving. A consumer resolving a different
 * `eslint-plugin-sonarjs` major, or an external scanner reading the same files
 * under the rule's SonarQube key (S5852), never sees the switch and reports the
 * finding. A shipped file that is genuinely linear is immune to all of that,
 * so Lisa's payload is held to the stricter bar than the profile it ships.
 */
const REDOS_RULE = "sonarjs/slow-regex";

/** The strict consumer rule that exposed declaration drift in release guards. */
const STATEMENT_ORDER_RULE = "code-organization/enforce-statement-order";

/** The release guard installed into every consumer's scripts directory. */
const RELEASE_IDENTITY_GUARD =
  "all/copy-overwrite/scripts/check-release-package-identity.mjs";

/**
 * The `ignores` array from the shipped `eslint.ignore.config.json` template.
 * @returns The ignore patterns Lisa stamps into a consumer
 */
function shippedIgnores(): readonly string[] {
  const parsed = JSON.parse(
    fs.readFileSync(
      path.join(
        REPO_ROOT,
        "typescript/copy-overwrite/eslint.ignore.config.json"
      ),
      "utf-8"
    )
  ) as { ignores?: readonly string[] };
  return parsed.ignores ?? [];
}

/**
 * An ESLint instance built exactly as a consumer's `eslint.config.ts` builds
 * one, optionally with extra rule severities layered last.
 * @param extraRules - Rules to force on top of the shipped profile
 * @returns An ESLint instance rooted at the repo
 */
function shippedEslint(extraRules: Record<string, "error"> = {}): ESLint {
  const shipped = getTypescriptConfig({
    tsconfigRootDir: REPO_ROOT,
    ignorePatterns: [...shippedIgnores()],
  });
  const layered = Object.keys(extraRules).length
    ? [...shipped, { files: ["**/*.mjs"], rules: extraRules }]
    : shipped;
  return new ESLint({
    cwd: REPO_ROOT,
    overrideConfigFile: true,
    overrideConfig: layered as ESLint.Options["overrideConfig"],
  });
}

/**
 * Every error-level finding in a set of files, as readable lines.
 * @param eslint - The instance under test
 * @param files - Repo-relative paths to lint
 * @returns One `path:line:col rule — message` line per error
 */
async function errorsIn(
  eslint: ESLint,
  files: readonly string[]
): Promise<readonly string[]> {
  if (files.length === 0) return [];
  const results = await eslint.lintFiles([...files]);
  return results.flatMap(result =>
    result.messages
      .filter(message => message.severity === 2)
      .map(
        message =>
          `${path.relative(REPO_ROOT, result.filePath)}:${message.line}:${
            message.column
          } ${message.ruleId} — ${message.message}`
      )
  );
}

const ROSTER = shippedMjsRoster(REPO_ROOT);
const SHIPPED_MJS = ROSTER.tracked;

describe("shipped .mjs files pass the shipped ruleset", () => {
  beforeAll(async () => {
    // Untracked files in a shipped tree are still LINTED — narrowing what a
    // gate blocks on is not licence to narrow what it looks at. Their findings
    // are printed, never asserted, and the whole step is wrapped because a
    // failure while examining files nobody committed must not be able to fail
    // this gate; that is precisely the defect being removed.
    try {
      const note = untrackedFindingNote(
        REPO_ROOT,
        await errorsIn(shippedEslint(), ROSTER.untracked)
      );
      if (note !== "") process.stderr.write(`\n${note}\n`);
    } catch (error) {
      process.stderr.write(
        `\n(could not lint untracked shipped-tree files: ${String(error)})\n`
      );
    }
  }, LINT_TIMEOUT_MS);

  it("discovers at least one shipped .mjs file", () => {
    // An empty discovery set would make every assertion below vacuously true.
    // Zero is never a pass here.
    expect(SHIPPED_MJS.length).toBeGreaterThan(0);
  });

  it(
    "reports no error-level finding in any file Lisa ships",
    async () => {
      expect(await errorsIn(shippedEslint(), SHIPPED_MJS)).toEqual([]);
    },
    LINT_TIMEOUT_MS
  );

  it(
    "reports no ReDoS finding either, with the scripts profile's suppression lifted",
    async () => {
      expect(
        await errorsIn(shippedEslint({ [REDOS_RULE]: "error" }), SHIPPED_MJS)
      ).toEqual([]);
    },
    LINT_TIMEOUT_MS
  );

  it(
    "keeps the release identity guard clean under strict consumer statement ordering",
    async () => {
      expect(
        await errorsIn(shippedEslint({ [STATEMENT_ORDER_RULE]: "error" }), [
          RELEASE_IDENTITY_GUARD,
        ])
      ).toEqual([]);
    },
    LINT_TIMEOUT_MS
  );

  it("still reports an error when one is actually there", async () => {
    // The negative control. Without it, a harness that had stopped reporting —
    // a config that resolves to nothing, a lint that silently skips `.mjs` —
    // would make both assertions above pass for the wrong reason, which is the
    // exact failure ("ran nothing, reported success") this file exists to end.
    const results = await shippedEslint().lintText(
      'const a = "a-duplicated-literal";\n' +
        'const b = "a-duplicated-literal";\n' +
        'const c = "a-duplicated-literal";\n' +
        "export default [a, b, c];\n",
      { filePath: path.join(REPO_ROOT, "scripts/__probe__.mjs") }
    );

    expect(
      results.flatMap(result =>
        result.messages
          .filter(message => message.severity === 2)
          .map(message => message.ruleId)
      )
    ).toContain("sonarjs/no-duplicate-string");
  });
});
