/** Verified-output policy fixtures are not genuine provider issuance proof. */
import { afterEach, describe, expect, it } from "vitest";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { ioLatencyBudgetMs } from "../../helpers/io-latency-budget.js";
import { boundedSpawnSync } from "../../../all/copy-overwrite/scripts/lib/bounded-spawn.mjs";
import {
  ACTIONS_ISSUER,
  assertVerifiedAttestation,
  RECOVERY_PREDICATE,
  ghJson,
  PROPOSAL_PREDICATE,
  sha256,
  verifyDescriptorAttestation,
} from "../../../all/copy-overwrite/scripts/lib/github-attestation-verifier.mjs";

import {
  assertHistoricalAttestation,
  assertRecoveryAttestation,
  validateRecovery,
} from "../../../all/copy-overwrite/scripts/lib/github-attestation-recovery.mjs";

const NOW = Date.parse("2026-10-05T12:00:00Z");
const EXPIRED_TIME = "2026-10-05T11:00:00Z";
const BASE = "a".repeat(40);
const SIGNER = "b".repeat(40);
const DIGEST = "c".repeat(64);
const POLICY = {
  repository: "acme/widgets",
  repositoryId: "123",
  ownerId: "456",
  signerWorkflow: "acme/governance/.github/workflows/npm-updater.yml",
  signerDigest: SIGNER,
  callerWorkflow: "acme/widgets/.github/workflows/update.yml",
  allowedTriggers: ["workflow_dispatch"],
  maxAgeSeconds: 600,
};
const DESCRIPTOR = { parent: BASE, runId: "1234", runAttempt: "1" };

/** Shape pinned to official gh/Sigstore JSON types, not a decoded JWT. */
function result(parent = BASE) {
  return [
    {
      verificationResult: {
        signature: {
          certificate: {
            issuer: ACTIONS_ISSUER,
            buildSignerURI: `https://github.com/${POLICY.signerWorkflow}@${SIGNER}`,
            buildSignerDigest: SIGNER,
            buildConfigURI: `https://github.com/${POLICY.callerWorkflow}@refs/heads/main`,
            buildConfigDigest: parent,
            sourceRepositoryURI: "https://github.com/acme/widgets",
            sourceRepositoryDigest: parent,
            sourceRepositoryRef: "refs/heads/main",
            sourceRepositoryIdentifier: "123",
            sourceRepositoryOwnerIdentifier: "456",
            runInvocationURI:
              "https://github.com/acme/widgets/actions/runs/1234/attempts/1",
            runnerEnvironment: "github-hosted",
            buildTrigger: "workflow_dispatch",
          },
        },
        verifiedTimestamps: [
          {
            type: "TimestampAuthority",
            uri: "https://timestamp.example.test",
            timestamp: "2026-10-05T11:59:00Z",
          },
        ],
        statement: {
          _type: "https://in-toto.io/Statement/v1",
          predicateType: PROPOSAL_PREDICATE,
          subject: [{ name: "descriptor.json", digest: { sha256: DIGEST } }],
        },
      },
    },
  ];
}

const scratch: string[] = [];
afterEach(() =>
  scratch.splice(0).forEach(path => rmSync(path, { recursive: true }))
);

describe("real no-write Git commit identity construction", () => {
  it.each(["sha1", "sha256"])(
    "matches literal raw Git identity and refuses wrong descriptor format: %s",
    format => {
      const directory = mkdtempSync(join(tmpdir(), "lisa-commit-identity-"));
      scratch.push(directory);
      const options = {
        cwd: directory,
        env: { PATH: process.env.PATH, HOME: directory },
        encoding: "utf8" as const,
        timeout: 30_000,
        maxBuffer: 1_048_576,
      };
      const git = (args: string[], input?: Buffer) =>
        boundedSpawnSync("git", args, { ...options, input });
      expect(git(["init", `--object-format=${format}`]).status).toBe(0);
      const message = Buffer.from("chore: exact é bytes\n\n", "utf8");
      const width = format === "sha1" ? 40 : 64;
      const descriptor = {
        tree: "a".repeat(width),
        parent: "b".repeat(width),
        author: "Fixture <fixture@example.invalid> 1234567890 +0000",
        committer: "Fixture <fixture@example.invalid> 1234567890 +0000",
        messageSha256: sha256(message),
      };
      const raw = Buffer.concat([
        Buffer.from(
          `tree ${descriptor.tree}\nparent ${descriptor.parent}\nauthor ${descriptor.author}\ncommitter ${descriptor.committer}\n\n`
        ),
        message,
      ]);
      const objects = join(directory, ".git/objects");
      const before = readdirSync(objects, {
        recursive: true,
        encoding: "utf8",
      }).sort((left, right) => left.localeCompare(right));
      const expected = git(["hash-object", "-t", "commit", "--stdin"], raw);
      expect(expected.status).toBe(0);
      const module = pathToFileURL(
        join(
          process.cwd(),
          "all/copy-overwrite/scripts/lib/github-attestation-recovery.mjs"
        )
      ).href;
      const program = `import{predictedCommit}from ${JSON.stringify(module)};const data=JSON.parse(process.argv[1]);console.log(predictedCommit(data.descriptor,Buffer.from(data.message,'base64')));`;
      const predict = (value: typeof descriptor) =>
        boundedSpawnSync(
          process.execPath,
          [
            "--input-type=module",
            "-e",
            program,
            JSON.stringify({
              descriptor: value,
              message: message.toString("base64"),
            }),
          ],
          options
        );
      const actual = predict(descriptor);
      expect(actual.status).toBe(0);
      expect(actual.stdout).toBe(expected.stdout);
      expect(
        readdirSync(objects, { recursive: true, encoding: "utf8" }).sort(
          (left, right) => left.localeCompare(right)
        )
      ).toEqual(before);
      expect(git(["cat-file", "-e", expected.stdout.trim()]).status).not.toBe(
        0
      );
      expect(
        predict({ ...descriptor, parent: "b".repeat(width === 40 ? 64 : 40) })
          .status
      ).not.toBe(0);
    }
  );
});

/** This program exercises the actual bounded process, not signature issuance. */
function verifierProgram() {
  const directory = mkdtempSync(join(tmpdir(), "lisa-provenance-verifier-"));
  scratch.push(directory);
  const executable = join(directory, "gh");
  writeFileSync(
    executable,
    `#!${process.execPath}\nconst mode = process.argv[2];\nif (mode === 'hang') setInterval(() => {}, 1000);\nelse if (mode === 'fail') process.exit(7);\nelse if (mode === 'large') process.stdout.write('x'.repeat(1048577));\nelse if (mode === 'bad-json') process.stdout.write('invalid');\nelse process.stdout.write(JSON.stringify(process.argv.slice(2)));\n`,
    { mode: 0o700 }
  );
  return {
    ...POLICY,
    ghExecutable: executable,
    ghSha256: sha256(readFileSync(executable)),
  };
}

describe("bounded pinned official-verifier process contract", () => {
  it("passes exact argv without shell interpretation", () => {
    const policy = verifierProgram();
    const args = [
      "literal",
      "a b",
      "$(never-execute)",
      "--repo",
      "acme/widgets",
    ];
    expect(ghJson(policy, args)).toEqual(args);
  });

  it.each(["fail", "large", "bad-json"])(
    "refuses actual %s child output",
    mode => {
      expect(() => ghJson(verifierProgram(), [mode])).toThrow();
    }
  );

  it(
    "kills an actual nonterminating verifier and refuses a verdict",
    () => {
      expect(() => ghJson(verifierProgram(), ["hang"])).toThrow();
    },
    ioLatencyBudgetMs(40_000)
  );

  it("refuses changed executable bytes before starting it", () => {
    const policy = verifierProgram();
    writeFileSync(policy.ghExecutable, "changed");
    expect(() => ghJson(policy, [])).toThrow("official gh bytes differ");
  });

  it("refuses a symlink in place of the pinned executable", () => {
    const policy = verifierProgram();
    renameSync(policy.ghExecutable, `${policy.ghExecutable}-original`);
    symlinkSync(`${policy.ghExecutable}-original`, policy.ghExecutable);
    expect(() => ghJson(policy, [])).toThrow();
  });

  it("fixes signature, issuer, signer, source and process bounds in argv", () => {
    const policy = verifierProgram();
    let observed:
      | { command: string; args: readonly string[]; options: object }
      | undefined;
    const execute = (
      command: string,
      args: readonly string[] = [],
      options: object = {}
    ) => {
      observed = { command, args, options };
      const output = result();
      output[0]!.verificationResult.verifiedTimestamps[0]!.timestamp =
        new Date().toISOString();
      return {
        status: 0,
        stdout: JSON.stringify(output),
        stderr: "",
        signal: null,
        pid: 0,
        output: [null, JSON.stringify(output), ""] as [null, string, string],
      };
    };
    verifyDescriptorAttestation(
      policy,
      DESCRIPTOR,
      {
        descriptor: "/private/descriptor.json",
        bundle: "/private/bundle.json",
      },
      DIGEST,
      execute
    );
    expect(observed?.command).toBe(policy.ghExecutable);
    expect(observed?.args).toEqual([
      "attestation",
      "verify",
      "/private/descriptor.json",
      "--bundle",
      "/private/bundle.json",
      "--repo",
      POLICY.repository,
      "--signer-workflow",
      POLICY.signerWorkflow,
      "--signer-digest",
      SIGNER,
      "--source-digest",
      BASE,
      "--source-ref",
      "refs/heads/main",
      "--predicate-type",
      PROPOSAL_PREDICATE,
      "--cert-oidc-issuer",
      ACTIONS_ISSUER,
      "--deny-self-hosted-runners",
      "--format",
      "json",
    ]);
    expect(observed?.options).toMatchObject({
      timeout: 30_000,
      maxBuffer: 1_048_576,
    });
  });
});

describe("verified certificate and durable signing-time policy", () => {
  it("accepts exact verified identity and independently witnessed signing time", () => {
    expect(
      assertVerifiedAttestation(result(), DESCRIPTOR, DIGEST, POLICY, NOW)
        .issuer
    ).toBe(ACTIONS_ISSUER);
  });

  it("supports the next independently matched base without static caller SHA churn", () => {
    const next = "d".repeat(40);
    expect(
      assertVerifiedAttestation(
        result(next),
        { ...DESCRIPTOR, parent: next },
        DIGEST,
        POLICY,
        NOW
      ).buildConfigDigest
    ).toBe(next);
  });

  it.each([
    "issuer",
    "buildSignerURI",
    "buildSignerDigest",
    "buildConfigURI",
    "buildConfigDigest",
    "sourceRepositoryURI",
    "sourceRepositoryDigest",
    "sourceRepositoryRef",
    "sourceRepositoryIdentifier",
    "sourceRepositoryOwnerIdentifier",
    "runInvocationURI",
    "runnerEnvironment",
    "buildTrigger",
  ] as const)("refuses mismatched authenticated %s", key => {
    const output = result();
    output[0]!.verificationResult.signature.certificate[key] = "foreign";
    expect(() =>
      assertVerifiedAttestation(output, DESCRIPTOR, DIGEST, POLICY, NOW)
    ).toThrow("automation provenance");
  });

  it("rejects replay of an older caller source against a new proposal base", () => {
    expect(() =>
      assertVerifiedAttestation(
        result(),
        { ...DESCRIPTOR, parent: "d".repeat(40) },
        DIGEST,
        POLICY,
        NOW
      )
    ).toThrow();
  });

  it.each(["CurrentTime", "unverified"])(
    "refuses %s as an authenticated signing time",
    type => {
      const output = result();
      output[0]!.verificationResult.verifiedTimestamps[0]!.type = type;
      expect(() =>
        assertVerifiedAttestation(output, DESCRIPTOR, DIGEST, POLICY, NOW)
      ).toThrow();
    }
  );

  it.each([EXPIRED_TIME, "2026-10-05T13:00:00Z", "invalid"])(
    "refuses expired/future/invalid authorization: %s",
    timestamp => {
      const output = result();
      output[0]!.verificationResult.verifiedTimestamps[0]!.timestamp =
        timestamp;
      expect(() =>
        assertVerifiedAttestation(output, DESCRIPTOR, DIGEST, POLICY, NOW)
      ).toThrow();
    }
  );

  it("does not use unsigned metadata as a missing certificate", () => {
    const output = {
      verificationResult: {
        statement: result()[0]!.verificationResult.statement,
        verifiedTimestamps: [],
      },
    };
    expect(() =>
      assertVerifiedAttestation([output], DESCRIPTOR, DIGEST, POLICY, NOW)
    ).toThrow();
  });

  it.each([[], [...result(), ...result()]])(
    "refuses absent or ambiguous verification results",
    output => {
      expect(() =>
        assertVerifiedAttestation(output, DESCRIPTOR, DIGEST, POLICY, NOW)
      ).toThrow();
    }
  );

  it("hashes actual descriptor bytes rather than a supplied subject claim", () => {
    expect(sha256("descriptor\n")).not.toBe(sha256("descriptor"));
    expect(() =>
      assertVerifiedAttestation(
        result(),
        DESCRIPTOR,
        "e".repeat(64),
        POLICY,
        NOW
      )
    ).toThrow();
  });
});

/** These controls qualify closed recovery decisions, never hosted signatures. */
describe("explicit historical origin and fresh recovery roles", () => {
  const origin = {
    ...DESCRIPTOR,
    proposalKey: DIGEST,
    policySha256: DIGEST,
    claimCommentId: "18",
    claimSha256: DIGEST,
    queue: POLICY.repository,
    workItem: "acme/widgets#42",
    tree: SIGNER,
    messageSha256: DIGEST,
  };
  const recovery = {
    version: 1,
    purpose: "resume-identical-npm-proposal",
    repository: POLICY.repository,
    repositoryId: "123",
    ownerId: "456",
    queue: origin.queue,
    workItem: origin.workItem,
    proposalKey: DIGEST,
    bindingKey: origin.proposalKey,
    npmPolicySha256: DIGEST,
    automationPolicySha256: origin.policySha256,
    originDescriptorSha256: DIGEST,
    originRunId: origin.runId,
    originRunAttempt: origin.runAttempt,
    commit: "d".repeat(40),
    parent: BASE,
    tree: origin.tree,
    messageSha256: DIGEST,
    claimCommentId: origin.claimCommentId,
    claimSha256: DIGEST,
    leafBodySha256: DIGEST,
    branch: `lisa/npm-${DIGEST}`,
    expectedBranchHead: null,
    prNumber: null,
    expectedPrHead: null,
    runId: "5678",
    runAttempt: "2",
  };
  const historicalRun = {
    status: "completed",
    run_started_at: "2026-10-05T10:00:00Z",
    updated_at: "2026-10-05T11:01:00Z",
  };
  const claim = { created_at: "2026-10-05T10:01:00Z" };

  it("authenticates a later active-run historical signature without granting ordinary freshness", () => {
    const output = result();
    output[0]!.verificationResult.verifiedTimestamps[0]!.timestamp =
      EXPIRED_TIME;
    const live = {
      ...historicalRun,
      status: "in_progress",
      updated_at: "2026-10-05T10:02:00Z",
    };
    const verify = (changed = {}, observed = NOW) =>
      assertHistoricalAttestation(
        output,
        origin,
        DIGEST,
        POLICY,
        { ...live, ...changed },
        claim,
        observed
      );
    expect(() =>
      assertVerifiedAttestation(output, origin, DIGEST, POLICY, NOW)
    ).toThrow();
    expect(verify().issuer).toBe(ACTIONS_ISSUER);
    for (const changed of [
      { status: "completed" },
      { status: "queued" },
      { status: "failure" },
      { status: undefined },
      { updated_at: "2026-10-05T09:59:00Z" },
      { updated_at: "2026-10-05T12:01:01Z" },
    ])
      expect(() => verify(changed)).toThrow();
    expect(() => verify({}, Number.NaN)).toThrow();
    output[0]!.verificationResult.verifiedTimestamps[0]!.timestamp =
      "2026-10-05T12:01:01Z";
    expect(() => verify()).toThrow();
  });

  it("authenticates old origin within provider chronology while ordinary v1 expires", () => {
    const output = result();
    output[0]!.verificationResult.verifiedTimestamps[0]!.timestamp =
      EXPIRED_TIME;
    expect(() =>
      assertVerifiedAttestation(output, origin, DIGEST, POLICY, NOW)
    ).toThrow();
    expect(
      assertHistoricalAttestation(
        output,
        origin,
        DIGEST,
        POLICY,
        historicalRun,
        claim,
        NOW
      ).issuer
    ).toBe(ACTIONS_ISSUER);
    expect(() =>
      assertHistoricalAttestation(
        output,
        origin,
        DIGEST,
        POLICY,
        { ...historicalRun, updated_at: "2026-10-05T10:20:00Z" },
        claim,
        NOW
      )
    ).toThrow();
    expect(() =>
      assertHistoricalAttestation(
        output,
        origin,
        DIGEST,
        POLICY,
        historicalRun,
        { created_at: "2026-10-05T11:20:00Z" },
        NOW
      )
    ).toThrow();
    expect(() =>
      assertHistoricalAttestation(
        output,
        origin,
        DIGEST,
        POLICY,
        {},
        claim,
        NOW
      )
    ).toThrow();
  });

  it("binds fresh recovery to original immutable subject without changing its run", () => {
    expect(validateRecovery(recovery, origin, DIGEST, POLICY)).toEqual(
      recovery
    );
    const output = result();
    output[0]!.verificationResult.statement.predicateType = RECOVERY_PREDICATE;
    output[0]!.verificationResult.statement.subject[0]!.name = "recovery.json";
    output[0]!.verificationResult.signature.certificate.runInvocationURI =
      "https://github.com/acme/widgets/actions/runs/5678/attempts/2";
    expect(
      assertRecoveryAttestation(output, recovery, DIGEST, POLICY, NOW).issuer
    ).toBe(ACTIONS_ISSUER);
    expect(() =>
      assertVerifiedAttestation(output, origin, DIGEST, POLICY, NOW)
    ).toThrow();
    expect(() =>
      assertRecoveryAttestation(result(), recovery, DIGEST, POLICY, NOW)
    ).toThrow();
    output[0]!.verificationResult.verifiedTimestamps[0]!.timestamp =
      EXPIRED_TIME;
    expect(() =>
      assertRecoveryAttestation(output, recovery, DIGEST, POLICY, NOW)
    ).toThrow();
  });

  it.each([
    "originDescriptorSha256",
    "originRunId",
    "bindingKey",
    "parent",
    "tree",
    "messageSha256",
    "claimCommentId",
    "claimSha256",
    "automationPolicySha256",
    "queue",
    "workItem",
    "repositoryId",
    "ownerId",
  ])("rejects changed immutable recovery %s", field => {
    expect(() =>
      validateRecovery(
        { ...recovery, [field]: "foreign" },
        origin,
        DIGEST,
        POLICY
      )
    ).toThrow();
  });

  it("refuses extra fields, partial destination, traversal and same invocation replay", () => {
    for (const value of [
      { ...recovery, ignoreExpiry: true },
      { ...recovery, expectedBranchHead: "d".repeat(40), prNumber: 9 },
      { ...recovery, branch: "../foreign" },
      { ...recovery, runId: origin.runId, runAttempt: origin.runAttempt },
    ])
      expect(() => validateRecovery(value, origin, DIGEST, POLICY)).toThrow();
  });
});
