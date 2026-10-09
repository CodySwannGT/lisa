/** Closed runtime opt-in is signed data, never a workflow or environment extension. */
import { describe, expect, it } from "vitest";
import {
  proposalFrom,
  validatePolicy,
  validateProposal,
} from "../../../all/copy-overwrite/scripts/lib/npm-update-contract.mjs";
import { canonicalJson } from "../../../all/copy-overwrite/scripts/lib/automation-provenance-contract.mjs";
import { sha256 } from "../../../all/copy-overwrite/scripts/lib/github-attestation-verifier.mjs";
import {
  runtimeSchemas,
  affirmRuntimeProfile,
} from "../../../all/copy-overwrite/scripts/lib/npm-update-rails-runtime-contract.mjs";

const CONFIG = { tracker: "github", github: { org: "fixture", repo: "host" } };
const RUNTIME_PROFILE = "rails-mysql";
const POLICY = {
  version: 1,
  repository: "fixture/host",
  directory: ".",
  target: "main",
  maintainer: "Fixture",
  lisaOwner: "absent",
  packages: [{ name: "is-number", version: "7.0.0" }],
};
const RUNTIME = {
  profile: RUNTIME_PROFILE,
  database: "lisa_runtime",
  browser: false,
  dockerFixtures: false,
};
const BEFORE = {
  name: "fixture",
  version: "1.0.0",
  dependencies: { "is-number": "6.0.0" },
};
const AFTER = { ...BEFORE, dependencies: { "is-number": "7.0.0" } };
const UPDATES = [
  { name: "is-number", section: "dependencies", from: "6.0.0", to: "7.0.0" },
];
const FILES = {
  "package.json": JSON.stringify(AFTER),
  "package-lock.json": JSON.stringify({
    ...AFTER,
    lockfileVersion: 3,
    packages: {
      "": AFTER,
      "node_modules/is-number": {
        version: "7.0.0",
        resolved: "https://registry.npmjs.org/is-number/-/is-number-7.0.0.tgz",
        integrity: `sha512-${Buffer.alloc(64, 1).toString("base64")}`,
      },
    },
  }),
};
const PARENT = "a".repeat(40);

describe("signed Rails runtime profile", () => {
  it("requires an exact caller affirmation of the committed signed profile", () => {
    const policy = { ...POLICY, runtime: RUNTIME };
    const proposal = proposalFrom(policy, PARENT, BEFORE, FILES, UPDATES);
    expect(affirmRuntimeProfile(proposal, policy, RUNTIME_PROFILE)).toEqual(
      RUNTIME
    );
    for (const input of [undefined, "none", "Rails-MySQL", "rails-mysql\n"])
      expect(() => affirmRuntimeProfile(proposal, policy, input)).toThrow();
    expect(() =>
      affirmRuntimeProfile(
        { ...proposal, runtimeSha256: "b".repeat(64) },
        policy,
        RUNTIME_PROFILE
      )
    ).toThrow();
    const absent = proposalFrom(POLICY, PARENT, BEFORE, FILES, UPDATES);
    expect(affirmRuntimeProfile(absent, POLICY, "none")).toBeUndefined();
    expect(() =>
      affirmRuntimeProfile(absent, POLICY, RUNTIME_PROFILE)
    ).toThrow();
  });
  it("accepts the finite profile without mutating trusted input", () => {
    const policy = { ...POLICY, runtime: RUNTIME };
    const result = validatePolicy(policy, CONFIG);
    expect(result).toEqual(policy);
    expect(result).not.toBe(policy);
    expect(result.runtime).not.toBe(RUNTIME);
  });

  it.each(["a", `a${"b".repeat(40)}`])(
    "accepts a bounded ASCII database name %s",
    database => {
      expect(() =>
        validatePolicy({ ...POLICY, runtime: { ...RUNTIME, database } }, CONFIG)
      ).not.toThrow();
    }
  );

  it.each([
    { profile: "mysql" },
    { database: "" },
    { database: "1db" },
    { database: "Upper" },
    { database: "a-b" },
    { database: "a/b" },
    { database: "é" },
    { database: `a${"b".repeat(41)}` },
    { database: "db\n" },
    { browser: "false" },
    { browser: 0 },
    { dockerFixtures: "true" },
    { command: "echo unsafe" },
    { port: 3307 },
    { password: "synthetic" },
  ])("refuses unsupported closed profile data %#", change => {
    expect(() =>
      validatePolicy({ ...POLICY, runtime: { ...RUNTIME, ...change } }, CONFIG)
    ).toThrow();
  });

  it.each([null, false, [], {}, { ...RUNTIME, browser: undefined }])(
    "refuses missing or nonobject profile fields %#",
    runtime => {
      expect(() => validatePolicy({ ...POLICY, runtime }, CONFIG)).toThrow();
    }
  );

  it("preserves the exact historical absent-profile binding", () => {
    const proposal = proposalFrom(POLICY, PARENT, BEFORE, FILES, UPDATES);
    expect(proposal).not.toHaveProperty("runtimeSha256");
    expect(proposal.bindingKey).toBe(
      sha256(
        canonicalJson({
          repository: POLICY.repository,
          parent: PARENT,
          updates: UPDATES,
        })
      )
    );
    expect(validateProposal(proposal, POLICY)).toEqual(proposal);
  });

  it("derives only the four test roles within the actual MySQL identifier limit", () => {
    expect(runtimeSchemas({ ...POLICY, runtime: RUNTIME })).toEqual([
      "lisa_runtime_test",
      "lisa_runtime_queue_test",
      "lisa_runtime_cache_test",
      "lisa_runtime_cable_test",
    ]);
    const names = runtimeSchemas({
      ...POLICY,
      runtime: { ...RUNTIME, database: `a${"b".repeat(40)}` },
    });
    expect(names.every(name => Buffer.byteLength(name) <= 64)).toBe(true);
    expect(() => runtimeSchemas(POLICY)).toThrow(/absent/);
  });

  it("binds every normalized profile field in the signed proposal identity", () => {
    const policy = { ...POLICY, runtime: RUNTIME };
    const proposal = proposalFrom(policy, PARENT, BEFORE, FILES, UPDATES);
    const runtimeSha256 = sha256(canonicalJson(RUNTIME));
    expect(proposal.runtimeSha256).toBe(runtimeSha256);
    expect(proposal.bindingKey).toBe(
      sha256(
        canonicalJson({
          repository: POLICY.repository,
          parent: PARENT,
          updates: UPDATES,
          runtimeSha256,
        })
      )
    );
    for (const change of [
      { database: "other" },
      { browser: true },
      { dockerFixtures: true },
    ]) {
      const changed = { ...POLICY, runtime: { ...RUNTIME, ...change } };
      expect(() => validateProposal(proposal, changed)).toThrow();
      expect(
        proposalFrom(changed, PARENT, BEFORE, FILES, UPDATES).bindingKey
      ).not.toBe(proposal.bindingKey);
    }
  });

  it("refuses digest omission, substitution and unexpected profile digests", () => {
    const policy = { ...POLICY, runtime: RUNTIME };
    const proposal = proposalFrom(policy, PARENT, BEFORE, FILES, UPDATES);
    const { runtimeSha256: _digest, ...omitted } = proposal;
    expect(() => validateProposal(omitted, policy)).toThrow();
    expect(() =>
      validateProposal({ ...proposal, runtimeSha256: "f".repeat(64) }, policy)
    ).toThrow();
    const plain = proposalFrom(POLICY, PARENT, BEFORE, FILES, UPDATES);
    expect(() =>
      validateProposal({ ...plain, runtimeSha256: "f".repeat(64) }, POLICY)
    ).toThrow();
  });
});
