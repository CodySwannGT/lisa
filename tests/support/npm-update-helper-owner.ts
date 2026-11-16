/**
 * A hermetic, committed Lisa source owner for the npm updater's canonical
 * helper graph (CodySwannGT/lisa#4923).
 *
 * `helperOwner()` chooses its authority from where the helper runs: a Lisa
 * package root with its own `.git` is authenticated against the committed Git
 * blobs of the signed commit, and any other root is an installed release that
 * is authenticated against the live npm registry. Suites that only need the
 * hold classifier used to inherit that choice from the test run itself — green
 * in this checkout, but red in any copy that is not its own Git checkout (the
 * Stryker sandbox), red with an uncommitted edit to a classifier member, and
 * reaching `npm view` on the network whenever they took the release path.
 *
 * This owner removes the ambient input without touching the check. It commits
 * the classifier and owner members this run actually executes into a private
 * Git repository, and the test redirects owner discovery to it through
 * `findLisaPackageOwner` — the same seam the classifier-cache suite uses for
 * the release path. Everything after discovery is production code running
 * unmodified: `git show` of the signed commit, byte equality with the files on
 * disk, the closed import-graph match, and the import itself. The release path
 * stays covered by `npm-update-classifier-cache.test.ts` against a synthetic
 * registry archive.
 *
 * Wire it in a suite with:
 *
 * ```ts
 * vi.mock(
 *   "../../../all/copy-overwrite/scripts/lib/npm-update-npm.mjs",
 *   async original =>
 *     (await import("../../support/npm-update-helper-owner.js")).withHermeticOwner(
 *       await original()
 *     )
 * );
 * ```
 * @module tests/support/npm-update-helper-owner
 */
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll } from "vitest";
import {
  CLASSIFIER_MEMBERS,
  OWNER_MEMBERS,
} from "../../all/copy-overwrite/scripts/lib/npm-update-helper-inventory.mjs";
import { boundedExecFileSync } from "../helpers/io-latency-budget.js";

/** The owner root and the commit that signs its helper members. */
export interface HermeticOwner {
  readonly root: string;
  readonly head: string;
  readonly metadata: { readonly name: string; readonly version: string };
}

const MANIFEST = "package.json";

/** The one owner this suite builds, reused by every discovery. */
const built: { owner?: HermeticOwner } = {};

/**
 * Run git privately inside the owner: no user config, hooks, or signing.
 * @param root - Owner repository.
 * @param args - Git arguments.
 * @returns Trimmed stdout.
 */
function git(root: string, args: readonly string[]) {
  return boundedExecFileSync({
    command: "git",
    args: [
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "-c",
      "commit.gpgsign=false",
      "-c",
      "core.hooksPath=/dev/null",
      ...args,
    ],
    cwd: root,
    env: { PATH: process.env.PATH, HOME: root, GIT_CONFIG_NOSYSTEM: "1" },
    label: `hermetic helper owner git ${args[0]}`,
    maxBuffer: 1_048_576,
  }).trim();
}

/**
 * The committed owner, built once per suite from the bytes this run executes.
 * @returns The hermetic owner.
 */
export function hermeticOwner(): HermeticOwner {
  if (built.owner) return built.owner;
  const root = realpathSync(mkdtempSync(join(tmpdir(), "lisa-helper-owner-")));
  copyFileSync(MANIFEST, join(root, MANIFEST));
  for (const member of [...CLASSIFIER_MEMBERS, ...OWNER_MEMBERS]) {
    mkdirSync(dirname(join(root, member)), { recursive: true });
    copyFileSync(member, join(root, member));
  }
  git(root, ["init", "--quiet", "--object-format=sha1"]);
  git(root, ["add", "."]);
  git(root, ["commit", "--quiet", "-m", "Hermetic helper owner"]);
  built.owner = {
    root,
    head: git(root, ["rev-parse", "HEAD"]),
    metadata: JSON.parse(readFileSync(join(root, MANIFEST), "utf8")),
  };
  return built.owner;
}

afterAll(() => {
  if (built.owner) rmSync(built.owner.root, { recursive: true, force: true });
  delete built.owner;
});

/**
 * Redirect Lisa package-owner discovery to the hermetic owner.
 * @param actual - The real `npm-update-npm.mjs` exports.
 * @returns The same exports with owner discovery pinned.
 */
export function withHermeticOwner<T extends object>(actual: T): T {
  return {
    ...actual,
    findLisaPackageOwner: () => {
      const { root, metadata } = hermeticOwner();
      return { root, metadata };
    },
  };
}
