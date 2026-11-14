/**
 * A committed npm host and fixed configs for the npm updater's Jira and Linear
 * allocation tests (CodySwannGT/lisa#4859).
 *
 * The code host stays GitHub for every tracker, so `codeHost` is the same
 * duck-typed `api` shape the existing GitHub suites inject: it answers the
 * repository/main read and the destination probes, and nothing else. The
 * tracker is whatever adapter the test attaches as `api.tracker`.
 * @module tests/support/npm-update-tracker-host
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runProcess } from "../../all/copy-overwrite/scripts/lib/npm-update-process.mjs";
import { proposalFrom } from "../../all/copy-overwrite/scripts/lib/npm-update-contract.mjs";
import { JIRA_ACCOUNT } from "./npm-update-jira-fake.js";
import { LINEAR_VIEWER } from "./npm-update-linear-fake.js";

export const LINEAR_MAINTAINER = "0f3c2a1b-4d5e-4f60-8a7b-9c0d1e2f3a4b";
export const JIRA_MAINTAINER = "557058:f58131cb-b67d-43c7-b30d-6b58d40bd077";
export const REPOSITORY = "acme/widgets";

const BEFORE = {
  name: "fixture",
  version: "1.0.0",
  dependencies: { "is-number": "6.0.0" },
};
const AFTER = { ...BEFORE, dependencies: { "is-number": "7.0.0" } };
const INTEGRITY = `sha512-${Buffer.alloc(64, 1).toString("base64")}`;
const TARBALL = "https://registry.npmjs.org/is-number/-/is-number-7.0.0.tgz";
const LOCK = {
  name: "fixture",
  version: "1.0.0",
  lockfileVersion: 3,
  packages: {
    "": AFTER,
    "node_modules/is-number": {
      version: "7.0.0",
      resolved: TARBALL,
      integrity: INTEGRITY,
    },
  },
};
const FILES = {
  "package.json": `${JSON.stringify(AFTER)}\n`,
  "package-lock.json": `${JSON.stringify(LOCK)}\n`,
};
const UPDATES = [
  { name: "is-number", section: "dependencies", from: "6.0.0", to: "7.0.0" },
];

/** Registry metadata that agrees with the committed lock's integrity and tarball. */
export const REGISTRY_METADATA = {
  name: "is-number",
  version: "7.0.0",
  dist: { integrity: INTEGRITY, tarball: TARBALL },
};

/** Signed-authority fields the descriptor hashes; never read from a provider here. */
const AUTOMATION_FIELDS = {
  enabled: true,
  version: 1,
  repository: REPOSITORY,
  repositoryId: "12",
  ownerId: "34",
  claimActorId: "99",
  signerWorkflow: "acme/automation/.github/workflows/npm-updater.yml",
  callerWorkflow: "acme/widgets/.github/workflows/npm.yml",
  allowedTriggers: ["workflow_dispatch"],
  maxAgeSeconds: 3600,
};

/**
 * The committed automation policy. Its signer digest is this checkout's own
 * HEAD, so the hold classifier authenticates the helper bytes this checkout
 * already ships, exactly as it does when run from source.
 * @returns The automation policy object.
 */
export async function automation() {
  const head = await runProcess("git", ["rev-parse", "HEAD"], {
    cwd: process.cwd(),
    env: process.env,
  });
  return { ...AUTOMATION_FIELDS, signerDigest: head.stdout.toString().trim() };
}

const BASE = {
  github: { org: "acme", repo: "widgets" },
  deploy: { branches: { production: "main" } },
};

/** A Linear-tracked host: team ENG in workspace acme. */
export const LINEAR_CONFIG = {
  ...BASE,
  tracker: "linear",
  linear: { workspace: "acme", teamKey: "ENG", claimActorRef: LINEAR_VIEWER },
};

/** A Jira-tracked host: project PROJ on a Jira Cloud site. */
export const JIRA_CONFIG = {
  ...BASE,
  tracker: "jira",
  jira: { project: "PROJ", claimActorRef: JIRA_ACCOUNT },
  atlassian: { site: "acme.atlassian.net" },
};

/**
 * The committed npm policy for one tracker's maintainer identifier.
 * @param maintainer - GitHub login, Jira account id or Linear user id.
 * @returns The npmUpdater policy entry.
 */
export function policyFor(maintainer: string) {
  return {
    version: 1,
    repository: REPOSITORY,
    directory: ".",
    target: "main",
    maintainer,
    packages: [{ name: "is-number", version: "7.0.0" }],
    lisaOwner: "absent",
  };
}

/**
 * Create the host checkout with its baseline manifest, a lock and extra files, and commit it.
 * @param cwd - Host checkout directory to create.
 * @param env - Private environment for git.
 * @param extra - Further committed files by name.
 * @returns The commit id.
 */
async function initialCommit(
  cwd: string,
  env: NodeJS.ProcessEnv,
  extra: Record<string, string>
) {
  const git = (args: string[]) => runProcess("git", args, { cwd, env });
  mkdirSync(cwd);
  writeFileSync(join(cwd, "package.json"), `${JSON.stringify(BEFORE)}\n`);
  writeFileSync(join(cwd, "package-lock.json"), "{}\n");
  for (const [name, text] of Object.entries(extra))
    writeFileSync(join(cwd, name), text);
  await git(["init", "--object-format=sha1"]);
  await git(["add", "."]);
  await git([
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.test",
    "commit",
    "-m",
    "Committed npm host",
  ]);
  return (await git(["rev-parse", "HEAD"])).stdout.toString().trim();
}

/**
 * Commit the baseline manifest and lock, then build the exact proposal against it.
 * @param root - Private root to create the host checkout in.
 * @param env - Private environment for git.
 * @param maintainer - The policy's maintainer identifier.
 * @param extra - Further committed files by name, e.g. `.lisa.config.json`.
 * @returns The checkout, its parent commit, the policy and the proposal.
 */
export async function committedHost(
  root: string,
  env: NodeJS.ProcessEnv,
  maintainer: string,
  extra: Record<string, string> = {}
) {
  const cwd = join(root, "host");
  const policy = policyFor(maintainer);
  const parent = await initialCommit(cwd, env, extra);
  const proposal = proposalFrom(policy, parent, BEFORE, FILES, UPDATES);
  return { cwd, parent, policy, proposal };
}

/**
 * The GitHub code host: repository/main identity and an absent destination.
 * @param parent - The committed main the host must still report.
 * @returns A duck-typed code-host `api` recording its calls.
 */
export function codeHost(parent: string) {
  const calls: string[] = [];
  return {
    calls,
    policy: { ...AUTOMATION_FIELDS },
    main: async (expected: string) => {
      calls.push("main");
      if (expected !== parent) throw Error("main parent changed");
    },
    maybe: async () => {
      calls.push("maybe");
      return null;
    },
    list: async () => {
      calls.push("list");
      return [];
    },
  };
}
