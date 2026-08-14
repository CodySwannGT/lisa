/**
 * Tests for the threshold ratchet's promotion path, part 4.
 *
 * The other three suites exercise the pure comparator. This one runs the
 * entry script against real git repositories, because the property under test
 * is about branch topology and cannot be expressed against a comparator that
 * never sees a ref.
 *
 * The property: a promotion between deploy-chain branches may read its allow
 * list from the change under review, and NOTHING else may. Every test here
 * pairs a promotion with a byte-identical ordinary PR, because the two differ
 * only in which branch the change sits on — if the ordinary case ever stops
 * being blocked, the ratchet has been disabled rather than fixed (#2531).
 */
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const HOOKS_REL = "plugins/src/base/hooks";
const ENTRY = "threshold-ratchet.mjs";
const RATCHET_MODULES = [
  "threshold-ratchet-families.mjs",
  "threshold-ratchet-compare.mjs",
];
const ESLINT_FILE = "eslint.thresholds.json";
const LISA_CONFIG = ".lisa.config.json";
const BASE_BRANCH = "staging";
const CHAIN_HEAD = "dev";
const TOPIC_BRANCH = "feature/raise-the-ceiling";
const BLOCK_BANNER = "Quality gate weakened";
/** The exemption a human approved upstream, as recorded on the head branch. */
const APPROVED_ALLOW = {
  file: ESLINT_FILE,
  key: "*",
  reason: "Approved by Cody Swann for PR #443",
};

/**
 * Build the `.lisa.config.json` body: an ordered deploy chain plus whatever
 * allow entries the branch has recorded.
 * @param allow - Allow entries to record
 * @param chain - Deploy chain, environment name to branch name
 * @returns Serialized config
 */
function configText(
  allow: readonly object[],
  chain: Readonly<Record<string, string>> = {
    dev: CHAIN_HEAD,
    staging: BASE_BRANCH,
    production: "main",
  }
): string {
  return `${JSON.stringify(
    { deploy: { branches: chain }, thresholdRatchet: { allow } },
    undefined,
    2
  )}\n`;
}

/**
 * Run git in a repository, throwing on failure so a broken fixture cannot
 * masquerade as a passing test.
 * @param cwd - Repository directory
 * @param args - Git arguments
 */
function git(cwd: string, ...args: readonly string[]): void {
  const result = spawnSync(
    "/usr/bin/git",
    ["-c", "user.email=t@t", "-c", "user.name=t", ...args],
    { cwd, encoding: "utf-8" }
  );
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
  }
}

/**
 * Create a repository whose `staging` branch holds the baseline: an eslint
 * ceiling of 10 warnings and no recorded exemptions.
 * @returns Absolute path to the repository
 */
function baselineRepo(): string {
  // realpath, because the script only runs main() when argv[1] resolves to its
  // own module URL, and on macOS os.tmpdir() is a symlink — the two would
  // never match and every test here would silently measure a no-op.
  const dir = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "lisa-ratchet-promo-"))
  );
  git(dir, "init", "-q", "-b", BASE_BRANCH);
  for (const module of [ENTRY, ...RATCHET_MODULES]) {
    fs.copyFileSync(
      path.join(REPO_ROOT, HOOKS_REL, module),
      path.join(dir, module)
    );
  }
  fs.writeFileSync(path.join(dir, LISA_CONFIG), configText([]), "utf-8");
  fs.writeFileSync(
    path.join(dir, ESLINT_FILE),
    `${JSON.stringify({ maxWarnings: 10 })}\n`,
    "utf-8"
  );
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", "baseline on staging");
  return dir;
}

/**
 * Commit the weakening under review onto a new branch: the eslint ceiling
 * rises to 25, and the allow entry approving that rise is recorded alongside
 * it. Identical content whichever branch it lands on — the branch is the
 * only variable these tests change.
 * @param dir - Repository directory
 * @param branch - Branch to create and commit on
 * @param chain - Deploy chain to record in the config
 */
function commitWeakening(
  dir: string,
  branch: string,
  chain?: Readonly<Record<string, string>>
): void {
  git(dir, "checkout", "-qb", branch);
  fs.writeFileSync(
    path.join(dir, ESLINT_FILE),
    `${JSON.stringify({ maxWarnings: 25 })}\n`,
    "utf-8"
  );
  fs.writeFileSync(
    path.join(dir, LISA_CONFIG),
    configText([APPROVED_ALLOW], chain),
    "utf-8"
  );
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", "chore: raise the eslint ceiling");
}

/**
 * Run the ratchet in `base` mode.
 * @param dir - Repository directory
 * @param headRef - Head ref to declare, or undefined to omit `--head`
 * @returns Exit status and combined output
 */
function ratchet(
  dir: string,
  headRef?: string
): { readonly status: number | null; readonly output: string } {
  const result = spawnSync(
    process.execPath,
    [
      path.join(dir, ENTRY),
      "--base",
      BASE_BRANCH,
      ...(headRef === undefined ? [] : ["--head", headRef]),
    ],
    { cwd: dir, encoding: "utf-8" }
  );
  return {
    status: result.status,
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
  };
}

describe("threshold-ratchet promotions", () => {
  it("passes a promotion carrying an exemption approved upstream", () => {
    const dir = baselineRepo();
    commitWeakening(dir, CHAIN_HEAD);
    const blockedBefore = ratchet(dir);
    const afterFix = ratchet(dir, CHAIN_HEAD);
    fs.rmSync(dir, { recursive: true, force: true });

    // Omitting --head is the pre-#2531 behavior, and it is the deadlock: the
    // allow list comes from staging, which is behind, so an exemption already
    // approved on dev reads as newly added and the promotion cannot merge.
    expect(blockedBefore.output).toContain(BLOCK_BANNER);
    expect(blockedBefore.status).toBe(1);

    expect(afterFix.status).toBe(0);
    expect(afterFix.output).not.toContain(BLOCK_BANNER);
    // Loud, not silent: a gate that relaxes has to say so and say why.
    expect(afterFix.output).toContain(
      `promotion ${CHAIN_HEAD} → ${BASE_BRANCH}`
    );
    expect(afterFix.output).toContain("carried forward by this promotion");
  });

  it("still blocks an ordinary PR that grants itself the same exemption", () => {
    const dir = baselineRepo();
    commitWeakening(dir, TOPIC_BRANCH);
    // The head contains the base, which is what a strict up-to-date
    // branch-protection rule REQUIRES of every PR. Ancestry alone would
    // therefore have handed self-approval to essentially every change; being
    // a deploy-chain branch is the condition that cannot be arranged.
    const contains = spawnSync(
      "/usr/bin/git",
      ["merge-base", "--is-ancestor", BASE_BRANCH, TOPIC_BRANCH],
      { cwd: dir, encoding: "utf-8" }
    );
    const result = ratchet(dir, TOPIC_BRANCH);
    fs.rmSync(dir, { recursive: true, force: true });

    expect(contains.status).toBe(0);
    expect(result.output).toContain(BLOCK_BANNER);
    expect(result.output).toContain("new threshold exception");
    expect(result.status).toBe(1);
  });

  it("does not let a change declare itself a deploy-chain branch", () => {
    const dir = baselineRepo();
    commitWeakening(dir, TOPIC_BRANCH, {
      sneaky: TOPIC_BRANCH,
      staging: BASE_BRANCH,
    });
    const result = ratchet(dir, TOPIC_BRANCH);
    fs.rmSync(dir, { recursive: true, force: true });

    // The chain is read from the baseline for exactly this reason.
    expect(result.output).toContain(BLOCK_BANNER);
    expect(result.status).toBe(1);
  });

  it("keeps the strict reading when the head has diverged from the base", () => {
    const dir = baselineRepo();
    commitWeakening(dir, CHAIN_HEAD);
    git(dir, "checkout", "-q", BASE_BRANCH);
    fs.writeFileSync(path.join(dir, "HOTFIX.md"), "hotfix\n", "utf-8");
    git(dir, "add", "-A");
    git(dir, "commit", "-qm", "fix: hotfix landed straight on staging");
    git(dir, "checkout", "-q", CHAIN_HEAD);
    const result = ratchet(dir, CHAIN_HEAD);
    fs.rmSync(dir, { recursive: true, force: true });

    // A head that does not contain its base is not "the baseline plus
    // approved history", whatever the branch is called.
    expect(result.output).toContain(BLOCK_BANNER);
    expect(result.output).toContain("Sync staging down into dev first");
    expect(result.status).toBe(1);
  });

  it("does not treat a demotion as a promotion", () => {
    const dir = baselineRepo();
    commitWeakening(dir, CHAIN_HEAD);
    // staging is downstream of dev, so naming it as the head is not a
    // promotion however the refs relate.
    const result = ratchet(dir, BASE_BRANCH);
    fs.rmSync(dir, { recursive: true, force: true });

    expect(result.output).toContain(BLOCK_BANNER);
    expect(result.status).toBe(1);
  });

  it("blocks a weakening a promotion carries with no allow entry at all", () => {
    const dir = baselineRepo();
    git(dir, "checkout", "-qb", CHAIN_HEAD);
    fs.writeFileSync(
      path.join(dir, ESLINT_FILE),
      `${JSON.stringify({ maxWarnings: 25 })}\n`,
      "utf-8"
    );
    git(dir, "add", "-A");
    git(dir, "commit", "-qm", "chore: raise the ceiling with no exemption");
    const result = ratchet(dir, CHAIN_HEAD);
    fs.rmSync(dir, { recursive: true, force: true });

    // Being a promotion changes where the allow list is READ FROM. It does
    // not excuse a weakening that nobody ever approved.
    expect(result.output).toContain(BLOCK_BANNER);
    expect(result.output).toContain("maxWarnings");
    expect(result.status).toBe(1);
  });
});
