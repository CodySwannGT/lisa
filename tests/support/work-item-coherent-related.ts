/** One Git/config/provider/assets snapshot: accepted related99 and pending own42. */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  proofFixture,
  attachRecord,
  setApi,
  setCompare,
  PUBLISHER,
  SPEC,
  proofUsage,
} from "./work-item-proof-fixture.js";
import { git, commit } from "./work-item-cli.js";
const REPO = "repos/acme/code";
export const RELATED_REF = "acme/code#99";
export const OWN_REF = "acme/code#42";
/** Existing shared proof factory result; no parallel provider setup. */
type ProofFixture = ReturnType<typeof proofFixture>;
const crossRef = (number: number, now: string) => ({
  event: "cross-referenced",
  source: {
    issue: {
      number,
      pull_request: { merged_at: now },
      repository_url: "https://api.github.com/repos/acme/code",
    },
  },
});

/**
 * Establish the independently exercised related positive.
 * @returns Real disposable fixture with accepted proof for related99 only.
 */
function relatedFixture() {
  const fixture = proofFixture(RELATED_REF);
  attachRecord(fixture);
  return fixture;
}

/**
 * Land own42 after the related merge in the same real repository.
 * @param fixture - Shared repository.
 * @returns Distinct own PR head and common production snapshot.
 */
function mergeOwnWork(fixture: ProofFixture) {
  git(fixture.root, ["switch", "-q", "-c", "own-work-42", "main"], fixture.env);
  return commitOwnWork(fixture);
}

/**
 * Commit and merge only the current item's declaration.
 * @param fixture - Repository on own42's feature branch.
 * @returns Actual observed source identities.
 */
function commitOwnWork(fixture: ProofFixture) {
  const ownHead = commit(
    fixture,
    "fix: current own work\n\nWork-Item: acme/code#42"
  );
  git(fixture.root, ["switch", "-q", "main"], fixture.env);
  git(
    fixture.root,
    ["merge", "--no-ff", "-q", "-m", "Merge own PR8", "own-work-42"],
    fixture.env
  );
  return {
    ownHead,
    commonHead: git(fixture.root, ["rev-parse", "HEAD"], fixture.env),
  };
}

/**
 * Use the shared canonical usage builder, never a related item's copied usage.
 * @param fixture - Existing related issue and owner metadata.
 * @param now - Native fixture timestamp.
 * @returns A distinct pending current issue with its own backlink and usage.
 */
function ownState(fixture: ProofFixture, now: string) {
  const related = JSON.parse(
    readFileSync(fixture.env.FAKE_GH_STATE_FILE!, "utf8")
  );
  return {
    ...related,
    id: "I_fixture42",
    number: 42,
    url: "https://github.com/acme/code/issues/42",
    body: `${SPEC}\nRelated work only: https://github.com/acme/code/pull/7\n${proofUsage(OWN_REF)}`,
    comments: [
      {
        id: 42,
        body: "[lisa-pr-link] https://github.com/acme/code/pull/8",
        user: PUBLISHER,
        created_at: now,
        updated_at: now,
      },
    ],
  };
}

/**
 * Register both native commit records and a genuinely pending own delivery.
 * @param fixture - Shared provider resources.
 * @param source - Actual current source identities.
 * @param now - Fixture timestamp.
 * @param ownPR - Exact current PR metadata.
 */
function registerOwnResources(
  fixture: ProofFixture,
  source: ReturnType<typeof mergeOwnWork>,
  now: string,
  ownPR: object
) {
  setApi(fixture, ["api", `${REPO}/branches/main`], {
    json: { commit: { sha: source.commonHead } },
  });
  setApi(fixture, ["api", `${REPO}/pulls/8`], { json: ownPR });
  setApi(fixture, ["api", `${REPO}/actions/runs/32`], {
    json: pendingRun(source.commonHead, now),
  });
  setApi(
    fixture,
    ["api", "--paginate", "--slurp", `${REPO}/issues/42/comments?per_page=100`],
    { kind: "comments" }
  );
  for (const sha of [source.ownHead, source.commonHead])
    setApi(fixture, ["api", `${REPO}/commits/${sha}`], {
      json: commitResource(fixture, sha),
    });
  setCompare(fixture, fixture.merge, source.commonHead);
  setCompare(fixture, source.commonHead, source.commonHead);
}

/**
 * Preserve pending delivery under the same branch snapshot as the positive.
 * @param commonHead - Shared branch tip.
 * @param now - Fixture timestamp.
 * @returns Native-shaped pending whole run.
 */
function pendingRun(commonHead: string, now: string) {
  return {
    id: 32,
    repository: { id: 881 },
    workflow_id: 22,
    path: ".github/workflows/deploy.yml",
    event: "push",
    head_branch: "main",
    head_sha: commonHead,
    run_attempt: 1,
    status: "in_progress",
    conclusion: null,
    created_at: now,
    updated_at: now,
  };
}

/**
 * Derive native source metadata from actual Git rather than invented parents.
 * @param fixture - Shared repository.
 * @param sha - Existing commit.
 * @returns Exact native-shaped commit facts.
 */
function commitResource(fixture: ProofFixture, sha: string) {
  return {
    sha,
    commit: {
      message: git(
        fixture.root,
        ["show", "-s", "--format=%B", sha],
        fixture.env
      ),
    },
    parents: git(fixture.root, ["show", "-s", "--format=%P", sha], fixture.env)
      .split(" ")
      .filter(Boolean)
      .map(parent => ({ sha: parent })),
  };
}

/**
 * Combine both subjects without changing provider, source or asset namespaces.
 * @returns Same-source positive prerequisite plus independently pending current work.
 */
export function coherentRelatedFixture() {
  const fixture = relatedFixture();
  const source = mergeOwnWork(fixture);
  const now = new Date().toISOString();
  const ownFile = path.join(fixture.root, "provider-state-42.json");
  const relatedFile = fixture.env.FAKE_GH_STATE_FILE!;
  const own = ownState(fixture, now);
  const ownPR = {
    number: 8,
    merged: true,
    state: "closed",
    merged_at: now,
    html_url: "https://github.com/acme/code/pull/8",
    body: "Work-Item: acme/code#42",
    merge_commit_sha: source.commonHead,
    head: { sha: source.ownHead },
    base: { ref: "main" },
  };
  const table = JSON.parse(readFileSync(fixture.env.FAKE_GH_API_FILE!, "utf8"));
  const registry = {
    repository: "acme/code",
    default_number: "42",
    issues: {
      "99": {
        state_file: relatedFile,
        children: [],
        timeline: [crossRef(7, now)],
      },
      "42": {
        state_file: ownFile,
        children: [],
        timeline: [crossRef(7, now), crossRef(8, now)],
      },
    },
    pull_requests: {
      "7": table[JSON.stringify(["api", `${REPO}/pulls/7`])].json,
      "8": ownPR,
    },
  };
  const registryFile = path.join(fixture.root, "provider-issues.json");
  writeFileSync(ownFile, JSON.stringify(own), { flag: "wx" });
  registerOwnResources(fixture, source, now, ownPR);
  writeFileSync(registryFile, JSON.stringify(registry), { flag: "wx" });
  fixture.env.FAKE_GH_ISSUES_FILE = registryFile;
  return {
    ...fixture,
    registry,
    registryFile,
    relatedFile,
    ownFile,
    commonHead: source.commonHead,
  };
}
