/**
 * Every shipped copy of a guard carries the behavioural arms its policy has.
 *
 * ## The defect this exists to make visible
 *
 * CodySwannGT/lisa#3781 taught two guards that `bash -n <file>` is a syntax
 * check — the shell reads the file and runs not one line of it — so the file it
 * names is not a file the command executes. The arm landed on 11 of the 20
 * shipped copies. The other 9 arrived on `main` from a concurrent branch after
 * the fix branch was cut.
 *
 * **A full push gate ran with the gap open and `test-correctness` and
 * `coverage-adequacy` both PASSED** (CodySwannGT/lisa#3885). Parity here was
 * enforced by convention at authoring time and by nothing at verification time,
 * so it failed exactly when two branches were open at once — which is the
 * normal condition in this repository.
 *
 * ## Why this asks which copies CLASSIFY rather than which copies match
 *
 * The obvious test — "every copy of the guard mentions `noexec`" — is wrong,
 * and measurably so. Of the 8 copies still missing the token when this was
 * written, 7 are protocol ADAPTERS: `block-*.agy.sh` translates Antigravity's
 * envelope and shells straight into the canonical `.sh` beside it, and
 * `lisa-block-managed-file-edits.ts` does the same for OpenCode. They hold no
 * classification at all. Teaching them about `noexec` would not close a gap; it
 * would create a second copy of the policy, which is the thing their own
 * comments say they exist to avoid — *"the two would diverge at the first
 * vector closed in only one of them"*.
 *
 * So each copy is classified by what it DOES: a copy that hands the command to
 * the canonical guard is a delegate and inherits every arm automatically; a
 * copy that decides for itself must carry them. Only one shipped copy was ever
 * a genuine gap — `lisa-block-direct-issue-create.ts`, a real port with its own
 * file-following.
 *
 * A count would have said 8. The question "which of these actually adjudicate?"
 * says 1, and sends the fix to the only place it belongs.
 *
 * ## What this test is, and is not
 *
 * It is a SOURCE-level parity assertion: it proves an arm is present in every
 * copy that needs one, not that the arm behaves. Behaviour is proved for the
 * canonical guard by `block-direct-issue-create-noexec.test.ts`, which drives a
 * real shell against a real fixture. That split is forced rather than chosen —
 * Stryker has no shell parser, so a `.sh` copy can never be mutation-tested and
 * a driving test is the only evidence available for it.
 *
 * The non-vacuity block below is the load-bearing part. A parity test that
 * enumerates the wrong directory, or globs a path matching nothing, passes
 * exactly as the pre-fix suite passed — which is the defect being fixed rather
 * than a fix for it.
 * @module tests/unit/hooks/guard-behavioural-parity
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { boundedExecFileSync } from "../../helpers/io-latency-budget.js";

/** This repository's root, three levels above this suite. */
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

/** The guards CodySwannGT/lisa#3781 taught about syntax checks. */
const GUARDS = ["block-direct-issue-create", "block-managed-file-edits"];

/**
 * The token every classifying copy must carry.
 *
 * The canonical guards name the concept in code and in prose, and so does the
 * TypeScript port. Matching the concept rather than one spelling of the
 * implementation keeps this from failing on a rewrite that keeps the behaviour.
 */
const ARM = "noexec";

/**
 * How many shipped copies must exist before this test believes its own glob.
 *
 * 20 were counted on the merged tree. A lower number means the enumeration
 * stopped seeing surfaces, which is the failure this file is about, so it is
 * asserted rather than trusted.
 */
const MIN_COPIES = 20;

/**
 * Every tracked file that is a shipped copy of one of the guards.
 * @returns Repository-relative paths, sorted.
 */
const shippedCopies = (): readonly string[] =>
  boundedExecFileSync({
    label: "git ls-files",
    command: "git",
    args: [
      "ls-files",
      "--",
      ...GUARDS.flatMap(guard => [
        `plugins/**/${guard}*`,
        `all/**/${guard}*`,
        `src/opencode/plugin-templates/lisa-${guard}.ts`,
      ]),
    ],
    cwd: REPO_ROOT,
  })
    .split("\n")
    .map(line => line.trim())
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right));

/**
 * A copy's source with its comments removed.
 *
 * Load-bearing, and the first draft of this file got it wrong. Delegation was
 * detected by asking whether the canonical script is NAMED anywhere, which is
 * true of `lisa-block-direct-issue-create.ts` — its header opens "Port of Lisa's
 * canonical hook `block-direct-issue-create.sh`". That is prose about what the
 * file is, not a call to it, and reading it as delegation would have excused
 * the one copy that genuinely needed the arm. Prose is exactly where a file
 * describes what it does NOT do.
 * @param source The copy's full text.
 * @returns The same text with comment bodies blanked.
 */
const codeOnly = (source: string): string =>
  source
    .replace(/\/\*[\s\S]*?\*\//gu, " ")
    .split("\n")
    .map(line => line.replace(/^\s*(?:#|\/\/).*$/u, ""))
    .join("\n");

/**
 * Whether a copy hands the command to the canonical guard beside it.
 *
 * Two facts together, both read from CODE: the copy names a canonical `.sh`
 * that is not itself, and it hands a path to a shell. Either alone is wrong —
 * every canonical guard names itself and runs shells, and a comment can name
 * anything.
 * @param props Helper inputs.
 * @param props.file The copy's repository-relative path.
 * @param props.source The copy's full text.
 * @returns Whether classification happens somewhere else.
 */
const delegates = ({
  file,
  source,
}: Readonly<{ file: string; source: string }>): boolean => {
  const code = codeOnly(source);
  const self = path.basename(file);
  return (
    GUARDS.some(
      guard => `${guard}.sh` !== self && code.includes(`${guard}.sh`)
    ) && /\/bin\/bash|"bash"|'bash'/u.test(code)
  );
};

/** One shipped copy, read and classified. */
interface Copy {
  /** Repository-relative path. */
  readonly file: string;
  /** Whether it defers to the canonical guard. */
  readonly delegates: boolean;
  /** Whether it carries the arm. */
  readonly armed: boolean;
}

/** Every shipped copy, classified once for the whole suite. */
const COPIES: readonly Copy[] = shippedCopies().map(file => {
  const source = readFileSync(path.join(REPO_ROOT, file), "utf8");
  return {
    file,
    delegates: delegates({ file, source }),
    armed: source.includes(ARM),
  };
});

describe("the enumeration can see what it claims to see", () => {
  // Every assertion below is about this test's own instrument. Without them a
  // glob that matches nothing reports the same green as a repository in perfect
  // parity, and that equivalence IS CodySwannGT/lisa#3885.
  it(`finds at least ${MIN_COPIES} shipped copies`, () => {
    expect(COPIES.length).toBeGreaterThanOrEqual(MIN_COPIES);
  });

  it("finds copies of both guards, not two copies of one", () => {
    for (const guard of GUARDS) {
      expect(COPIES.filter(copy => copy.file.includes(guard))).not.toEqual([]);
    }
  });

  it("finds both kinds, so neither branch of the rule is theoretical", () => {
    // A run where everything classified, or everything delegated, would make
    // the classification meaningless while still passing the rule below.
    expect(COPIES.filter(copy => copy.delegates)).not.toEqual([]);
    expect(COPIES.filter(copy => !copy.delegates)).not.toEqual([]);
  });

  it("classifies the canonical guards as classifying", () => {
    // The one classification this test can check against a known answer. If
    // the canonical guard ever reads as a delegate, `delegates` has broken and
    // every other verdict here is worthless.
    for (const guard of GUARDS) {
      const canonical = COPIES.find(
        copy => copy.file === `plugins/src/base/hooks/${guard}.sh`
      );
      expect(canonical?.delegates).toBe(false);
    }
  });
});

describe("every copy that adjudicates carries the noexec arm", () => {
  it("names any classifying copy that is missing it", () => {
    // Reported as a list of paths rather than one boolean, because the remedy
    // is per-file and a reader of a red run needs the files, not a count.
    const unarmed = COPIES.filter(copy => !copy.delegates && !copy.armed).map(
      copy => copy.file
    );
    expect(unarmed).toEqual([]);
  });

  it("does not require the arm of a copy that delegates", () => {
    // The other half of the rule, stated so a later edit cannot quietly turn
    // this suite into the naive "every copy mentions noexec" check that would
    // push a duplicate of the policy into seven adapters.
    const adapters = COPIES.filter(copy => copy.delegates);
    expect(adapters.some(copy => !copy.armed)).toBe(true);
  });
});
