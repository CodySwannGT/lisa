// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/**
 * @file npm-update-prepare.mjs
 * @description Real script-free npm installations distinguish current packages from missing trees.
 * @module npm-updater
 */
import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import {
  FILES,
  SECTIONS,
  required,
  validatePolicy,
  validateHost,
  validateLock,
  proposalFrom,
  proposalFileNames,
} from "./npm-update-contract.mjs";
import {
  runProcess,
  runNpm,
  withPrivateRoot,
  effectiveEngineStrict,
} from "./npm-update-process.mjs";
import { canonicalJson } from "../lisa-automation-provenance.mjs";
import { qualifyLisaOwner } from "./npm-update-owner.mjs";
export { qualifyLisaOwner } from "./npm-update-owner.mjs";
import { sha256 } from "./github-attestation-verifier.mjs";
import { committedBun, qualifiedBun, frozenBun } from "./npm-update-bun.mjs";

const NPM_FLAGS = ["--ignore-scripts", "--no-audit", "--no-fund"];

/** Actual installed versions, not only lock entries, reach npm's outdated boundary. */
function installedVersions(directory, selections) {
  return Object.fromEntries(
    selections.map(({ name }) => [
      name,
      JSON.parse(
        readFileSync(
          join(directory, "node_modules", name, "package.json"),
          "utf8"
        )
      ).version,
    ])
  );
}

/** Re-read the committed source; an unstaged manifest cannot become the baseline. */
export async function baseline(cwd, env, proposal) {
  const command = args =>
    runProcess("git", args, { cwd, env, maximum: 1_048_576 });
  const parent = (await command(["rev-parse", "HEAD"])).stdout
    .toString()
    .trim();
  const files = {};
  for (const file of FILES) {
    const entry = (
      await command(["ls-tree", "HEAD", "--", file])
    ).stdout.toString();
    required(
      entry.startsWith("100644 blob ") && entry.trim().split("\n").length === 1,
      "regular committed npm files required"
    );
    files[file] = (await command(["show", `HEAD:${file}`])).stdout.toString(
      "utf8"
    );
  }
  const bun = await committedBun(cwd, command, proposal);
  if (bun !== undefined) files["bun.lock"] = bun;
  if (proposal)
    required(
      parent === proposal.parent &&
        canonicalJson(JSON.parse(files["package.json"])) ===
          canonicalJson(proposal.before),
      "committed proposal baseline differs"
    );
  return { parent, files };
}

/** Installed evidence and genuine selected registry metadata define the update set. */
async function findUpdates(
  before,
  policy,
  installedBefore,
  detected,
  outdated,
  npm
) {
  const updates = [];
  for (const selection of policy.packages) {
    const sections = SECTIONS.filter(
      section => before[section]?.[selection.name]
    );
    required(
      sections.length === 1,
      "selected package must be one unambiguous direct dependency"
    );
    if (installedBefore[selection.name] === selection.version) continue;
    required(
      outdated.code === 1 &&
        detected[selection.name]?.current === installedBefore[selection.name],
      "outdated did not reach installed selected package"
    );
    const metadata = await npm([
      "view",
      `${selection.name}@${selection.version}`,
      "--json",
    ]);
    const registry = JSON.parse(metadata.stdout.toString());
    required(
      registry.name === selection.name &&
        registry.version === selection.version &&
        registry.dist?.integrity,
      "selected registry metadata differs"
    );
    updates.push({
      name: selection.name,
      section: sections[0],
      from: before[sections[0]][selection.name],
      to: selection.version,
    });
  }
  return updates;
}

/** npm writes only the explicitly selected ordinary dependency sections. */
async function installUpdates(updates, npm, npmFlags) {
  for (const update of updates) {
    const sectionFlag = {
      dependencies: "--save-prod",
      devDependencies: "--save-dev",
      optionalDependencies: "--save-optional",
    }[update.section];
    await npm([
      "install",
      `${update.name}@${update.to}`,
      "--save-exact",
      "--package-lock-only",
      sectionFlag,
      ...npmFlags,
    ]);
  }
}

/** Preserve the exact original lock cohort in a private HOME without repository scripts. */
async function preparedProposal({
  app,
  npm,
  policy,
  original,
  before,
  updates,
  npmFlags,
  version,
  outdated,
  installedBefore,
  bun,
}) {
  await installUpdates(updates, npm, npmFlags);
  const names = Object.keys(original.files).sort();
  if (bun)
    await bun(
      [
        "install",
        "--lockfile-only",
        "--ignore-scripts",
        "--registry",
        "https://registry.npmjs.org/",
      ],
      { cwd: app }
    );
  const files = Object.fromEntries(
    names.map(file => [file, readFileSync(join(app, file), "utf8")])
  );
  const proposal = proposalFrom(
    policy,
    original.parent,
    before,
    files,
    updates,
    bun ? sha256(original.files["bun.lock"]) : undefined
  );
  const hashes = Object.fromEntries(
    proposalFileNames(proposal).map(file => [
      file,
      sha256(readFileSync(join(app, file))),
    ])
  );
  await npm(["ci", ...npmFlags]);
  if (bun) await frozenBun(bun, app, names);
  required(
    names.every(file => hashes[file] === sha256(readFileSync(join(app, file)))),
    "npm ci rewrote manifest or lock"
  );
  required(
    readdirSync(app).sort().join("\n") ===
      ["node_modules", ...names].sort().join("\n"),
    "unexpected npm output path or lifecycle effect"
  );
  return {
    status: "prepared",
    proposal,
    npm: {
      version,
      outdatedExit: outdated.code,
      installedBefore,
      installedAfter: installedVersions(app, policy.packages),
      ciPreserved: true,
    },
  };
}

/** The private resource lifecycle remains outside the prepared proposal's npm checks. */
export async function prepareUpdate({ cwd, policy: input, config }) {
  const engineStrict = await effectiveEngineStrict(cwd);
  const npmFlags = [...NPM_FLAGS, ...(engineStrict ? ["--engine-strict"] : [])];
  const policy = validatePolicy(input, config);
  let privatePath;
  const result = await withPrivateRoot(async (root, env) => {
    privatePath = root;
    const app = join(root, "app");
    mkdirSync(app, { mode: 0o700 });
    required(process.versions.node === "22.23.3", "Node22.23.3 is required");
    const version = (await runNpm(["--version"], { env })).stdout
      .toString()
      .trim();
    required(
      ["10.9.9", "11.21.0"].includes(version),
      "supported npm10.9.9 or11.21.0 is required"
    );
    const original = await baseline(cwd, env);
    const before = JSON.parse(original.files["package.json"]);
    validateHost(before);
    required(
      !before.workspaces &&
        (!before.packageManager || before.packageManager === `npm@${version}`),
      "unsupported workspace or npm declaration"
    );
    await qualifyLisaOwner(cwd, before, policy, config, engineStrict);
    validateLock(JSON.parse(original.files["package-lock.json"]), before, []);
    for (const file of Object.keys(original.files))
      writeFileSync(join(app, file), original.files[file], { mode: 0o600 });
    const bun =
      original.files["bun.lock"] === undefined
        ? undefined
        : await qualifiedBun(env);
    const npm = (args, allowed = [0]) =>
      runNpm(args, { cwd: app, env, timeout: 120_000, allowed });
    await npm(["ci", ...npmFlags]);
    if (bun) await frozenBun(bun, app, Object.keys(original.files));
    const installedBefore = installedVersions(app, policy.packages);
    const outdated = await npm(["outdated", "--json", "--long"], [0, 1]);
    const detected = JSON.parse(outdated.stdout.toString() || "{}");
    const updates = await findUpdates(
      before,
      policy,
      installedBefore,
      detected,
      outdated,
      npm
    );
    if (updates.length === 0)
      return {
        status: "no-selected-update",
        npm: { version, outdatedExit: outdated.code, installedBefore },
      };
    return preparedProposal({
      app,
      npm,
      policy,
      original,
      before,
      updates,
      npmFlags,
      version,
      outdated,
      installedBefore,
      bun,
    });
  });
  required(!existsSync(privatePath), "private npm resources remain");
  return { ...result, cleanup: { absent: true } };
}
