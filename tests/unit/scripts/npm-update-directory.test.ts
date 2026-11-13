/**
 * Multi-directory npm updater contract (CodySwannGT/lisa#4741).
 *
 * A committed `npmUpdater` policy may be one object (the historical root
 * project) or a list of the same objects, one per npm project directory. Each
 * run selects exactly one committed directory, and a subdirectory proposal is
 * npm-only: it names its own two files, signs its directory, and never reads
 * or binds the root Bun lock.
 */
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  readFileSync,
  renameSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { useIoLatencyBudget } from "../../helpers/io-latency-budget.js";
import {
  proposalFrom,
  selectPolicy,
  validatePolicy,
  validateProposal,
} from "../../../all/copy-overwrite/scripts/lib/npm-update-contract.mjs";
import {
  DESCRIPTOR_KEYS,
  canonicalJson,
  exactKeys,
  hashCohort,
  historyPaths,
  installInputs,
  npmProposal,
  proposalFileNames,
  signedProposalFields,
  policyEntry,
  proposalPolicy,
  validDirectory,
} from "../../../all/copy-overwrite/scripts/lib/automation-provenance-contract.mjs";
import { baseline } from "../../../all/copy-overwrite/scripts/lib/npm-update-prepare.mjs";
import { descriptorFor } from "../../../all/copy-overwrite/scripts/lib/npm-update-gate.mjs";
import { originalDescriptor } from "../../../all/copy-overwrite/scripts/lib/npm-update-cancel-origin.mjs";
import { buildDraft } from "../../../all/copy-overwrite/scripts/lib/npm-update-leaf-contract.mjs";
import { main } from "../../../all/copy-overwrite/scripts/lisa-npm-updater.mjs";
import { sha256 } from "../../../all/copy-overwrite/scripts/lib/github-attestation-verifier.mjs";
import {
  effectiveEngineStrict,
  runProcess,
  withPrivateRoot,
} from "../../../all/copy-overwrite/scripts/lib/npm-update-process.mjs";

useIoLatencyBudget();
const EXTERNALS = "externals";
const GIT_NAME = "user.name=Fixture";
const GIT_EMAIL = "user.email=fixture@example.test";
const MANIFEST_FILE = "package.json";
const LOCK_FILE = "package-lock.json";
const EXTERNALS_MANIFEST = "externals/package.json";
const EXTERNALS_LOCK = "externals/package-lock.json";
const ORIGINAL_BUN = '{"lockfileVersion":1}\n';
const NOT_SELECTED = /not a committed npm updater selection/;
const CONFIG = { tracker: "github", github: { org: "fixture", repo: "host" } };
const ROOT = {
  version: 1,
  repository: "fixture/host",
  directory: ".",
  target: "main",
  maintainer: "Fixture",
  lisaOwner: "absent",
  packages: [{ name: "is-number", version: "7.0.0" }],
};
const SUB = { ...ROOT, directory: EXTERNALS };
const BEFORE = {
  name: "fixture",
  version: "1.0.0",
  dependencies: { "is-number": "6.0.0" },
};
const AFTER = { ...BEFORE, dependencies: { "is-number": "7.0.0" } };
const LOCK = {
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
};
const UPDATES = [
  { name: "is-number", section: "dependencies", from: "6.0.0", to: "7.0.0" },
];
const ROOT_FILES = {
  [MANIFEST_FILE]: JSON.stringify(AFTER),
  [LOCK_FILE]: JSON.stringify(LOCK),
};
const SUB_FILES = {
  [EXTERNALS_MANIFEST]: JSON.stringify(AFTER),
  [EXTERNALS_LOCK]: JSON.stringify(LOCK),
};
const PARENT = "a".repeat(40);
const AUTOMATION = { enabled: true, version: 1 };
const ALLOCATION = {
  workItem: "fixture/host#1",
  claimCommentId: "1",
  claimSha256: "a".repeat(64),
};

const subProposal = (parent = PARENT) =>
  proposalFrom(SUB, parent, BEFORE, SUB_FILES, UPDATES);
const rootProposal = (parent = PARENT) =>
  proposalFrom(ROOT, parent, BEFORE, ROOT_FILES, UPDATES);

describe("committed npm project directory names", () => {
  it.each([
    ".",
    EXTERNALS,
    "services/lambda",
    "a_b-c.d",
    "_private",
    Array.from({ length: 8 }, () => "a").join("/"),
    "x".repeat(64),
  ])("accepts %s", value => expect(validDirectory(value)).toBe(true));

  it.each([
    "",
    "./externals",
    "externals/",
    "/externals",
    "../externals",
    "a/../b",
    "a/./b",
    "a//b",
    ".hidden",
    "node_modules",
    "a/node_modules/b",
    "a\\b",
    "a b",
    Array.from({ length: 9 }, () => "a").join("/"),
    "x".repeat(65),
    `${`${"a".repeat(60)}/`.repeat(4)}a`,
    5,
    null,
    undefined,
  ])("refuses %s", value => expect(validDirectory(value)).toBe(false));
});

describe("committed directory selection", () => {
  it("reads the legacy single object as the one root entry", () => {
    const config = { ...CONFIG, npmUpdater: ROOT };
    expect(selectPolicy(config, ".")).toEqual(validatePolicy(ROOT, CONFIG));
    expect(() => selectPolicy(config, EXTERNALS)).toThrow(NOT_SELECTED);
  });

  it("accepts exactly eight distinct directories", () => {
    const npmUpdater = [
      ROOT,
      ...Array.from({ length: 7 }, (_, index) => ({
        ...SUB,
        directory: `d${index}`,
      })),
    ];
    expect(selectPolicy({ ...CONFIG, npmUpdater }, "d6").directory).toBe("d6");
    expect(selectPolicy({ ...CONFIG, npmUpdater }, ".")).toEqual(ROOT);
  });

  it("selects exactly one entry of a directory list", () => {
    const config = { ...CONFIG, npmUpdater: [ROOT, SUB] };
    expect(selectPolicy(config, ".")).toEqual(ROOT);
    expect(selectPolicy(config, EXTERNALS)).toEqual(SUB);
    expect(() => selectPolicy(config, "missing")).toThrow(NOT_SELECTED);
    expect(() => selectPolicy(config, undefined)).toThrow(NOT_SELECTED);
  });

  it.each([
    ["an empty list", [], /directory list/],
    [
      "nine distinct valid directories",
      [
        ROOT,
        ...Array.from({ length: 8 }, (_, index) => ({
          ...SUB,
          directory: `d${index}`,
        })),
      ],
      /directory list/,
    ],
    ["a nested list", [[ROOT]], /directory list/],
    [
      "a duplicate directory",
      [ROOT, { ...ROOT, maintainer: "Other" }],
      /duplicate/,
    ],
    [
      "an invalid sibling entry",
      [ROOT, { ...SUB, repository: "foreign/x" }],
      /repository\/tracker/,
    ],
    [
      "an escaping sibling entry",
      [ROOT, { ...SUB, directory: "../x" }],
      /committed npm directory/,
    ],
  ])("refuses %s even when the root is selected", (_name, npmUpdater, reason) =>
    expect(() => selectPolicy({ ...CONFIG, npmUpdater }, ".")).toThrow(reason)
  );

  it("keeps a subdirectory npm-only: no Lisa owner and no runtime profile", () => {
    expect(() =>
      validatePolicy({ ...SUB, lisaOwner: "verified-local-full-apply" }, CONFIG)
    ).toThrow(/no Lisa owner or runtime profile/);
    expect(() =>
      validatePolicy(
        {
          ...SUB,
          runtime: {
            profile: "rails-mysql",
            database: "lisa_runtime",
            browser: false,
            dockerFixtures: false,
          },
        },
        CONFIG
      )
    ).toThrow(/no Lisa owner or runtime profile/);
  });

  it("keeps the tracker and target restrictions for every entry", () => {
    expect(() => validatePolicy(SUB, { ...CONFIG, tracker: "linear" })).toThrow(
      /tracker/
    );
    expect(() => validatePolicy({ ...SUB, target: "dev" }, CONFIG)).toThrow();
  });
});

describe("directory-separated proposal identity", () => {
  it("signs the directory and names only that directory's two files", () => {
    const proposal = subProposal();
    expect(proposal.directory).toBe(EXTERNALS);
    expect(
      Object.keys(proposal.files).sort((a, b) => a.localeCompare(b))
    ).toEqual([EXTERNALS_LOCK, EXTERNALS_MANIFEST]);
    expect(
      Object.keys(proposal.hashes).sort((a, b) => a.localeCompare(b))
    ).toEqual([EXTERNALS_LOCK, EXTERNALS_MANIFEST]);
    expect(proposalFileNames(proposal)).toEqual([
      EXTERNALS_LOCK,
      EXTERNALS_MANIFEST,
    ]);
    expect(signedProposalFields(proposal)).toEqual({ directory: EXTERNALS });
    expect(validateProposal(proposal, SUB)).toEqual(proposal);
  });

  it("gives each directory its own keys and publication branch", () => {
    const root = rootProposal();
    const sub = subProposal();
    for (const field of ["key", "selectionKey", "bindingKey", "policySha256"])
      expect(sub[field as keyof typeof sub]).not.toBe(
        root[field as keyof typeof root]
      );
    expect(`lisa/npm-${sub.key}`).not.toBe(`lisa/npm-${root.key}`);
    expect(subProposal("b".repeat(40)).selectionKey).toBe(sub.selectionKey);
  });

  it("refuses a proposal validated against another directory's policy", () => {
    expect(() => validateProposal(subProposal(), ROOT)).toThrow();
    expect(() => validateProposal(rootProposal(), SUB)).toThrow();
    expect(() =>
      validateProposal({ ...subProposal(), directory: "." }, SUB)
    ).toThrow();
  });

  it("refuses root-keyed files or a Bun digest for a subdirectory", () => {
    expect(() =>
      proposalFrom(SUB, PARENT, BEFORE, ROOT_FILES, UPDATES)
    ).toThrow();
    expect(() =>
      proposalFrom(
        SUB,
        PARENT,
        BEFORE,
        { ...SUB_FILES, "bun.lock": "prepared" },
        UPDATES,
        "b".repeat(64)
      )
    ).toThrow(/cannot bind a Bun lock/);
  });
});

describe("signed descriptor directory field", () => {
  const descriptor = Object.fromEntries(DESCRIPTOR_KEYS.map(key => [key, "x"]));
  const exact = (value: Record<string, unknown>) =>
    exactKeys(
      value,
      [...DESCRIPTOR_KEYS, ...Object.keys(signedProposalFields(value))],
      "descriptor"
    );

  it("keeps the historical root key set and refuses an explicit root directory", () => {
    expect(() => exact(descriptor)).not.toThrow();
    expect(() => exact({ ...descriptor, directory: EXTERNALS })).not.toThrow();
    expect(() => exact({ ...descriptor, directory: "." })).toThrow(
      /descriptor fields differ/
    );
  });

  it("refuses a duplicated directory on the hook side, as selectPolicy does", () => {
    const config = { npmUpdater: [ROOT, SUB, { ...SUB, maintainer: "Other" }] };
    expect(() => policyEntry(config, EXTERNALS)).toThrow(/duplicate/);
    expect(() => proposalPolicy(config, subProposal())).toThrow(/duplicate/);
    expect(policyEntry(config, ".")).toEqual(ROOT);
    expect(() => selectPolicy({ ...CONFIG, ...config }, EXTERNALS)).toThrow(
      /duplicate/
    );
  });

  it("refuses an invalid or Bun-bound subdirectory", () => {
    expect(() => signedProposalFields({ directory: "../escape" })).toThrow();
    expect(() =>
      signedProposalFields({
        directory: EXTERNALS,
        bunLockSha256: "a".repeat(64),
      })
    ).toThrow(/cannot bind a Bun lock/);
  });

  it("derives history paths, install inputs and the closed hash cohort", () => {
    const bun = { bunLockSha256: "a".repeat(64) };
    expect(historyPaths({})).toEqual([MANIFEST_FILE, LOCK_FILE]);
    expect(historyPaths(bun)).toEqual([MANIFEST_FILE, LOCK_FILE, "bun.lock"]);
    expect(historyPaths({ directory: EXTERNALS })).toEqual([
      EXTERNALS_MANIFEST,
      EXTERNALS_LOCK,
    ]);
    expect(installInputs({})).toEqual([LOCK_FILE, MANIFEST_FILE]);
    expect(installInputs({ directory: EXTERNALS })).toEqual([
      LOCK_FILE,
      MANIFEST_FILE,
      EXTERNALS_LOCK,
      EXTERNALS_MANIFEST,
    ]);
    const hashes = (names: string[]) =>
      Object.fromEntries(names.map(name => [name, "h"]));
    expect(hashCohort(hashes([MANIFEST_FILE, LOCK_FILE]))).toEqual([
      LOCK_FILE,
      MANIFEST_FILE,
    ]);
    expect(hashCohort(hashes(["bun.lock", MANIFEST_FILE, LOCK_FILE]))).toEqual([
      "bun.lock",
      LOCK_FILE,
      MANIFEST_FILE,
    ]);
    expect(hashCohort(hashes([EXTERNALS_MANIFEST, EXTERNALS_LOCK]))).toEqual([
      EXTERNALS_LOCK,
      EXTERNALS_MANIFEST,
    ]);
    for (const names of [
      [EXTERNALS_MANIFEST, LOCK_FILE],
      ["bun.lock", EXTERNALS_MANIFEST, EXTERNALS_LOCK],
      ["../x/package.json", "../x/package-lock.json"],
    ])
      expect(() => hashCohort(hashes(names))).toThrow();
  });
});

describe("subdirectory leaf draft", () => {
  const config = {
    ...CONFIG,
    github: {
      ...CONFIG.github,
      labels: { build: { ready: "queue:ready", claimed: "queue:active" } },
    },
    deploy: { branches: { production: "main" } },
  };
  const evidence = {
    history: {
      command: `git log ${PARENT} --max-count=20 -- ${historyPaths({ directory: EXTERNALS }).join(" ")}`,
      result: "none",
    },
    search: { query: "repo:fixture/host npm is:issue in:title,body", total: 0 },
    registry: [{ name: "is-number", version: "7.0.0" }],
    labels: [],
    main: PARENT,
  };

  it("names the directory in the title and its own files and hashes in the body", () => {
    const proposal = subProposal();
    const draft = buildDraft(proposal, SUB, config, evidence);
    expect(draft.title).toBe("Update selected npm dependencies in externals");
    expect(draft.body).toContain(
      "Update exactly externals/package.json and externals/package-lock.json:"
    );
    expect(draft.body).toContain(
      `externals/package.json SHA256: ${proposal.hashes[EXTERNALS_MANIFEST]}`
    );
    expect(draft.body).toContain(
      `externals/package-lock.json SHA256: ${proposal.hashes[EXTERNALS_LOCK]}`
    );
    expect(draft.body).toContain(
      "-- externals/package.json externals/package-lock.json"
    );
    expect(draft.body).not.toContain("bun.lock");
  });
});

/**
 * Commit a root project with its own Bun lock beside an externals npm project.
 * @param root - Positively owned fixture root.
 * @param env - Sanitized fixture environment.
 * @param externals - Extra committed externals files.
 * @returns The committed checkout.
 */
async function committed(
  root: string,
  env: NodeJS.ProcessEnv,
  externals: Record<string, string> = {
    [MANIFEST_FILE]: JSON.stringify(BEFORE),
    [LOCK_FILE]: "{}\n",
  }
) {
  const cwd = join(root, "host");
  mkdirSync(join(cwd, EXTERNALS), { recursive: true, mode: 0o700 });
  writeFileSync(join(cwd, MANIFEST_FILE), JSON.stringify(BEFORE));
  writeFileSync(join(cwd, LOCK_FILE), "{}\n");
  writeFileSync(join(cwd, "bun.lock"), ORIGINAL_BUN);
  for (const [file, bytes] of Object.entries(externals))
    writeFileSync(join(cwd, EXTERNALS, file), bytes);
  const git = (args: string[]) => runProcess("git", args, { cwd, env });
  await git(["init"]);
  await git(["add", "."]);
  await git([
    "-c",
    GIT_NAME,
    "-c",
    GIT_EMAIL,
    "commit",
    "-m",
    "Root and externals npm projects",
  ]);
  return cwd;
}

describe("committed subdirectory baseline", () => {
  it("reads the externals files by name and ignores the root Bun lock", async () => {
    await withPrivateRoot(async (root, env) => {
      const cwd = await committed(root, env);
      const original = await baseline(cwd, env, undefined, EXTERNALS);
      expect(
        Object.keys(original.files).sort((a, b) => a.localeCompare(b))
      ).toEqual([LOCK_FILE, MANIFEST_FILE]);
      const files: Record<string, string> = original.files;
      expect(JSON.parse(files[MANIFEST_FILE]!)).toEqual(BEFORE);
      const proposal = subProposal(original.parent);
      await expect(baseline(cwd, env, proposal)).resolves.toEqual(original);
    });
  });

  it.each([
    ["a missing externals lock", { [MANIFEST_FILE]: JSON.stringify(BEFORE) }],
    [
      "a committed externals Bun lock",
      {
        [MANIFEST_FILE]: JSON.stringify(BEFORE),
        [LOCK_FILE]: "{}\n",
        "bun.lock": ORIGINAL_BUN,
      },
    ],
  ])("refuses %s", async (_name, externals) => {
    await withPrivateRoot(async (root, env) => {
      const cwd = await committed(root, env, externals);
      await expect(baseline(cwd, env, undefined, EXTERNALS)).rejects.toThrow();
    });
  });

  it("refuses an untracked externals Bun lock or a dangling alias for one", async () => {
    await withPrivateRoot(async (root, env) => {
      const cwd = await committed(root, env);
      const lock = join(cwd, EXTERNALS, "bun.lock");
      writeFileSync(lock, ORIGINAL_BUN);
      await expect(baseline(cwd, env, undefined, EXTERNALS)).rejects.toThrow(
        /unexpected Bun lock path/
      );
      unlinkSync(lock);
      symlinkSync(join(root, "absent.lock"), lock);
      await expect(baseline(cwd, env, undefined, EXTERNALS)).rejects.toThrow(
        /unexpected Bun lock alias/
      );
    });
  });

  it("refuses a working-tree alias standing in for the committed directory", async () => {
    await withPrivateRoot(async (root, env) => {
      const cwd = await committed(root, env);
      renameSync(join(cwd, EXTERNALS), join(root, "foreign"));
      symlinkSync(join(root, "foreign"), join(cwd, EXTERNALS));
      await expect(baseline(cwd, env, undefined, EXTERNALS)).rejects.toThrow(
        /committed real npm project directory required/
      );
    });
  });
});

/**
 * Run the genuine hook-side local descriptor check in a fresh process at the staged root.
 * @param cwd - Staged checkout.
 * @param env - Sanitized fixture environment.
 * @param preview - The gate's descriptor preview.
 * @returns The native process result.
 */
function stagedReadback(
  cwd: string,
  env: NodeJS.ProcessEnv,
  preview: { descriptor: object; message: string }
) {
  const bot = "github-actions[bot]";
  const mail = "41898282+github-actions[bot]@users.noreply.github.com";
  const module = new URL(
    "../../../all/copy-overwrite/scripts/lib/automation-provenance-local.mjs",
    import.meta.url
  ).href;
  return runProcess(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      'import fs from "node:fs"; const {localDescriptor}=await import(process.argv[1]); const v=JSON.parse(fs.readFileSync(0,"utf8")); localDescriptor(v.descriptor,Buffer.from(v.message),{runId:"1",runAttempt:"1"},v.policy); console.log("accepted");',
      module,
    ],
    {
      cwd,
      env: {
        ...env,
        GIT_AUTHOR_NAME: bot,
        GIT_AUTHOR_EMAIL: mail,
        GIT_AUTHOR_DATE: "1700000000 +0000",
        GIT_COMMITTER_NAME: bot,
        GIT_COMMITTER_EMAIL: mail,
        GIT_COMMITTER_DATE: "1700000000 +0000",
      },
      input: JSON.stringify({ ...preview, policy: AUTOMATION }),
      allowed: [0, 1],
    }
  );
}

describe("subdirectory engine-strict policy", () => {
  /**
   * Commit externals/.npmrc with engine-strict=true and none at the root.
   * @param root - Positively owned fixture root.
   * @param env - Sanitized fixture environment.
   * @returns Checkout, isolated npm source environment and git runner.
   */
  async function strictHost(root: string, env: NodeJS.ProcessEnv) {
    const cwd = await committed(root, env, {
      [MANIFEST_FILE]: JSON.stringify(BEFORE),
      [LOCK_FILE]: "{}\n",
      ".npmrc": "engine-strict=true\n",
    });
    const home = join(root, "home");
    mkdirSync(home, { mode: 0o700 });
    // An empty HOME keeps the operator's own ~/.npmrc out of the measurement.
    const source = { PATH: process.env.PATH, HOME: home };
    return { cwd, source };
  }

  it("reads engine-strict from the selected directory, not the root", async () => {
    await withPrivateRoot(async (root, env) => {
      const { cwd, source } = await strictHost(root, env);
      expect(await effectiveEngineStrict(join(cwd, EXTERNALS), source)).toBe(
        true
      );
      expect(await effectiveEngineStrict(cwd, source)).toBe(false);
    });
  });

  it.each([
    ["modified", "engine-strict=false\n", /differs from HEAD/],
    ["uncommitted", undefined, /not committed/],
  ])("refuses a %s externals .npmrc", async (_name, bytes, reason) => {
    await withPrivateRoot(async (root, env) => {
      const { cwd, source } = await strictHost(root, env);
      const npmrc = join(cwd, EXTERNALS, ".npmrc");
      if (bytes === undefined) {
        // Remove it from the index and HEAD while keeping the working file.
        const git = (args: string[]) => runProcess("git", args, { cwd, env });
        await git(["rm", "--cached", "--", `${EXTERNALS}/.npmrc`]);
        await git([
          "-c",
          GIT_NAME,
          "-c",
          GIT_EMAIL,
          "commit",
          "-m",
          "Untrack externals npmrc",
        ]);
      } else writeFileSync(npmrc, bytes);
      await expect(
        effectiveEngineStrict(join(cwd, EXTERNALS), source)
      ).rejects.toThrow(reason);
    });
  });
});

describe("hook-side subdirectory staged cohort", () => {
  it("verifies the staged externals commit and refuses a foreign root file", async () => {
    await withPrivateRoot(async (root, env) => {
      const cwd = await committed(root, env);
      const git = (args: string[]) => runProcess("git", args, { cwd, env });
      const parent = (await git(["rev-parse", "HEAD"])).stdout
        .toString()
        .trim();
      const proposal = subProposal(parent);
      const preview = await descriptorFor({
        cwd,
        proposal,
        policy: SUB,
        automation: AUTOMATION,
        allocation: ALLOCATION,
        runId: "1",
        runAttempt: "1",
        epoch: 1_700_000_000,
      });
      expect(preview.descriptor.directory).toBe(EXTERNALS);
      expect(
        Object.keys(preview.descriptor.files).sort((a, b) => a.localeCompare(b))
      ).toEqual([EXTERNALS_LOCK, EXTERNALS_MANIFEST]);
      for (const [file, bytes] of Object.entries(proposal.files))
        writeFileSync(join(cwd, file), bytes as string);
      await git(["add", "--", ...proposalFileNames(proposal)]);
      const valid = await stagedReadback(cwd, env, preview);
      expect(valid.code, valid.stderr.toString()).toBe(0);
      const show = (args: string[]) =>
        execFileSync("git", args, { cwd, env }).toString();
      expect(() => npmProposal(preview.descriptor, show)).not.toThrow();
      const checkpoint = {
        digest: sha256(`${canonicalJson(preview.descriptor)}\n`),
        payload: { preview },
      };
      expect(
        originalDescriptor(checkpoint, proposal, ALLOCATION, AUTOMATION)
      ).toEqual(preview.descriptor);
      // Recovery refuses a descriptor whose signed directory was stripped or
      // changed, even when its checkpoint digest is recomputed to match.
      const { directory: _signed, ...stripped } = preview.descriptor;
      for (const [descriptor, reason] of [
        [stripped, /unknown or missing fields/],
        [{ ...preview.descriptor, directory: "other" }, /descriptor differs/],
      ] as const) {
        const forged = {
          digest: sha256(`${canonicalJson(descriptor)}\n`),
          payload: { preview: { ...preview, descriptor } },
        };
        expect(() =>
          originalDescriptor(forged, proposal, ALLOCATION, AUTOMATION)
        ).toThrow(reason);
      }
      // Stage a foreign root file and re-point the descriptor's tree at the
      // new staged tree, so only the foreign-path check can refuse it.
      writeFileSync(join(cwd, MANIFEST_FILE), JSON.stringify(AFTER));
      await git(["add", "--", MANIFEST_FILE]);
      const tree = (await git(["write-tree"])).stdout.toString().trim();
      const foreign = await stagedReadback(cwd, env, {
        ...preview,
        descriptor: { ...preview.descriptor, tree },
      });
      expect(foreign.code).toBe(1);
      expect(foreign.stderr.toString()).toContain(
        "proposal changes foreign files"
      );
    });
  });
});

describe("CLI directory selection", () => {
  it("refuses a LISA_NPM_DIRECTORY that names no committed entry", async () => {
    await withPrivateRoot(async (root, env) => {
      const cwd = await committed(root, env);
      writeFileSync(
        join(cwd, ".lisa.config.json"),
        JSON.stringify({
          ...CONFIG,
          automationProvenance: { enabled: true, repository: ROOT.repository },
          npmUpdater: [ROOT, SUB],
        })
      );
      const git = (args: string[]) => runProcess("git", args, { cwd, env });
      await git(["add", ".lisa.config.json"]);
      await git([
        "-c",
        GIT_NAME,
        "-c",
        GIT_EMAIL,
        "commit",
        "-m",
        "Committed directory list",
      ]);
      const previous = process.env.LISA_NPM_DIRECTORY;
      process.env.LISA_NPM_DIRECTORY = "missing";
      try {
        await expect(
          main(["prepare", cwd, join(root, "phase")])
        ).rejects.toThrow(NOT_SELECTED);
      } finally {
        if (previous === undefined) delete process.env.LISA_NPM_DIRECTORY;
        else process.env.LISA_NPM_DIRECTORY = previous;
      }
    });
  });
});

describe("reusable workflow directory selection", () => {
  const workflow = parse(
    readFileSync(".github/workflows/npm-updater.yml", "utf8")
  );
  const jobs = workflow.jobs as Record<
    string,
    { steps: { name?: string; run?: string; with?: { name?: string } }[] }
  >;
  const phaseStep = jobs.prepare!.steps[0]!;

  /**
   * Run the genuine phase-path step script under bash with one directory input.
   * @param directory - The workflow's directory input.
   * @returns Exit code and the variables it exported to GITHUB_ENV.
   */
  function phase(directory: string) {
    return withPrivateRoot(async root => {
      const githubEnv = join(root, "github-env");
      writeFileSync(githubEnv, "");
      const result = await runProcess("bash", ["-e", "-c", phaseStep.run!], {
        env: {
          PATH: process.env.PATH,
          LISA_NPM_DIRECTORY: directory,
          RUNNER_TEMP: root,
          GITHUB_ENV: githubEnv,
        },
        allowed: [0, 1],
      });
      return {
        code: result.code,
        exported: readFileSync(githubEnv, "utf8"),
        root,
      };
    });
  }

  it("declares a defaulted directory input, workflow env and per-directory concurrency", () => {
    expect(workflow.on.workflow_call.inputs.directory).toMatchObject({
      type: "string",
      default: ".",
      required: false,
    });
    expect(workflow.env.LISA_NPM_DIRECTORY).toBe("${{ inputs.directory }}");
    // The root keeps its historical group; only a subdirectory appends -<dir>.
    expect(workflow.concurrency.group).toBe(
      "lisa-npm-${{ github.repository }}${{ inputs.directory != '.' && format('-{0}', inputs.directory) || '' }}"
    );
  });

  it("names every phase artifact with the validated directory suffix", () => {
    const names = Object.values(jobs)
      .flatMap(job => job.steps ?? [])
      .map(step => step.with?.name)
      .filter((name): name is string => name?.startsWith("npm-") ?? false);
    expect(names).toHaveLength(6);
    for (const name of names)
      expect(name).toMatch(
        /^npm-(prepared|authorized|gated)-\$\{\{ env\.NPM_ARTIFACT_SUFFIX \}\}$/
      );
    for (const job of ["prepare", "allocate", "gate", "publish"])
      expect(jobs[job]!.steps[0]!.run).toBe(phaseStep.run);
  });

  it.each([
    [".", "root"],
    [EXTERNALS, "dir-externals"],
    ["services/lambda", "dir-services+lambda"],
    // Formerly colliding pair: "/" now maps to "+", which the grammar forbids.
    ["a/b", "dir-a+b"],
    ["a__b", "dir-a__b"],
    ["a_/b", "dir-a_+b"],
    ["a/_b", "dir-a+_b"],
  ])("exports the artifact suffix for %s", async (directory, suffix) => {
    const result = await phase(directory);
    expect(result.code).toBe(0);
    expect(result.exported).toBe(
      `PHASE=${result.root}/lisa-npm-phase\nNPM_ARTIFACT_SUFFIX=${suffix}\n`
    );
  });

  /** One table judged by both the CLI grammar and the bash step, which must agree. */
  it.each([
    [".", true],
    [EXTERNALS, true],
    ["a__b", true],
    [Array.from({ length: 8 }, () => "a").join("/"), true],
    ["x".repeat(64), true],
    ["", false],
    ["../x", false],
    ["./x", false],
    ["x/", false],
    ["/x", false],
    ["a//b", false],
    [".hidden", false],
    ["node_modules", false],
    ["a/node_modules", false],
    ["a b", false],
    ["a+b", false],
    [Array.from({ length: 9 }, () => "a").join("/"), false],
    ["x".repeat(65), false],
    [`${`${"a".repeat(60)}/`.repeat(4)}a`, false],
    // A newline must not smuggle an extra GITHUB_ENV assignment.
    ["a\nB=1", false],
  ])(
    "judges %j identically in the CLI and the workflow",
    async (directory, valid) => {
      expect(validDirectory(directory)).toBe(valid);
      const result = await phase(directory);
      expect(result.code).toBe(valid ? 0 : 1);
      if (!valid) expect(result.exported).toBe("");
    }
  );

  it("never maps two accepted directories to one artifact suffix", async () => {
    const directories = [".", "root", "a/b", "a+b", "a__b", "a_/b", "a/_b"];
    const suffixes = new Map<string, string>();
    for (const directory of directories.filter(validDirectory)) {
      const { exported } = await phase(directory);
      const suffix = /NPM_ARTIFACT_SUFFIX=(.*)\n/.exec(exported)![1]!;
      expect(suffixes.get(suffix), suffix).toBeUndefined();
      suffixes.set(suffix, directory);
    }
    expect(suffixes.size).toBe(6);
  });
});
