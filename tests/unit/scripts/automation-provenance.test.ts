/** Real hook and checkout controls for authenticated non-AI attribution. */
import {
  chmodSync,
  cpSync,
  mkdirSync,
  readFileSync,
  renameSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { afterAll, afterEach, describe, expect, it } from "vitest";

import {
  boundedSpawnSync,
  ioLatencyBudgetMs,
} from "../../helpers/io-latency-budget.js";
import { canonicalJson } from "../../../all/copy-overwrite/scripts/lisa-automation-provenance.mjs";
import {
  sha256,
  PROPOSAL_PREDICATE,
} from "../../../all/copy-overwrite/scripts/lib/github-attestation-verifier.mjs";
import {
  bindTo,
  cleanupFixtures,
  cleanupTemplates,
  createFixture,
  git,
  type Fixture,
  REF,
} from "../../support/work-item-cli.js";

const ROOT = process.cwd();
const AUTHENTICATED_OUTPUT = "Authenticated non-AI";
const MESSAGE = `chore: update npm dependencies\n\nWork-Item: ${REF}\n`;
const AI = "Co-authored-by: Codex <codex@openai.com>\n";
const MARKER = "Automation-Provenance: actions/123/attempts/1\n";
const MANIFEST = "package.json";
const LOCKFILE = "package-lock.json";
const CONFIG = ".lisa.config.json";
const DESCRIPTOR_FILE = "descriptor.json";
const PROVIDER_FILE = "fake-bin/provider.json";
const PROOF_DIRECTORY = ".git/lisa/automation-provenance";
const CALLS_FILE = "fake-bin/calls.log";
const RECOVERY_FILE = "recovery.json";
const LEAF_BODY = "immutable leaf";
import { predictedCommit } from "../../../all/copy-overwrite/scripts/lib/github-attestation-recovery.mjs";
const ROOT_HOOK = ".husky/commit-msg";
const HOOKS = [ROOT_HOOK, "typescript/copy-contents/.husky/commit-msg"];
const CLAIM_ENDPOINT = "repos/acme/widgets/issues/comments/77";
const MAIN_ENDPOINT = "repos/acme/widgets/git/ref/heads/main";
const RUNTIME = {
  profile: "rails-mysql",
  database: "lisa_runtime",
  browser: false,
  dockerFixtures: false,
};
const ORIGINAL_BUN = '{"lockfileVersion":1}\n';

afterEach(cleanupFixtures);
afterAll(cleanupTemplates);

describe("focused provenance module boundaries", () => {
  it("imports the same public canonical contract without top-level provider work", async () => {
    const contract =
      await import("../../../all/copy-overwrite/scripts/lib/automation-provenance-contract.mjs");
    expect(contract.canonicalJson).toBe(canonicalJson);
    expect(canonicalJson({ z: [true, null], a: "é" })).toBe(
      '{"a":"é","z":[true,null]}'
    );
    expect(() => canonicalJson({ unsupported: undefined })).toThrow(
      "unsupported canonical value"
    );
  });

  it("keeps exact bounded private byte reads and alias refusal in the local module", async () => {
    const local =
      await import("../../../all/copy-overwrite/scripts/lib/automation-provenance-local.mjs");
    const f = fixture();
    const file = path.join(f.root, "private-proof.bin");
    const bytes = Buffer.from([0x00, 0x80, 0xef, 0xbf, 0xbd]);
    writeFileSync(file, bytes, { mode: 0o600 });
    expect(local.privateBytes(file, bytes.length)).toEqual(bytes);
    expect(() => local.privateBytes(file, bytes.length - 1)).toThrow(
      "invalid regular bounded proof file"
    );
    const alias = path.join(f.root, "private-proof-alias");
    symlinkSync(file, alias);
    expect(() => local.privateBytes(alias, bytes.length)).toThrow();
  });
});

/** Give the real hook a real tracker fixture and a passing commitlint boundary. */
function fixture(): Fixture {
  const f = createFixture({
    tracker: "github",
    github: { org: "acme", repo: "widgets" },
    workItem: { verify: "trailer" },
  });
  bindTo(f, REF);
  cpSync(
    path.join(ROOT, "all/copy-overwrite/scripts"),
    path.join(f.root, "scripts"),
    {
      recursive: true,
    }
  );
  mkdirSync(path.join(f.root, "node_modules/.bin"), { recursive: true });
  writeFileSync(path.join(f.root, LOCKFILE), "{}\n");
  writeFileSync(path.join(f.root, "fake-bin/npx"), "#!/bin/sh\nexit 0\n", {
    mode: 0o755,
  });
  return f;
}

/** Run the actual authored hook under Git's ordinary POSIX shell. */
function hook(
  f: Fixture,
  hookPath: string,
  message: string | Buffer,
  baseMs?: number
) {
  writeFileSync(path.join(f.root, "MSG"), message);
  return boundedSpawnSync({
    label: "automation attribution hook",
    command: "/bin/sh",
    args: [path.join(ROOT, hookPath), "MSG"],
    cwd: f.root,
    env: f.env,
    ...(baseMs === undefined ? {} : { baseMs }),
  });
}

/** Isolated fake transport executes real command boundaries, never issuance. */
function transport(f: Fixture) {
  const executable = path.join(f.root, "fake-bin/gh");
  writeFileSync(
    executable,
    `#!${process.execPath}\nconst fs=require('node:fs');
const data=JSON.parse(fs.readFileSync(__dirname+'/provider.json','utf8'));
const args=process.argv.slice(2);
fs.appendFileSync(__dirname+'/calls.log',args.join(' ')+'\\n');
if(args[0]==='issue'&&data.hangIssue)setInterval(()=>{},1000);
const key=args[0]==='--version'?'version':args[0]==='issue'?'issue':args[1]==='graphql'?'graph':args[0]==='attestation'?(args[2].endsWith('/recovery.json')?'recoveryAttestation':'attestation'):args.at(-1);
if(!(key in data))process.exit(7);
if(key.endsWith('/issues/comments/77')&&data.finalMessageBase64){fs.writeFileSync('MSG',Buffer.from(data.finalMessageBase64,'base64'));fs.appendFileSync(__dirname+'/calls.log','mutated-final-message\\n');}
console.log(typeof data[key]==='string'?data[key]:JSON.stringify(data[key]));\n`,
    { mode: 0o755 }
  );
  return {
    version: 1,
    enabled: true,
    repository: "acme/widgets",
    repositoryId: "123",
    ownerId: "456",
    claimActorId: "999",
    signerWorkflow: "acme/governance/.github/workflows/npm-updater.yml",
    signerDigest: "b".repeat(40),
    callerWorkflow: "acme/widgets/.github/workflows/update.yml",
    allowedTriggers: ["workflow_dispatch"],
    maxAgeSeconds: 600,
    ghExecutable: executable,
    ghSha256: sha256(readFileSync(executable)),
  };
}

/** Materialize a real two-file npm proposal on a committed trusted base. */
function proposalFixture(
  recovery = false,
  optional: { bun?: boolean; runtime?: boolean; unbound?: boolean } = {}
) {
  const f = fixture();
  const policy = transport(f);
  const config = JSON.parse(readFileSync(path.join(f.root, CONFIG), "utf8"));
  writeFileSync(
    path.join(f.root, CONFIG),
    JSON.stringify({
      ...config,
      automationProvenance: policy,
      ...(recovery || optional.runtime
        ? {
            npmUpdater: {
              version: 1,
              repository: policy.repository,
              directory: ".",
              target: "main",
              maintainer: "maintainer",
              packages: [{ name: "is-number", version: "7.0.0" }],
              lisaOwner: "absent",
              ...(optional.runtime ? { runtime: RUNTIME } : {}),
            },
          }
        : {}),
    })
  );
  const packageFor = (version: string) => ({
    name: "fixture",
    version: "1.0.0",
    ...(optional.bun ? { packageManager: "npm@11.21.0" } : {}),
    dependencies: { "is-number": version },
  });
  const lockFor = (version: string) => ({
    name: "fixture",
    version: "1.0.0",
    lockfileVersion: 3,
    packages: {
      "": packageFor(version),
      "node_modules/is-number": { version },
    },
  });
  for (const version of ["6.0.0", "7.0.0"]) {
    if (optional.bun)
      writeFileSync(
        path.join(f.root, "bun.lock"),
        version === "6.0.0"
          ? ORIGINAL_BUN
          : '{"lockfileVersion":1,"configVersion":1}\n'
      );
    writeFileSync(
      path.join(f.root, MANIFEST),
      JSON.stringify(packageFor(version))
    );
    writeFileSync(
      path.join(f.root, LOCKFILE),
      JSON.stringify(lockFor(version))
    );
    git(
      f.root,
      [
        "add",
        CONFIG,
        MANIFEST,
        LOCKFILE,
        ...(optional.bun ? ["bun.lock"] : []),
      ],
      f.env
    );
    if (version === "6.0.0")
      git(f.root, ["commit", "-qm", "test trusted base"], f.env);
  }
  const env: Fixture["env"] = {
    ...f.env,
    GIT_AUTHOR_DATE: new Date().toISOString(),
    GIT_COMMITTER_DATE: new Date().toISOString(),
  };
  const current = { ...f, env };
  const parent = git(f.root, ["rev-parse", "HEAD"], env);
  const updates = [
    { section: "dependencies", name: "is-number", from: "6.0.0", to: "7.0.0" },
  ];
  const claim = "[lisa-tracker-claim] deterministic fixture claim";
  const bindings = {
    ...(optional.bun ? { bunLockSha256: sha256(ORIGINAL_BUN) } : {}),
    ...(optional.runtime
      ? { runtimeSha256: sha256(canonicalJson(RUNTIME)) }
      : {}),
  };
  const descriptor = {
    version: 1,
    runId: "123",
    runAttempt: "1",
    parent,
    tree: git(f.root, ["write-tree"], env),
    author: git(f.root, ["var", "GIT_AUTHOR_IDENT"], env),
    committer: git(f.root, ["var", "GIT_COMMITTER_IDENT"], env),
    policySha256: sha256(canonicalJson(policy)),
    messageSha256: sha256(MESSAGE + MARKER),
    claimCommentId: "77",
    claimSha256: sha256(claim),
    queue: "acme/widgets",
    workItem: REF,
    ...bindings,
    proposalKey: sha256(
      canonicalJson({
        repository: policy.repository,
        parent,
        updates,
        ...(optional.unbound ? {} : bindings),
      })
    ),
    updates,
    files: {
      [MANIFEST]: sha256(readFileSync(path.join(f.root, MANIFEST))),
      [LOCKFILE]: sha256(readFileSync(path.join(f.root, LOCKFILE))),
      ...(optional.bun
        ? { "bun.lock": sha256(readFileSync(path.join(f.root, "bun.lock"))) }
        : {}),
    },
  };
  return { f: current, policy, descriptor, claim };
}

/** Supply official-result-shaped data, explicitly a transport fixture. */
function providerData(p: ReturnType<typeof proposalFixture>) {
  const { policy, descriptor: d } = p;
  return {
    version: "gh version 2.96.0",
    issue: {
      number: 42,
      state: "OPEN",
      labels: [{ name: "status:in-progress" }, { name: "type:Task" }],
      comments: [],
    },
    graph: { data: { repository: { issue: { subIssues: { nodes: [] } } } } },
    [`repos/${policy.repository}`]: {
      id: 123,
      owner: { id: 456 },
      full_name: policy.repository,
      default_branch: "main",
    },
    [MAIN_ENDPOINT]: {
      ref: "refs/heads/main",
      object: { sha: d.parent },
    },
    [`repos/${policy.repository}/actions/runs/123/attempts/1`]: {
      id: 123,
      run_attempt: 1,
      head_sha: d.parent,
      head_branch: "main",
      status: "in_progress",
      head_repository: { id: 123 },
      event: "workflow_dispatch",
      referenced_workflows: [
        { path: policy.signerWorkflow, sha: policy.signerDigest },
      ],
    },
    [CLAIM_ENDPOINT]: {
      id: 77,
      issue_url: "https://api.github.com/repos/acme/widgets/issues/42",
      user: { id: 999, type: "Bot" },
      body: p.claim,
    },
    attestation: [
      {
        verificationResult: {
          signature: {
            certificate: {
              issuer: "https://token.actions.githubusercontent.com",
              buildSignerURI: `https://github.com/${policy.signerWorkflow}@${policy.signerDigest}`,
              buildSignerDigest: policy.signerDigest,
              buildConfigURI: `https://github.com/${policy.callerWorkflow}@refs/heads/main`,
              buildConfigDigest: d.parent,
              sourceRepositoryURI: `https://github.com/${policy.repository}`,
              sourceRepositoryDigest: d.parent,
              sourceRepositoryRef: "refs/heads/main",
              sourceRepositoryIdentifier: policy.repositoryId,
              sourceRepositoryOwnerIdentifier: policy.ownerId,
              runInvocationURI:
                "https://github.com/acme/widgets/actions/runs/123/attempts/1",
              runnerEnvironment: "github-hosted",
              buildTrigger: "workflow_dispatch",
            },
          },
          verifiedTimestamps: [
            {
              type: "TimestampAuthority",
              uri: "https://timestamp.example.test",
              timestamp: new Date().toISOString(),
            },
          ],
          statement: {
            _type: "https://in-toto.io/Statement/v1",
            predicateType: PROPOSAL_PREDICATE,
            subject: [
              {
                name: DESCRIPTOR_FILE,
                digest: { sha256: sha256(`${canonicalJson(d)}\n`) },
              },
            ],
          },
        },
      },
    ],
  };
}

/** Write positively owned private proof; no live token or signature is used. */
function installProof(p: ReturnType<typeof proposalFixture>) {
  const directory = path.join(p.f.root, PROOF_DIRECTORY);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  writeFileSync(
    path.join(directory, DESCRIPTOR_FILE),
    `${canonicalJson(p.descriptor)}\n`,
    { mode: 0o600 }
  );
  writeFileSync(
    path.join(directory, "bundle.json"),
    "transport fixture only\n",
    { mode: 0o600 }
  );
  writeFileSync(
    path.join(p.f.root, PROVIDER_FILE),
    JSON.stringify(providerData(p))
  );
  return directory;
}

describe.each(HOOKS)(
  "ordinary attribution and present-proof refusal: %s",
  hookPath => {
    it("keeps ordinary Codex attribution accepted without automation proof", () => {
      const result = hook(fixture(), hookPath, MESSAGE + AI);
      expect(result.status).toBe(0);
    });

    it("keeps ordinary non-AI commits rejected without proof", () => {
      const result = hook(fixture(), hookPath, MESSAGE);
      expect(result.status).toBe(1);
      expect(result.stdout).toContain("Co-authored-by");
    });

    it("rejects present unverified proof even with otherwise valid AI attribution", () => {
      const result = hook(fixture(), hookPath, MESSAGE + MARKER + AI);
      expect(result.status).toBe(1);
      expect(result.stdout + result.stderr).toContain("automation provenance");
    });

    it("does not let automation proof exempt a malformed Work-Item", () => {
      const result = hook(
        fixture(),
        hookPath,
        MESSAGE.replace(REF, "invalid") + MARKER
      );
      expect(result.status).toBe(1);
      expect(result.stdout + result.stderr).toContain("Work-Item");
    });
  }
);

/** Mutate only the replacement character's raw encoding, preserving parsed text. */
function invalidReplacement(message: string) {
  const bytes = Buffer.from(message, "utf8");
  const offset = bytes.indexOf(Buffer.from("\uFFFD", "utf8"));
  expect(offset).toBeGreaterThanOrEqual(0);
  return Buffer.concat([
    bytes.subarray(0, offset),
    Buffer.from([0x80]),
    bytes.subarray(offset + 3),
  ]);
}

describe.each(HOOKS)("exact raw message bytes: %s", hookPath => {
  const message = `${MESSAGE}${MARKER}\nNotes: café \uFFFD\n`;

  it("accepts valid nonASCII bytes with their exact signed digest", () => {
    const p = proposalFixture();
    p.descriptor.messageSha256 = sha256(Buffer.from(message, "utf8"));
    installProof(p);
    expect(hook(p.f, hookPath, Buffer.from(message, "utf8")).status).toBe(0);
  });

  it("rejects invalid UTF8 initial-message substitution with identical decoded text", () => {
    const p = proposalFixture();
    p.descriptor.messageSha256 = sha256(Buffer.from(message, "utf8"));
    installProof(p);
    const mutation = invalidReplacement(message);
    expect(mutation.toString("utf8")).toBe(message);
    expect(sha256(mutation)).not.toBe(p.descriptor.messageSha256);
    expect(hook(p.f, hookPath, mutation).status).toBe(1);
  });

  it("rejects final-read byte mutation after the provider verification boundary", () => {
    const p = proposalFixture();
    p.descriptor.messageSha256 = sha256(Buffer.from(message, "utf8"));
    installProof(p);
    writeFileSync(
      path.join(p.f.root, PROVIDER_FILE),
      JSON.stringify({
        ...providerData(p),
        finalMessageBase64: invalidReplacement(message).toString("base64"),
      })
    );
    const result = hook(p.f, hookPath, Buffer.from(message, "utf8"));
    expect(readFileSync(path.join(p.f.root, CALLS_FILE), "utf8")).toContain(
      "mutated-final-message"
    );
    expect(readFileSync(path.join(p.f.root, "MSG")).toString("utf8")).toBe(
      message
    );
    expect(result.status).toBe(1);
  });
});

describe("full hook and checkout transport fixtures (not live issuance)", () => {
  it(
    "refuses a hung live canonical resolver even when the inherited deadline is zero",
    () => {
      const p = proposalFixture();
      installProof(p);
      writeFileSync(
        path.join(p.f.root, PROVIDER_FILE),
        JSON.stringify({ ...providerData(p), hangIssue: true })
      );
      p.f.env.LISA_WORK_ITEM_TIMEOUT_MS = "0";
      const result = hook(p.f, ROOT_HOOK, MESSAGE + MARKER, 45_000);
      expect(result.status).toBe(1);
      expect(result.stdout).toContain("invalid automation provenance");
      expect(readFileSync(path.join(p.f.root, CALLS_FILE), "utf8")).toContain(
        "issue view 42"
      );
    },
    ioLatencyBudgetMs(55_000)
  );
  it.each(HOOKS)(
    "reaches verified non-AI branch with exact final proposal: %s",
    hookPath => {
      const p = proposalFixture();
      installProof(p);
      const result = hook(p.f, hookPath, MESSAGE + MARKER);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain(AUTHENTICATED_OUTPUT);
    }
  );

  it.each(HOOKS)(
    "preserves actual commitlint failure before verified automation: %s",
    hookPath => {
      const p = proposalFixture();
      installProof(p);
      writeFileSync(
        path.join(p.f.root, "fake-bin/npx"),
        "#!/bin/sh\nexit 7\n",
        { mode: 0o755 }
      );
      expect(hook(p.f, hookPath, MESSAGE + MARKER).status).not.toBe(0);
    }
  );

  it.each([
    "message",
    "tree",
    "binding",
    "claim",
    "main",
    "closed",
    "signature",
    "symlink",
    "noncanonical",
    "undeclared",
    "public-directory",
    "public-descriptor",
    "oversize-descriptor",
    "oversize-bundle",
  ])("rejects the reaching %s mismatch", boundary => {
    const p = proposalFixture();
    const directory = installProof(p);
    let message = MESSAGE + MARKER;
    if (boundary === "message") message += "changed\n";
    if (boundary === "tree") {
      writeFileSync(path.join(p.f.root, "foreign.txt"), "foreign\n");
      git(p.f.root, ["add", "foreign.txt"], p.f.env);
    }
    if (boundary === "binding") bindTo(p.f, "acme/widgets#43");
    if (boundary === "public-directory") chmodSync(directory, 0o755);
    if (boundary === "public-descriptor")
      chmodSync(path.join(directory, DESCRIPTOR_FILE), 0o644);
    if (boundary === "oversize-descriptor")
      writeFileSync(path.join(directory, DESCRIPTOR_FILE), "x".repeat(65_537));
    if (boundary === "oversize-bundle")
      writeFileSync(path.join(directory, "bundle.json"), "x".repeat(1_048_577));
    if (boundary === "noncanonical")
      writeFileSync(
        path.join(directory, DESCRIPTOR_FILE),
        JSON.stringify(p.descriptor)
      );
    if (boundary === "symlink") {
      const file = path.join(directory, DESCRIPTOR_FILE);
      const original = path.join(directory, "original.json");
      renameSync(file, original);
      symlinkSync(original, file);
    }
    if (boundary === "undeclared") {
      p.descriptor.updates[0]!.to = "8.0.0";
      writeFileSync(
        path.join(directory, DESCRIPTOR_FILE),
        `${canonicalJson(p.descriptor)}\n`
      );
    }
    const data = providerData(p);
    if (boundary === "claim") data[CLAIM_ENDPOINT].body = "changed claim";
    if (boundary === "main") data[MAIN_ENDPOINT].object.sha = "f".repeat(40);
    if (boundary === "closed") data.issue.state = "CLOSED";
    if (boundary === "signature")
      data.attestation[0]!.verificationResult.signature.certificate.issuer =
        "https://foreign.example.test";
    writeFileSync(path.join(p.f.root, PROVIDER_FILE), JSON.stringify(data));
    expect(hook(p.f, ROOT_HOOK, message).status).toBe(1);
  });
});

/** Optional recovery proof is never ignored or used as an ordinary fallback. */
describe.each(HOOKS)("present recovery files fail closed: %s", hookPath => {
  it.each([RECOVERY_FILE, "recovery-bundle.json"])(
    "rejects partial %s",
    filename => {
      const p = proposalFixture();
      installProof(p);
      writeFileSync(path.join(p.f.root, PROOF_DIRECTORY, filename), "{}\n", {
        mode: 0o600,
      });
      const result = hook(p.f, hookPath, MESSAGE + MARKER);
      expect(result.status).toBe(1);
      expect(result.stdout + result.stderr).toContain("automation provenance");
    }
  );
});

/** A completed-origin fixture reaches both official command boundaries, not signatures. */
function recoveryFixture(
  optional: { bun?: boolean; runtime?: boolean; unbound?: boolean } = {}
) {
  const p = proposalFixture(true, optional);
  installProof(p);
  const data = providerData(p);
  const config = JSON.parse(readFileSync(path.join(p.f.root, CONFIG), "utf8"));
  const digest = sha256(`${canonicalJson(p.descriptor)}\n`);
  const npmPolicySha256 = sha256(canonicalJson(config.npmUpdater));
  const key = sha256(
    canonicalJson({
      repository: p.policy.repository,
      target: "main",
      ecosystem: "npm",
      directory: ".",
      parent: p.descriptor.parent,
      policySha256: npmPolicySha256,
      updates: p.descriptor.updates,
      ...(!optional.unbound && optional.bun
        ? { bunLockSha256: p.descriptor.bunLockSha256 }
        : {}),
      ...(!optional.unbound && optional.runtime
        ? { runtimeSha256: p.descriptor.runtimeSha256 }
        : {}),
    })
  );
  const recovery = {
    version: 1,
    purpose: "resume-identical-npm-proposal",
    repository: p.policy.repository,
    repositoryId: "123",
    ownerId: "456",
    queue: p.descriptor.queue,
    workItem: REF,
    proposalKey: key,
    bindingKey: p.descriptor.proposalKey,
    npmPolicySha256,
    automationPolicySha256: p.descriptor.policySha256,
    originDescriptorSha256: digest,
    originRunId: "123",
    originRunAttempt: "1",
    commit: predictedCommit(p.descriptor, Buffer.from(MESSAGE + MARKER)),
    parent: p.descriptor.parent,
    tree: p.descriptor.tree,
    messageSha256: p.descriptor.messageSha256,
    claimCommentId: "77",
    claimSha256: p.descriptor.claimSha256,
    leafBodySha256: sha256(LEAF_BODY),
    branch: `lisa/npm-${key}`,
    expectedBranchHead: null,
    prNumber: null,
    expectedPrHead: null,
    runId: "456",
    runAttempt: "2",
  };
  const recoveryBytes = `${canonicalJson(recovery)}\n`;
  const now = Date.now();
  const runKey = `repos/${p.policy.repository}/actions/runs/123/attempts/1`;
  const oldRun = data[runKey];
  if (!oldRun || typeof oldRun !== "object" || Array.isArray(oldRun))
    throw new Error("fixture origin run is missing");
  Object.assign(oldRun, {
    status: "completed",
    conclusion: "cancelled",
    run_started_at: new Date(now - 3_600_000).toISOString(),
    updated_at: new Date(now - 1_100_000).toISOString(),
  });
  Object.assign(data[CLAIM_ENDPOINT], {
    created_at: new Date(now - 3_600_000).toISOString(),
  });
  data.attestation[0]!.verificationResult.verifiedTimestamps[0]!.timestamp =
    new Date(now - 1_200_000).toISOString();
  const fresh = structuredClone(data.attestation);
  fresh[0]!.verificationResult.signature.certificate.runInvocationURI =
    "https://github.com/acme/widgets/actions/runs/456/attempts/2";
  fresh[0]!.verificationResult.statement.predicateType =
    "https://lisa.dev/attestations/npm-recovery/v1";
  fresh[0]!.verificationResult.statement.subject = [
    { name: RECOVERY_FILE, digest: { sha256: sha256(recoveryBytes) } },
  ];
  fresh[0]!.verificationResult.verifiedTimestamps[0]!.timestamp = new Date(
    now
  ).toISOString();
  const extra = {
    ...data,
    recoveryAttestation: fresh,
    issue: {
      ...data.issue,
      body: LEAF_BODY,
      assignees: [{ login: "maintainer", type: "User", id: 7 }],
    },
    [`repos/${p.policy.repository}/actions/runs/456/attempts/2`]: {
      ...oldRun,
      id: 456,
      run_attempt: 2,
      status: "in_progress",
    },
    [`repos/${p.policy.repository}/git/matching-refs/heads/${recovery.branch}`]:
      [],
    [`repos/${p.policy.repository}/pulls?state=all&head=${encodeURIComponent(`acme:${recovery.branch}`)}&per_page=100&page=1`]:
      [],
    [`repos/${p.policy.repository}/issues/42`]: {
      state: "open",
      body: LEAF_BODY,
      assignees: [{ login: "maintainer", type: "User", id: 7 }],
    },
    [`repos/${p.policy.repository}/assignees/maintainer`]:
      "HTTP/2.0 204 No Content\n\n",
  };
  writeFileSync(path.join(p.f.root, PROVIDER_FILE), JSON.stringify(extra));
  const proof = path.join(p.f.root, PROOF_DIRECTORY);
  writeFileSync(path.join(proof, RECOVERY_FILE), recoveryBytes, {
    mode: 0o600,
  });
  writeFileSync(
    path.join(proof, "recovery-bundle.json"),
    "public transport fixture",
    { mode: 0o600 }
  );
  p.f.env.GITHUB_RUN_ID = "456";
  p.f.env.GITHUB_RUN_ATTEMPT = "2";
  return { p, data: extra, recovery };
}

describe("optional signed authority through the canonical verifier (synthetic transport)", () => {
  const selections = [
    { bun: true },
    { runtime: true },
    { bun: true, runtime: true },
  ];
  it.each(selections)("accepts exact original optional fields %#", optional => {
    const p = proposalFixture(false, optional);
    installProof(p);
    const result = hook(p.f, ROOT_HOOK, MESSAGE + MARKER);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(AUTHENTICATED_OUTPUT);
  });
  it.each(selections)(
    "accepts fresh recovery bound to the exact optional original %#",
    optional => {
      const { p } = recoveryFixture(optional);
      const result = hook(p.f, ROOT_HOOK, MESSAGE + MARKER);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain(AUTHENTICATED_OUTPUT);
    }
  );
  it.each(selections)(
    "refuses a signed original whose key omits optional authority %#",
    optional => {
      const p = proposalFixture(false, { ...optional, unbound: true });
      installProof(p);
      expect(hook(p.f, ROOT_HOOK, MESSAGE + MARKER).status).toBe(1);
    }
  );
  it.each(selections)(
    "refuses a signed recovery whose keys omit optional authority %#",
    optional => {
      const { p } = recoveryFixture({ ...optional, unbound: true });
      expect(hook(p.f, ROOT_HOOK, MESSAGE + MARKER).status).toBe(1);
    }
  );
});

describe.each(HOOKS)("dual proof hook transport control: %s", hookPath => {
  it("accepts completed old origin only with current fresh separate recovery", () => {
    const { p } = recoveryFixture();
    expect(hook(p.f, hookPath, MESSAGE + MARKER).status).toBe(0);
    const calls = readFileSync(path.join(p.f.root, CALLS_FILE), "utf8");
    expect(calls).toContain("/recovery.json --bundle");
    expect(calls).toContain("/descriptor.json --bundle");
  });
  it.each([
    "current-run",
    "body",
    "origin-time",
    "fresh-time",
    "signer",
    "claim",
  ])("rejects reaching changed %s", field => {
    const { p, data } = recoveryFixture();
    if (field === "current-run") p.f.env.GITHUB_RUN_ATTEMPT = "3";
    if (field === "body") data.issue.body = "changed leaf";
    if (field === "origin-time")
      data.attestation[0]!.verificationResult.verifiedTimestamps[0]!.timestamp =
        new Date(Date.now()).toISOString();
    if (field === "fresh-time")
      data.recoveryAttestation[0]!.verificationResult.verifiedTimestamps[0]!.timestamp =
        new Date(Date.now() - 1_200_000).toISOString();
    if (field === "signer")
      data.recoveryAttestation[0]!.verificationResult.signature.certificate.buildSignerDigest =
        "foreign";
    if (field === "claim") data[CLAIM_ENDPOINT].body = "changed claim";
    writeFileSync(path.join(p.f.root, PROVIDER_FILE), JSON.stringify(data));
    expect(hook(p.f, hookPath, MESSAGE + MARKER).status).toBe(1);
  });
});
