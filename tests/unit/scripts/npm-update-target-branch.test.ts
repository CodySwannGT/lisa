/**
 * Configurable npm updater target branch (CodySwannGT/lisa#4860).
 *
 * A project whose integration branch is not main names it as npmUpdater
 * `target`. Every updater step — policy, selection, publication, the hosted
 * gate, cancellation and provenance — must then read, compare and open its
 * pull request against that branch and never name main. A main (or omitted)
 * target keeps every historical byte; npm-update-root-identity.test.ts holds
 * those goldens unchanged.
 */
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "yaml";
import {
  policyTarget,
  proposalFrom,
  selectPolicy,
  validatePolicy,
  validBranchName,
} from "../../../all/copy-overwrite/scripts/lib/npm-update-contract.mjs";
import {
  buildDraft,
  environment,
} from "../../../all/copy-overwrite/scripts/lib/npm-update-leaf-contract.mjs";
import { qualityGates } from "../../../all/copy-overwrite/scripts/lib/npm-update-quality.mjs";
import {
  GitHub,
  missingTarget,
} from "../../../all/copy-overwrite/scripts/lib/npm-update-github.mjs";
import {
  assertPublication,
  publicationBody,
  publishDestination,
} from "../../../all/copy-overwrite/scripts/lib/npm-update-publish.mjs";
import { assertHostedGate } from "../../../all/copy-overwrite/scripts/lib/npm-update-hosted-gate.mjs";
import { assertDispatchCancellation } from "../../../all/copy-overwrite/scripts/lib/npm-update-cancellation.mjs";
import {
  assertManualCancellation,
  assertRecordedOperator,
} from "../../../all/copy-overwrite/scripts/lib/npm-update-cancellation-proof.mjs";
import {
  assertCommittedTarget,
  canonicalJson,
  signedProposalFields,
} from "../../../all/copy-overwrite/scripts/lib/automation-provenance-contract.mjs";
import {
  officialArguments,
  sha256,
  targetBranch,
  verifiedRole,
  PROPOSAL_PREDICATE,
  ACTIONS_ISSUER,
} from "../../../all/copy-overwrite/scripts/lib/github-attestation-verifier.mjs";
import { verifyHistoricalProvider } from "../../../all/copy-overwrite/scripts/lib/github-attestation-provider.mjs";
import { createGhRequests } from "../../../all/copy-overwrite/scripts/lib/npm-update-gh-requests.mjs";
import { publicFailure } from "../../../all/copy-overwrite/scripts/lib/npm-update-invariants.mjs";
import {
  assertTargetBranchExists,
  assertWorkflowTarget,
} from "../../../all/copy-overwrite/scripts/lisa-npm-updater.mjs";

const REPOSITORY = "acme/widgets";
const WORK_ITEM = `${REPOSITORY}#42`;
const PARENT = "a".repeat(40);
const DEV = "dev";
const DEV_REF = "refs/heads/dev";
const MAIN_REF = "refs/heads/main";
const SIGNER = "lisa/lisa/.github/workflows/npm-updater.yml";
const CALLER = `${REPOSITORY}/.github/workflows/npm-update.yml`;
const NO_MAIN = /\bmain\b/;

const POLICY = {
  version: 1,
  repository: REPOSITORY,
  directory: ".",
  target: DEV,
  maintainer: "maintainer",
  packages: [{ name: "is-number", version: "7.0.0" }],
  lisaOwner: "absent",
};
const CONFIG = {
  tracker: "github",
  github: {
    org: "acme",
    repo: "widgets",
    labels: {
      build: {
        ready: "queue:ready",
        claimed: "queue:active",
        human_needed: "needs-person",
        blocked: "queue:blocked",
        done: { dev: "queue:on-dev", production: "queue:done" },
      },
    },
  },
  deploy: { branches: { dev: DEV, production: "main" } },
};
const BEFORE = {
  name: "fixture",
  version: "1.0.0",
  dependencies: { "is-number": "6.0.0" },
};
const AFTER = { ...BEFORE, dependencies: { "is-number": "7.0.0" } };
const FILES = {
  "package.json": `${JSON.stringify(AFTER)}\n`,
  "package-lock.json": `${JSON.stringify({
    name: "fixture",
    version: "1.0.0",
    lockfileVersion: 3,
    packages: {
      "": AFTER,
      "node_modules/is-number": {
        version: "7.0.0",
        resolved: "https://registry.npmjs.org/is-number/-/is-number-7.0.0.tgz",
        integrity: `sha512-${Buffer.alloc(64, 1).toString("base64")}`,
      },
    },
  })}\n`,
};
const UPDATES = [
  { name: "is-number", section: "dependencies", from: "6.0.0", to: "7.0.0" },
];
const EVIDENCE = {
  history: {
    command: "git log dev -- package.json package-lock.json",
    result: "none",
  },
  search: { query: "repo:acme/widgets npm in:title,body", total: 0 },
  registry: [{ name: "is-number", version: "7.0.0" }],
  labels: ["type:Task", "priority:medium", "queue:ready", "queue:active"],
  main: PARENT,
};
const AUTHORITY = {
  repository: REPOSITORY,
  repositoryId: "12",
  ownerId: "34",
  allowedTriggers: ["push", "workflow_dispatch"],
  signerWorkflow: SIGNER,
  signerDigest: "b".repeat(40),
  callerWorkflow: CALLER,
};

const devPolicy = () => validatePolicy(POLICY, CONFIG);
const devProposal = () =>
  proposalFrom(devPolicy(), PARENT, BEFORE, FILES, UPDATES);

/** The policy refusal names its target and allowed branches in the public diagnostic. */
function refusal(run: () => unknown) {
  try {
    run();
  } catch (error) {
    return publicFailure(error);
  }
  throw new Error("expected a refusal");
}

describe("policy accepts a configured target branch", () => {
  it("passes a target that is a deploy.branches value", () => {
    expect(policyTarget(devPolicy())).toBe(DEV);
  });

  it("refuses a target outside deploy.branches, naming it and the allowed branches", () => {
    const diagnostic = refusal(() =>
      validatePolicy({ ...POLICY, target: "feature-x" }, CONFIG)
    );
    expect(diagnostic).toContain('npmUpdater target "feature-x"');
    expect(diagnostic).toContain("allowed branches: dev, main");
  });

  it.each([
    "",
    "-dev",
    "dev..x",
    "dev/",
    "/dev",
    ".dev",
    "dev.lock",
    "dev name",
    "dev@{1}",
    "dev~1",
  ])("refuses the malformed ref name %j", name => {
    expect(validBranchName(name)).toBe(false);
    expect(() =>
      validatePolicy(
        { ...POLICY, target: name },
        { ...CONFIG, deploy: { branches: { dev: name } } }
      )
    ).toThrow();
  });

  it("selects the configured target from a committed directory list", () => {
    expect(
      policyTarget(selectPolicy({ ...CONFIG, npmUpdater: [POLICY] }, "."))
    ).toBe(DEV);
  });
});

describe("omitted target defaults to main", () => {
  it("validates a policy with no target and resolves main", () => {
    const { target: _omitted, ...policy } = POLICY;
    const validated = validatePolicy(policy, CONFIG);
    expect(Object.hasOwn(validated, "target")).toBe(false);
    expect(policyTarget(validated)).toBe("main");
    const proposal = proposalFrom(validated, PARENT, BEFORE, FILES, UPDATES);
    expect(proposal.target).toBe("main");
    // main is never signed, so the binding has its historical key set.
    expect(signedProposalFields(proposal)).toEqual({});
  });
});

describe("selection and signed identity use the configured target", () => {
  it("binds dev into the proposal, selection key and signed fields", () => {
    const dev = devProposal();
    const { target: _omitted, ...rootPolicy } = POLICY;
    const main = proposalFrom(
      validatePolicy({ ...rootPolicy, target: "main" }, CONFIG),
      PARENT,
      BEFORE,
      FILES,
      UPDATES
    );
    expect(dev.target).toBe(DEV);
    expect(dev.selectionKey).not.toBe(main.selectionKey);
    expect(dev.bindingKey).not.toBe(main.bindingKey);
    expect(signedProposalFields(dev)).toEqual({ target: DEV });
    expect(dev.bindingKey).toBe(
      sha256(
        canonicalJson({
          repository: REPOSITORY,
          parent: PARENT,
          updates: dev.updates,
          ...signedProposalFields(dev),
        })
      )
    );
  });

  it("refuses a descriptor whose target differs from the committed policy", () => {
    const config = { ...CONFIG, npmUpdater: POLICY };
    expect(() => assertCommittedTarget(config, { target: DEV })).not.toThrow();
    expect(() => assertCommittedTarget(config, {})).toThrow(/target differs/);
    expect(() =>
      assertCommittedTarget(
        { ...CONFIG, npmUpdater: { ...POLICY, target: "main" } },
        { target: DEV }
      )
    ).toThrow(/target differs/);
  });

  it("renders the leaf against dev and passes the fixed quality gates", () => {
    const policy = devPolicy();
    const proposal = devProposal();
    expect(environment(CONFIG, DEV)).toBe("dev");
    const draft = buildDraft(proposal, policy, CONFIG, EVIDENCE);
    expect(draft.body).toContain(
      "## Branch Plan\n\nBranch from: dev\nPR into: dev\n"
    );
    expect(draft.body).toContain("Inferred: dev — evidence: body");
    expect(draft.body).toContain("Target branch: dev");
    expect(draft.body).toContain("And the pull request into dev contains");
    expect(draft.body).not.toContain("remote default branch main");
    const gates = qualityGates(draft, proposal, policy, CONFIG, EVIDENCE);
    expect(
      gates
        .filter((gate: { id: string }) => ["S8", "S19"].includes(gate.id))
        .map((gate: { verdict: string }) => gate.verdict)
    ).toEqual(["PASS", "PASS"]);
  });
});

/** Synthetic pinned transport records every endpoint; it is never provider proof. */
function syntheticGitHub(
  replies: Map<string, { status: number; body?: object }>
) {
  const root = mkdtempSync(join(tmpdir(), "lisa-target-gh-"));
  const command = join(root, "synthetic-gh");
  writeFileSync(command, "synthetic gh", { mode: 0o700 });
  const endpoints: string[] = [];
  const execute = async (_command: string, args: string[]) => {
    const endpoint = args.find(arg => arg.startsWith("repos/"))!;
    endpoints.push(endpoint);
    const reply = replies.get(endpoint) ?? { status: 404 };
    const include = args.includes("--include");
    const json = reply.body ? JSON.stringify(reply.body) : "";
    return {
      code: reply.status === 200 ? 0 : 1,
      stdout: Buffer.from(
        include ? `HTTP/2 ${reply.status} OK\n\n${json}` : json
      ),
    };
  };
  const api = new GitHub(
    { ...AUTHORITY, ghExecutable: command, ghSha256: sha256("synthetic gh") },
    "token",
    // Only the fields the client reads are synthesised; this is not runProcess.
    execute as unknown as ConstructorParameters<typeof GitHub>[2]
  );
  return { api, endpoints, cleanup: () => rmSync(root, { recursive: true }) };
}

describe("the base check reads the configured target", () => {
  const repo = {
    full_name: REPOSITORY,
    default_branch: "main",
    id: 12,
    owner: { id: 34 },
  };

  it("reads refs/heads/dev and never main when the target is dev", async () => {
    const { api, endpoints, cleanup } = syntheticGitHub(
      new Map([
        [`repos/${REPOSITORY}`, { status: 200, body: repo }],
        [
          `repos/${REPOSITORY}/git/ref/heads/dev`,
          { status: 200, body: { object: { sha: PARENT } } },
        ],
      ])
    );
    try {
      await api.main(PARENT, DEV);
      expect(endpoints).toEqual([
        `repos/${REPOSITORY}`,
        `repos/${REPOSITORY}/git/ref/heads/dev`,
      ]);
      expect(endpoints.join("\n")).not.toMatch(NO_MAIN);
    } finally {
      cleanup();
    }
  });

  it("fails closed, naming the branch, when the target ref does not exist", async () => {
    const { api, cleanup } = syntheticGitHub(
      new Map([[`repos/${REPOSITORY}`, { status: 200, body: repo }]])
    );
    try {
      const error = await api.main(PARENT, "staging").catch(value => value);
      expect(publicFailure(error)).toContain(
        'Target branch "staging" does not exist on the remote'
      );
    } finally {
      cleanup();
    }
  });
});

describe("publication opens and checks its pull request against dev", () => {
  it("creates the PR with base dev and accepts only a dev-based PR", async () => {
    const proposal = { ...devProposal(), repository: REPOSITORY };
    const allocation = {
      draft: buildDraft(proposal, devPolicy(), CONFIG, EVIDENCE),
      workItem: WORK_ITEM,
      number: 42,
    };
    const commit = "c".repeat(40);
    const branch = `lisa/npm-${proposal.key}`;
    const pr = {
      number: 12,
      html_url: `https://github.com/${REPOSITORY}/pull/12`,
      state: "open",
      body: publicationBody(allocation),
      user: { type: "Bot", login: "github-actions[bot]" },
      head: { sha: commit, ref: branch, repo: { full_name: REPOSITORY } },
      base: { ref: DEV, sha: PARENT, repo: { full_name: REPOSITORY } },
    };
    const writes: Array<{ endpoint: string; body: { base?: string } }> = [];
    let pulls: (typeof pr)[] = [];
    const api = {
      maybe: async () => ({
        ref: `refs/heads/${branch}`,
        object: { type: "commit", sha: commit },
      }),
      list: async () => pulls,
      request: async (endpoint: string, method = "GET", body = {}) => {
        if (method === "POST") {
          writes.push({ endpoint, body });
          pulls = [pr];
        }
        return pr;
      },
      workItem: async () => {},
    };
    await publishDestination({
      api,
      controller: {},
      cwd: "/trusted/checkout",
      proposal,
      allocation,
      commit: { sha: commit },
      authorize: async () => {},
    });
    expect(writes).toEqual([
      expect.objectContaining({
        endpoint: `repos/${REPOSITORY}/pulls`,
        body: expect.objectContaining({ base: DEV }),
      }),
    ]);
    expect(() => assertPublication(pr, [], [], commit, [], DEV)).toThrow(
      /not qualified/
    );
    expect(() => assertPublication(pr, [], [], commit, [])).toThrow(
      /current-head PR differs/
    );
  });
});

describe("the hosted gate runs only on the configured target ref", () => {
  const env = (ref: string) => ({
    GITHUB_ACTIONS: "true",
    RUNNER_ENVIRONMENT: "github-hosted",
    GITHUB_REPOSITORY: REPOSITORY,
    GITHUB_SHA: PARENT,
    GITHUB_REF: ref,
    GITHUB_EVENT_NAME: "push",
  });
  const context = {
    policy: { repository: REPOSITORY },
    proposal: { parent: PARENT, target: DEV },
    config: { automationProvenance: AUTHORITY },
  };
  it("accepts refs/heads/dev and refuses refs/heads/main", () => {
    expect(() =>
      assertHostedGate(context, env(DEV_REF), "linux", "x64")
    ).not.toThrow();
    expect(() =>
      assertHostedGate(context, env(MAIN_REF), "linux", "x64")
    ).toThrow(/hosted Linux/);
  });
});

describe("cancellation authenticates a dev invocation", () => {
  const run = {
    id: 700,
    run_attempt: 1,
    event: "workflow_dispatch",
    status: "in_progress",
    head_sha: PARENT,
    head_branch: DEV,
    path: ".github/workflows/npm-update.yml",
    head_repository: { id: 12 },
    referenced_workflows: [{ path: SIGNER, sha: AUTHORITY.signerDigest }],
    triggering_actor: { type: "User", login: "maintainer", id: 5 },
  };
  const permission = {
    user: { type: "User", login: "maintainer", id: 5 },
    permission: "write",
  };
  const request = { number: 42, proposalKey: "d".repeat(64), parent: PARENT };

  it("accepts the dev dispatch event and refuses a main one", () => {
    const event = (ref: string) => ({
      ref,
      repository: { full_name: REPOSITORY, id: 12, owner: { id: 34 } },
      sender: { type: "User", id: 5, login: "maintainer" },
      inputs: {
        cancel_issue: "42",
        cancel_proposal_key: request.proposalKey,
        cancel_expected_main: PARENT,
      },
    });
    expect(() =>
      assertDispatchCancellation(event(DEV_REF), run, request, AUTHORITY, DEV)
    ).not.toThrow();
    expect(() =>
      assertDispatchCancellation(event(MAIN_REF), run, request, AUTHORITY, DEV)
    ).toThrow(/dispatch intent differs/);
  });

  it("requires the manual and recorded runs on dev", () => {
    const invocation = { runId: "700", runAttempt: "1" };
    expect(
      assertManualCancellation(
        run,
        permission,
        AUTHORITY,
        "maintainer",
        { parent: PARENT, target: DEV },
        request,
        invocation
      )
    ).toBe("5");
    expect(() =>
      assertManualCancellation(
        { ...run, head_branch: "main" },
        permission,
        AUTHORITY,
        "maintainer",
        { parent: PARENT, target: DEV },
        request,
        invocation
      )
    ).toThrow(/target-branch invocation/);
    const record = {
      runId: "700",
      runAttempt: "1",
      parent: PARENT,
      maintainer: "maintainer",
      operatorId: "5",
      target: DEV,
    };
    expect(() =>
      assertRecordedOperator(run, permission, AUTHORITY, record)
    ).not.toThrow();
    const { target: _omitted, ...mainRecord } = record;
    expect(() =>
      assertRecordedOperator(run, permission, AUTHORITY, mainRecord)
    ).toThrow(/recorded cancellation operator/);
  });
});

describe("provenance verifies the dev source ref", () => {
  const descriptor = {
    parent: PARENT,
    queue: REPOSITORY,
    workItem: WORK_ITEM,
    runId: "700",
    runAttempt: "1",
    claimCommentId: "77",
    claimSha256: sha256("claim"),
    target: DEV,
  };

  it("asks the official verifier for refs/heads/dev", () => {
    const args = officialArguments(
      AUTHORITY,
      descriptor,
      "/p/descriptor.json",
      "/p/bundle.json",
      PROPOSAL_PREDICATE
    );
    expect(args[args.indexOf("--source-ref") + 1]).toBe(DEV_REF);
    expect(args.join(" ")).not.toMatch(NO_MAIN);
    expect(targetBranch({})).toBe("main");
  });

  it("accepts a certificate issued on dev and refuses one issued on main", () => {
    const certificate = (ref: string) => ({
      issuer: ACTIONS_ISSUER,
      buildSignerURI: `https://github.com/${SIGNER}@${AUTHORITY.signerDigest}`,
      buildSignerDigest: AUTHORITY.signerDigest,
      buildConfigURI: `https://github.com/${CALLER}@${ref}`,
      buildConfigDigest: PARENT,
      sourceRepositoryURI: `https://github.com/${REPOSITORY}`,
      sourceRepositoryDigest: PARENT,
      sourceRepositoryRef: ref,
      sourceRepositoryIdentifier: "12",
      sourceRepositoryOwnerIdentifier: "34",
      runInvocationURI: `https://github.com/${REPOSITORY}/actions/runs/700/attempts/1`,
      runnerEnvironment: "github-hosted",
      buildTrigger: "push",
    });
    const results = (ref: string) => [
      {
        verificationResult: {
          statement: {
            _type: "https://in-toto.io/Statement/v1",
            predicateType: PROPOSAL_PREDICATE,
            subject: [{ name: "descriptor.json", digest: { sha256: "f" } }],
          },
          signature: { certificate: certificate(ref) },
        },
      },
    ];
    const role = (ref: string) =>
      verifiedRole(
        results(ref),
        descriptor,
        "f",
        AUTHORITY,
        PROPOSAL_PREDICATE,
        "descriptor.json"
      );
    expect(() => role(DEV_REF)).not.toThrow();
    expect(() => role(MAIN_REF)).toThrow(/buildConfigURI differs/);
  });

  it("reads the dev ref and requires the run on dev from the provider", () => {
    const root = mkdtempSync(join(tmpdir(), "lisa-target-provider-"));
    try {
      const executable = join(root, "synthetic-provider");
      writeFileSync(executable, "synthetic provider", { mode: 0o700 });
      const policy = {
        ...AUTHORITY,
        claimActorId: "99",
        ghExecutable: executable,
        ghSha256: sha256("synthetic provider"),
      };
      const run = {
        id: 700,
        run_attempt: 1,
        head_sha: PARENT,
        head_branch: DEV,
        status: "completed",
        head_repository: { id: 12 },
        event: "workflow_dispatch",
        referenced_workflows: [{ path: SIGNER, sha: AUTHORITY.signerDigest }],
      };
      const claim = {
        id: 77,
        issue_url: `https://api.github.com/repos/${REPOSITORY}/issues/42`,
        user: { id: 99, type: "Bot" },
        body: "claim",
      };
      const replies = new Map<string, object>([
        [
          `repos/${REPOSITORY}`,
          {
            id: 12,
            owner: { id: 34 },
            full_name: REPOSITORY,
            default_branch: "main",
          },
        ],
        [
          `repos/${REPOSITORY}/git/ref/heads/dev`,
          { ref: DEV_REF, object: { sha: PARENT } },
        ],
        [`repos/${REPOSITORY}/actions/runs/700/attempts/1`, run],
        [`repos/${REPOSITORY}/issues/comments/77`, claim],
      ]);
      const endpoints: string[] = [];
      const execute = (_command: string, args: readonly string[] = []) => {
        const endpoint = args.at(-1)!;
        endpoints.push(endpoint);
        const stdout = JSON.stringify(replies.get(endpoint) ?? {});
        return {
          pid: 0,
          status: 0,
          signal: null,
          stdout,
          stderr: "",
          output: [null, stdout, ""] as [null, string, string],
        };
      };
      expect(verifyHistoricalProvider(policy, descriptor, execute)).toEqual(
        expect.objectContaining({ run })
      );
      expect(endpoints.join("\n")).not.toMatch(NO_MAIN);
      run.head_branch = "main";
      expect(() =>
        verifyHistoricalProvider(policy, descriptor, execute)
      ).toThrow(/stale\/cancelled/);
    } finally {
      rmSync(root, { recursive: true });
    }
  });

  it("builds the hook-read GH catalogue against dev only", () => {
    const subject = {
      phase: "hook-read",
      repository: REPOSITORY,
      tracker: REPOSITORY,
      issue: "42",
      branch: `lisa/npm-${"e".repeat(64)}`,
      parent: PARENT,
      origin: { runId: "700", runAttempt: "1" },
      claim: "77",
      recovery: null,
      maintainer: "maintainer",
      pr: null,
      proofs: [
        {
          file: "/p/descriptor.json",
          bundle: "/p/bundle.json",
          predicate: PROPOSAL_PREDICATE,
          signerWorkflow: SIGNER,
          signerDigest: AUTHORITY.signerDigest,
        },
      ],
      target: DEV,
    };
    const { records } = createGhRequests(subject);
    const requests = records
      .map((record: { args: string[] }) => record.args.join(" "))
      .join("\n");
    expect(requests).toContain(`repos/${REPOSITORY}/git/ref/heads/dev`);
    expect(requests).toContain(`--source-ref ${DEV_REF}`);
    expect(requests).not.toMatch(/heads\/main/);
  });
});

describe("the CLI binds the workflow input and refuses a missing branch", () => {
  it("requires target_branch to equal the committed target", () => {
    expect(() => assertWorkflowTarget(devPolicy(), DEV)).not.toThrow();
    expect(() => assertWorkflowTarget(devPolicy(), "main")).toThrow(
      /target_branch differs/
    );
    expect(() => assertWorkflowTarget(devPolicy(), undefined)).toThrow(
      /target_branch differs/
    );
    const { target: _omitted, ...rootPolicy } = POLICY;
    expect(() =>
      assertWorkflowTarget(validatePolicy(rootPolicy, CONFIG), "")
    ).not.toThrow();
  });

  it("exits non-zero naming a target branch absent from the remote", async () => {
    const root = mkdtempSync(join(tmpdir(), "lisa-target-git-"));
    try {
      const git = (...args: string[]) =>
        execFileSync("git", args, { cwd: root, stdio: "pipe" });
      git("init", "-q", "-b", "main");
      git(
        "-c",
        "user.email=t@example.com",
        "-c",
        "user.name=t",
        "commit",
        "-q",
        "--allow-empty",
        "-m",
        "init"
      );
      git("update-ref", "refs/remotes/origin/dev", "HEAD");
      await expect(
        assertTargetBranchExists(root, devPolicy())
      ).resolves.toBeUndefined();
      const staging = validatePolicy(
        { ...POLICY, target: "staging" },
        { ...CONFIG, deploy: { branches: { staging: "staging" } } }
      );
      const error = await assertTargetBranchExists(root, staging).catch(
        value => value
      );
      expect(publicFailure(error)).toContain(
        'Target branch "staging" does not exist on the remote'
      );
      expect(publicFailure(missingTarget("staging"))).toContain(
        "Nothing was published and no work item was created."
      );
    } finally {
      rmSync(root, { recursive: true });
    }
  });
});

describe("the workflow runs prepare only on the configured target", () => {
  const workflow = parse(
    readFileSync(".github/workflows/npm-updater.yml", "utf8")
  );
  const condition: string = workflow.jobs.prepare.if;

  /** Evaluates the prepare guard's two operands for one call. */
  function prepareRuns(targetBranch: string, ref: string) {
    const match =
      /^github\.ref == format\('refs\/heads\/\{0\}', inputs\.target_branch \|\| 'main'\) && github\.event_name != 'pull_request'$/.exec(
        condition
      );
    expect(match).not.toBeNull();
    // `inputs.target_branch || 'main'`: an empty input is main, as in the CLI.
    return ref === `refs/heads/${targetBranch || "main"}`;
  }

  it("declares a target_branch input defaulting to main and passes it to the CLI", () => {
    const input = workflow.on.workflow_call.inputs.target_branch;
    expect(input).toEqual(
      expect.objectContaining({ type: "string", default: "main" })
    );
    expect(workflow.env.LISA_NPM_TARGET_BRANCH).toBe(
      "${{ inputs.target_branch }}"
    );
  });

  it("skips prepare on main and runs it on dev when target_branch is dev", () => {
    expect(prepareRuns(DEV, MAIN_REF)).toBe(false);
    expect(prepareRuns(DEV, DEV_REF)).toBe(true);
    expect(prepareRuns("main", MAIN_REF)).toBe(true);
    expect(prepareRuns("", MAIN_REF)).toBe(true);
  });
});
