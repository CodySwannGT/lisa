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

import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";
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
const MESSAGE = `chore: update npm dependencies\n\nWork-Item: ${REF}\n`;
const AI = "Co-authored-by: Codex <codex@openai.com>\n";
const MARKER = "Automation-Provenance: actions/123/attempts/1\n";
const MANIFEST = "package.json";
const LOCKFILE = "package-lock.json";
const CONFIG = ".lisa.config.json";
const DESCRIPTOR_FILE = "descriptor.json";
const PROVIDER_FILE = "fake-bin/provider.json";
const ROOT_HOOK = ".husky/commit-msg";
const HOOKS = [ROOT_HOOK, "typescript/copy-contents/.husky/commit-msg"];
const CLAIM_ENDPOINT = "repos/acme/widgets/issues/comments/77";
const MAIN_ENDPOINT = "repos/acme/widgets/git/ref/heads/main";

afterEach(cleanupFixtures);
afterAll(cleanupTemplates);

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
const key=args[0]==='--version'?'version':args[0]==='issue'?'issue':args[1]==='graphql'?'graph':args[0]==='attestation'?'attestation':args.at(-1);
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
function proposalFixture() {
  const f = fixture();
  const policy = transport(f);
  const config = JSON.parse(readFileSync(path.join(f.root, CONFIG), "utf8"));
  writeFileSync(
    path.join(f.root, CONFIG),
    JSON.stringify({ ...config, automationProvenance: policy })
  );
  const packageFor = (version: string) => ({
    name: "fixture",
    version: "1.0.0",
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
    writeFileSync(
      path.join(f.root, MANIFEST),
      JSON.stringify(packageFor(version))
    );
    writeFileSync(
      path.join(f.root, LOCKFILE),
      JSON.stringify(lockFor(version))
    );
    git(f.root, ["add", CONFIG, MANIFEST, LOCKFILE], f.env);
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
    proposalKey: sha256(
      canonicalJson({ repository: policy.repository, parent, updates })
    ),
    updates,
    files: {
      [MANIFEST]: sha256(readFileSync(path.join(f.root, MANIFEST))),
      [LOCKFILE]: sha256(readFileSync(path.join(f.root, LOCKFILE))),
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
  const directory = path.join(p.f.root, ".git/lisa/automation-provenance");
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
    expect(
      readFileSync(path.join(p.f.root, "fake-bin/calls.log"), "utf8")
    ).toContain("mutated-final-message");
    expect(readFileSync(path.join(p.f.root, "MSG")).toString("utf8")).toBe(
      message
    );
    expect(result.status).toBe(1);
  });
});

describe("full hook and checkout transport fixtures (not live issuance)", () => {
  it("refuses a hung live canonical resolver even when the inherited deadline is zero", () => {
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
    expect(
      readFileSync(path.join(p.f.root, "fake-bin/calls.log"), "utf8")
    ).toContain("issue view 42");
  }, 55_000);
  it.each(HOOKS)(
    "reaches verified non-AI branch with exact final proposal: %s",
    hookPath => {
      const p = proposalFixture();
      installProof(p);
      const result = hook(p.f, hookPath, MESSAGE + MARKER);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("Authenticated non-AI");
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
