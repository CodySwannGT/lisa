// This file is managed by Lisa. Durable changes belong upstream.
/** Independent Git or registry archive authority qualifies canonical helpers before import. */
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { dirname, join, parse } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { existsSync, lstatSync, realpathSync } from "node:fs";
import { required, VERSION, OBJECT } from "./npm-update-contract.mjs";
import {
  readBytes,
  runProcess,
  withPrivateRoot,
} from "./npm-update-process-core.mjs";
import { runNpm, archiveIntegrity } from "./npm-update-npm.mjs";
import {
  managedTemplateMembers,
  helperManifest,
  controllerMembers,
  managedControllerSelection,
  auditControllerClosure,
  assertManagedSelection,
} from "./npm-update-helper-graph.mjs";

const PACKAGE = "@codyswann/lisa";
const MEMBERS = [
  "plugins/lisa/scripts/intake-blocker-reprobe.mjs",
  "plugins/lisa/scripts/intake-prework-denominator.mjs",
];
const OWNER_MEMBERS = [
  "plugins/lisa/hooks/auto-update.mjs",
  "plugins/lisa/hooks/auto-update.sh",
  "plugins/lisa/.codex-plugin/hooks.json",
];

/** Ascend from the actual executing or resolved entry; never identify the host's manifest as Lisa. */
function packageOwner(entry) {
  let directory = dirname(realpathSync(entry));
  const root = parse(directory).root;
  while (directory !== root) {
    const manifest = join(directory, "package.json");
    if (existsSync(manifest)) {
      const metadata = JSON.parse(readBytes(manifest, 1_048_576, false));
      if (metadata.name === PACKAGE) return { root: directory, metadata };
    }
    directory = dirname(directory);
  }
  return undefined;
}

/** Native package resolution supports both upstream and actual emitted managed layouts. */
export function helperOwner() {
  const local = packageOwner(fileURLToPath(import.meta.url));
  if (local) return { ...local, source: existsSync(join(local.root, ".git")) };
  let entry;
  try {
    entry = createRequire(import.meta.url).resolve(PACKAGE);
  } catch {
    throw new Error(
      "npm updater: qualified installed Lisa helper is unavailable"
    );
  }
  const installed = packageOwner(entry);
  required(installed, "resolved helper has no canonical Lisa package owner");
  return { ...installed, source: false };
}

/** The fixed canonical import graph must stay inside its independently qualified package. */
function helperBytes(root, members) {
  return members.map(relative => {
    const file = join(root, relative);
    required(
      realpathSync(file) === file &&
        lstatSync(file).isFile() &&
        !lstatSync(file).isSymbolicLink(),
      "canonical helper is aliased or absent"
    );
    return readBytes(file, 1_048_576, false);
  });
}

/** The unchanged classifier has precisely one qualified canonical dependency. */
function canonicalGraph(bytes) {
  const text = bytes.map(value =>
    new TextDecoder("utf8", { fatal: true }).decode(value)
  );
  const imports =
    text[0].match(
      /^\s*(?:import|export)\s+.*\bfrom\s+["'][^"']+["'];?\s*$/gm
    ) ?? [];
  required(
    imports.length === 1 &&
      imports[0].trim() ===
        'import { isPreWorkLaneType } from "./intake-prework-denominator.mjs";' &&
      !/\bimport\s*\(/.test(text[0]) &&
      !/^\s*(?:import|export)\s+.*\bfrom\b/m.test(text[1]) &&
      !/\bimport\s*\(/.test(text[1]),
    "canonical helper import graph differs"
  );
}

/** Current committed Git identity supplies source-local authority; production pins the approved signer. */
async function sourceAuthority(owner, config, bytes, members) {
  const env = {
    PATH: process.env.PATH,
    HOME: "/nonexistent",
    GIT_TERMINAL_PROMPT: "0",
  };
  const git = args =>
    runProcess("git", args, { cwd: owner.root, env, maximum: 1_048_576 });
  const head = (await git(["rev-parse", "HEAD"])).stdout.toString().trim();
  const expected = config.automationProvenance?.signerDigest ?? head;
  required(
    typeof expected === "string" && OBJECT.test(expected),
    "approved helper Git identity is unavailable"
  );
  const trusted = [];
  for (let index = 0; index < members.length; index++) {
    let blob;
    try {
      blob = (await git(["show", `${expected}:${members[index]}`])).stdout;
    } catch (cause) {
      throw new Error(
        `npm updater: approved helper Git member unavailable: ${members[index]}`,
        { cause }
      );
    }
    if (bytes)
      required(
        blob.equals(bytes[index]),
        "canonical helper differs from approved Git blob"
      );
    trusted.push(blob);
  }
  return trusted;
}

/** Official release identity and integrity authenticate both fixed members without extracting files. */
async function releaseAuthority(owner, config, bytes, members) {
  const digest = config.automationProvenance?.signerDigest;
  required(
    typeof digest === "string" &&
      OBJECT.test(digest) &&
      VERSION.test(owner.metadata.version),
    "approved release identity is unavailable"
  );
  await withPrivateRoot(async (root, env) => {
    const registry = JSON.parse(
      (
        await runNpm(
          ["view", `${PACKAGE}@${owner.metadata.version}`, "--json"],
          { env, maximum: 1_048_576 }
        )
      ).stdout
    );
    required(
      registry.name === PACKAGE &&
        registry.version === owner.metadata.version &&
        registry.gitHead === digest &&
        typeof registry.dist?.integrity === "string",
      "registry helper identity differs from approved source"
    );
    const packed = JSON.parse(
      (
        await runNpm(
          [
            "pack",
            `${PACKAGE}@${owner.metadata.version}`,
            "--ignore-scripts",
            "--json",
            "--pack-destination",
            root,
          ],
          { cwd: root, env, timeout: 120_000, maximum: 1_048_576 }
        )
      ).stdout
    );
    const filename = `codyswann-lisa-${owner.metadata.version}.tgz`;
    required(
      Array.isArray(packed) &&
        packed.length === 1 &&
        packed[0].filename === filename,
      "registry archive selection differs"
    );
    const archive = join(root, filename);
    required(
      archiveIntegrity(archive) === registry.dist.integrity,
      "actual helper archive registry integrity differs"
    );
    for (let index = 0; index < members.length; index++) {
      const member = `package/${members[index]}`;
      const listing = await runProcess("tar", ["-tzf", archive, "--", member], {
        env,
        maximum: 65_536,
      });
      required(
        listing.stdout.toString() === `${member}\n`,
        "canonical archive member is missing or ambiguous"
      );
      const result = await runProcess("tar", ["-xOf", archive, "--", member], {
        env,
        maximum: 1_048_576,
      });
      required(
        result.stdout.equals(bytes[index]),
        "installed canonical helper differs from authenticated archive"
      );
    }
  });
}

/** Only fixed canonical lifecycle files can be selected by trusted callers. */
export async function qualifiedHelperFiles(config, members) {
  required(
    Array.isArray(members) &&
      members.length > 0 &&
      members.length <= 5 &&
      new Set(members).size === members.length &&
      members.every(member => [...MEMBERS, ...OWNER_MEMBERS].includes(member)),
    "unsupported canonical helper selection"
  );
  const owner = helperOwner();
  const bytes = helperBytes(owner.root, members);
  if (owner.source) await sourceAuthority(owner, config, bytes, members);
  else await releaseAuthority(owner, config, bytes, members);
  return {
    ...owner,
    bytes: new Map(members.map((member, index) => [member, bytes[index]])),
  };
}

/** Emitted hook bytes gain authority only from exact independently authenticated templates. */
export async function qualifiedManagedFiles(cwd, config, members) {
  const inventory = managedTemplateMembers();
  required(
    Array.isArray(members) &&
      members.length > 0 &&
      members.length <= inventory.size &&
      new Set(members).size === members.length &&
      members.every(member => inventory.has(member)),
    "unsupported managed helper selection"
  );
  required(
    OBJECT.test(config.automationProvenance?.signerDigest ?? ""),
    "immutable managed helper authority is missing"
  );
  required(
    typeof cwd === "string" && cwd.startsWith("/") && realpathSync(cwd) === cwd,
    "managed workspace is aliased or unavailable"
  );
  const owner = helperOwner();
  const templates = members.map(member => inventory.get(member));
  const bytes = owner.source
    ? await sourceAuthority(owner, config, null, templates)
    : helperBytes(owner.root, templates);
  if (!owner.source) await releaseAuthority(owner, config, bytes, templates);
  const graph = {};
  for (let index = 0; index < members.length; index++) {
    const file = join(cwd, "scripts", members[index]);
    required(
      realpathSync(file) === file &&
        !lstatSync(file).isSymbolicLink() &&
        readBytes(file, 1_048_576, false).equals(bytes[index]),
      "managed consumer helper differs from authenticated template"
    );
    graph[file] = createHash("sha256").update(bytes[index]).digest("hex");
  }
  return graph;
}

/** Authenticate one owner's control, manifest and complete byte graph before selecting controller entries. */
export async function qualifiedControllerGraph(cwd, config, entries) {
  assertManagedSelection(entries);
  const controls = [
    "lib/npm-update-helper-graph.mjs",
    "npm-updater-helper-graph.json",
  ];
  const checked = await qualifiedManagedFiles(cwd, config, controls);
  const manifest = helperManifest(
    readBytes(join(cwd, "scripts", controls[1]), 262_144, false)
  );
  const members = controllerMembers(manifest);
  const managed = members.filter(member => !member.startsWith("package/"));
  Object.assign(checked, await qualifiedManagedFiles(cwd, config, managed));
  const owner = await qualifiedHelperFiles(config, MEMBERS);
  const authenticated = new Map();
  const paths = new Map();
  for (const member of members) {
    const packaged = member.startsWith("package/");
    const relative = packaged ? member.slice("package/".length) : member;
    const file = join(packaged ? owner.root : join(cwd, "scripts"), relative);
    const bytes = readBytes(file, 1_048_576, false);
    required(
      packaged
        ? bytes.equals(owner.bytes.get(relative))
        : createHash("sha256").update(bytes).digest("hex") === checked[file],
      "authenticated controller helper changed during selection"
    );
    authenticated.set(member, bytes);
    paths.set(member, file);
  }
  // Audit every authenticated member, then select the actual complete entry closure.
  auditControllerClosure(manifest, authenticated);
  const selected = managedControllerSelection(manifest, authenticated, entries);
  return Object.fromEntries(
    [...selected].map(member => [
      paths.get(member),
      createHash("sha256").update(authenticated.get(member)).digest("hex"),
    ])
  );
}

/** No canonical package code is imported until independent authority qualifies its fixed graph. */
export async function canonicalClassifier(config) {
  const owner = await qualifiedHelperFiles(config, MEMBERS);
  canonicalGraph(MEMBERS.map(member => owner.bytes.get(member)));
  const module = await import(pathToFileURL(join(owner.root, MEMBERS[0])).href);
  required(
    typeof module.humanGateVerdict === "function",
    "canonical hold classifier is unavailable"
  );
  return module.humanGateVerdict;
}
