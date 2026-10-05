/** Verified-output policy fixtures are not genuine provider issuance proof. */
import { afterEach, describe, expect, it } from "vitest";
import {
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ACTIONS_ISSUER,
  assertVerifiedAttestation,
  ghJson,
  PROPOSAL_PREDICATE,
  sha256,
  verifyDescriptorAttestation,
} from "../../../all/copy-overwrite/scripts/lib/github-attestation-verifier.mjs";

const NOW = Date.parse("2026-10-05T12:00:00Z");
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

  it("kills an actual nonterminating verifier and refuses a verdict", () => {
    expect(() => ghJson(verifierProgram(), ["hang"])).toThrow();
  }, 40_000);

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

  it.each(["2026-10-05T11:00:00Z", "2026-10-05T13:00:00Z", "invalid"])(
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
