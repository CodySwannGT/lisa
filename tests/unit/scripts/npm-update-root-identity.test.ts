/**
 * Root identity goldens for the npm updater.
 *
 * These values were captured from the root-only implementation before
 * multi-directory support (CodySwannGT/lisa#4741) existed. Every already
 * published root proposal, leaf and recovery checkpoint is keyed by them, so a
 * change here silently orphans live work items: a root-only configuration must
 * keep producing byte-identical keys, digests, titles and bodies forever.
 */
import { describe, expect, it } from "vitest";
import {
  proposalFrom,
  selectPolicy,
  validatePolicy,
} from "../../../all/copy-overwrite/scripts/lib/npm-update-contract.mjs";
import { buildDraft } from "../../../all/copy-overwrite/scripts/lib/npm-update-leaf-contract.mjs";
import { canonicalJson } from "../../../all/copy-overwrite/scripts/lib/automation-provenance-contract.mjs";
import { sha256 } from "../../../all/copy-overwrite/scripts/lib/github-attestation-verifier.mjs";

const PARENT = "a".repeat(40);
const POLICY = {
  version: 1,
  repository: "acme/widgets",
  directory: ".",
  target: "main",
  maintainer: "maintainer",
  packages: [{ name: "is-number", version: "7.0.0" }],
  lisaOwner: "absent",
};
const RUNTIME = {
  profile: "rails-mysql",
  database: "lisa_runtime",
  browser: false,
  dockerFixtures: false,
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
        done: { production: "queue:done" },
      },
    },
  },
  deploy: { branches: { production: "main" } },
};
const BEFORE = {
  name: "fixture",
  version: "1.0.0",
  dependencies: { "is-number": "6.0.0" },
};
const AFTER = { ...BEFORE, dependencies: { "is-number": "7.0.0" } };
const LOCK = {
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
};
const FILES = {
  "package.json": `${JSON.stringify(AFTER)}\n`,
  "package-lock.json": `${JSON.stringify(LOCK)}\n`,
};
const UPDATES = [
  { name: "is-number", section: "dependencies", from: "6.0.0", to: "7.0.0" },
];
const EVIDENCE = {
  history: {
    command: "git log main -- package.json package-lock.json",
    result: "none",
  },
  search: { query: "repo:acme/widgets npm in:title,body", total: 0 },
  registry: [{ name: "is-number", version: "7.0.0" }],
  labels: ["type:Task", "priority:medium", "queue:ready", "queue:active"],
  main: PARENT,
};

/**
 * The identity projection every published root artifact is keyed by, in the
 * fixed order proposal key, selection key, binding key, policy digest. A plain
 * list keeps the hex goldens off lines a secret scanner reads as `key = value`.
 */
function identity(proposal: Record<string, unknown>) {
  return [
    proposal.key,
    proposal.selectionKey,
    proposal.bindingKey,
    proposal.policySha256,
  ];
}

const twoFile = (policy: Record<string, unknown>) =>
  proposalFrom(policy, PARENT, BEFORE, FILES, UPDATES);
const bunThreeFile = (policy: Record<string, unknown>) =>
  proposalFrom(
    policy,
    PARENT,
    BEFORE,
    { ...FILES, "bun.lock": "prepared Bun bytes" },
    UPDATES,
    "b".repeat(64)
  );

describe("root identity is unchanged", () => {
  it("keeps the two-file root proposal identity", () => {
    expect(identity(twoFile(validatePolicy(POLICY, CONFIG))))
      .toMatchInlineSnapshot(`
        [
          "d586a08edccca8e122e58789873e1b545f2d96154a0a0a20f16cc3d047f58967",
          "d1cd263d756e5b5e71c16fab57f1981d05fac17c2ee2a5099f924cae4cebc507",
          "ead3e9d38945570ed092aa809bcfd309c332cc5da9222b481380a51c72000fe7",
          "cf338c213fd5f035d87ba4bfc0322cc1415a9fd959e14d8fba5119606c6b5950",
        ]
      `);
  });

  it("keeps the Bun three-file root proposal identity", () => {
    expect(identity(bunThreeFile(validatePolicy(POLICY, CONFIG))))
      .toMatchInlineSnapshot(`
        [
          "1281e854f1b439106b922bcaee136594d1e33233b60008e9949f69a5252b34fb",
          "d1cd263d756e5b5e71c16fab57f1981d05fac17c2ee2a5099f924cae4cebc507",
          "e05e6fa643d13aad508be4b662db6431f219d1e8add3c29899933e289a23acb4",
          "cf338c213fd5f035d87ba4bfc0322cc1415a9fd959e14d8fba5119606c6b5950",
        ]
      `);
  });

  it("keeps the Rails runtime root proposal identity", () => {
    const policy = validatePolicy({ ...POLICY, runtime: RUNTIME }, CONFIG);
    expect(identity(twoFile(policy))).toMatchInlineSnapshot(`
      [
        "4f5895c0e4b4eb18cc8b78de29698b000e2132fea42b0acdd4885f929b2b8164",
        "cf54091a4ca243a78c21017b460e3ef738eb39c6108cd871de44b542bbae574d",
        "552fb16c05f45b2ecec2e5163400aaee347faa6e7e1fec593a124929dd038869",
        "5c4637a43cf0538bfeda5ccb5e174aa4adde6021331156ad0bc107495bd2fdcf",
      ]
    `);
  });

  it("keeps the root policy digest", () => {
    expect(
      sha256(canonicalJson(validatePolicy(POLICY, CONFIG)))
    ).toMatchInlineSnapshot(
      `"cf338c213fd5f035d87ba4bfc0322cc1415a9fd959e14d8fba5119606c6b5950"`
    );
  });

  it("keeps the byte-exact root leaf title and body", () => {
    const policy = validatePolicy(POLICY, CONFIG);
    const draft = buildDraft(twoFile(policy), policy, CONFIG, EVIDENCE);
    expect(draft.title).toMatchInlineSnapshot(
      `"Update selected npm dependencies"`
    );
    expect(sha256(draft.body)).toMatchInlineSnapshot(
      `"809e25c8b6a2b9e643b88d7d8bc22de72bb6f85d15ea436f7edf98eee1273027"`
    );
    const bun = buildDraft(bunThreeFile(policy), policy, CONFIG, EVIDENCE);
    expect(bun.title).toMatchInlineSnapshot(
      `"Update selected npm dependencies"`
    );
    expect(sha256(bun.body)).toMatchInlineSnapshot(
      `"92d8648249831f2ed7f75fc62d7baf616358258d957c96f6adb0c54e14de3a8d"`
    );
  });

  it("gives the root entry of a directory list the same identity as the legacy object", () => {
    const legacy = selectPolicy({ ...CONFIG, npmUpdater: POLICY }, ".");
    const listed = selectPolicy(
      {
        ...CONFIG,
        npmUpdater: [POLICY, { ...POLICY, directory: "externals" }],
      },
      "."
    );
    expect(listed).toEqual(validatePolicy(POLICY, CONFIG));
    expect(identity(twoFile(listed))).toEqual(identity(twoFile(legacy)));
    expect(identity(bunThreeFile(listed))).toEqual(
      identity(bunThreeFile(legacy))
    );
    expect(identity(twoFile(listed))[0]).toBe(
      "d586a08edccca8e122e58789873e1b545f2d96154a0a0a20f16cc3d047f58967"
    );
  });
});
