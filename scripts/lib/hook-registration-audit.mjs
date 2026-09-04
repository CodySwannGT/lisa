/**
 * Audit that every shipped hook script is actually registered to run.
 *
 * The defect this exists for is one level up from an inert guard: not a guard
 * whose logic fails to bite, but a guard that is never invoked at all. A
 * mangled guard fails loudly; an unregistered one is silent by construction,
 * because nothing in the tree was looking at the question (CodySwannGT/lisa#3809).
 *
 * `check-plugins-sync.sh` already proves the generated ports reproduce from
 * their generators. It cannot prove what this proves: regeneration reproduces a
 * MISSING entry just as faithfully as a present one, so a generator whose own
 * hook table is short, or a manifest array that lost a member in a list-append
 * merge resolution, regenerates clean and passes every gate.
 *
 * Three kinds of file live in a `hooks/` directory and only one of them is
 * required to be registered, so the classification is the load-bearing part.
 * It is done by properties of the file, never by a hand-maintained list of
 * exceptions — an exception list added to harden a guard becomes the bypass:
 *
 *   - ENTRY POINT  — a `.sh` that is not an adapter. Must be registered.
 *   - ADAPTER      — `*.agy.sh`. Registered on the Antigravity surface ONLY,
 *                    and deliberately absent from every other manifest.
 *   - SUPPORT      — anything that is not `.sh` (`.mjs`, `.py`). Exempt from
 *                    registration, but the exemption is not free: it must be
 *                    referenced by a sibling in the same directory, so a dead
 *                    support file cannot hide behind its extension.
 *
 * An entry point may be reached by any of three declared channels, all read
 * from the artifact that does the reaching rather than restated here:
 *
 *   1. a plugin manifest (`plugin.json` / `hooks.json` under a port root),
 *   2. the host enforcement dispatcher's guard loop
 *      (`all/copy-overwrite/scripts/lisa-enforcement-fallback.sh`),
 *   3. a shipped skill or command that tells the agent to run it.
 *
 * A script reached by none of them must be declared unshipped for EVERY agent
 * in the repository's own per-agent ship list. That declaration is not an
 * escape hatch: it is checked in both directions, so declaring a script
 * unshipped for an agent while that agent's manifest still registers it is
 * itself a violation. The default for an undeclared script is "ships", which
 * is what makes a newly added hook fail closed.
 *
 * @module scripts/lib/hook-registration-audit
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { invokedAsScript } from "./invoked-as-script.mjs";
import { shouldShipScript } from "./per-agent-hook-filter.mjs";

/** Agents the per-agent ship list can speak about. */
const SHIP_LIST_AGENTS = Object.freeze([
  "claude",
  "codex",
  "cursor",
  "agy",
  "copilot",
]);

/** Filenames a coding agent reads hook registrations out of. */
const MANIFEST_FILENAMES = Object.freeze(["plugin.json", "hooks.json"]);

/** Suffix that marks an Antigravity protocol adapter. */
const ADAPTER_SUFFIX = ".agy.sh";

/** Directory-name suffix of an Antigravity port. */
const AGY_PORT_SUFFIX = "-agy";

/** Host dispatcher whose guard loop is the second registration channel. */
const DISPATCHER_PATH = path.join(
  "all",
  "copy-overwrite",
  "scripts",
  "lisa-enforcement-fallback.sh"
);

/** Repository root, derived from this file's own location. */
export const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  ".."
);

/**
 * Classify one file in a hooks directory.
 *
 * @param {string} filename Basename as it sits on disk.
 * @returns {"adapter"|"entry-point"|"support"|"manifest"}
 */
export function classifyHookFile(filename) {
  if (MANIFEST_FILENAMES.includes(filename)) return "manifest";
  if (filename.endsWith(ADAPTER_SUFFIX)) return "adapter";
  if (filename.endsWith(".sh")) return "entry-point";
  return "support";
}

/**
 * Every string that appears anywhere in a parsed JSON value.
 *
 * @param {unknown} value
 * @returns {string[]}
 */
function collectStrings(value) {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(collectStrings);
  if (value && typeof value === "object") {
    return Object.values(value).flatMap(collectStrings);
  }
  return [];
}

/**
 * Directory entries that are regular files, sorted, or [] when absent.
 *
 * @param {string} dir
 * @returns {string[]}
 */
function listFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter(entry => entry.isFile())
    .map(entry => entry.name)
    .sort();
}

/**
 * Recursively collect paths under `dir` whose basename passes `keep`.
 *
 * @param {string} dir
 * @param {(basename: string) => boolean} keep
 * @param {number} [maxDepth]
 * @returns {string[]}
 */
function findFiles(dir, keep, maxDepth = 6) {
  if (!fs.existsSync(dir)) return [];
  const found = [];
  const walk = (current, depth) => {
    if (depth > maxDepth) return;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "node_modules") walk(full, depth + 1);
      } else if (entry.isFile() && keep(entry.name)) {
        found.push(full);
      }
    }
  };
  walk(dir, 0);
  return found.sort();
}

/**
 * The manifest files under `root`, each with the hook basenames it registers.
 *
 * A SURFACE is one manifest file, not one port directory. `plugins/lisa/` alone
 * carries two runtimes' registrations in two different files, so folding a port
 * into a single set unions them — and a hook dropped from the Codex file goes
 * on reading as registered because the Claude file beside it still names it.
 * That is exactly the break this audit was filed for.
 *
 * Shape-agnostic on purpose: five agent runtimes read five different manifest
 * schemas, and a check coupled to any one of them would go quietly blind the
 * first time a schema changed. Every string in every manifest is examined for a
 * hook basename instead.
 *
 * @param {string} root Absolute path to a plugin port or generator source.
 * @param {string[]} hookNames Basenames to look for.
 * @returns {Array<{ manifest: string, registers: Set<string> }>} One entry per
 *   manifest file that registers at least one hook.
 */
export function readManifestSurfaces(root, hookNames) {
  const manifests = findFiles(root, name => MANIFEST_FILENAMES.includes(name));
  const surfaces = [];
  for (const manifest of manifests) {
    let strings;
    try {
      strings = collectStrings(JSON.parse(fs.readFileSync(manifest, "utf8")));
    } catch {
      continue;
    }
    const registers = new Set(
      hookNames.filter(name => strings.some(value => value.includes(name)))
    );
    if (registers.size > 0) {
      surfaces.push({
        manifest: path.relative(REPO_ROOT, manifest),
        registers,
      });
    }
  }
  return surfaces;
}

/**
 * Which agent reads a manifest, from the port directory's name and the
 * manifest's own location. Codex is told apart from Claude by the
 * `.codex-plugin/` directory, because both live inside the same port.
 *
 * @param {string} portName
 * @param {string} manifestRelPath
 * @returns {"agy"|"cursor"|"copilot"|"codex"|"claude"}
 */
export function surfaceAgent(portName, manifestRelPath) {
  if (portName.endsWith(AGY_PORT_SUFFIX)) return "agy";
  if (portName.endsWith("-cursor")) return "cursor";
  if (portName.endsWith("-copilot")) return "copilot";
  if (manifestRelPath.split(path.sep).includes(".codex-plugin")) return "codex";
  return "claude";
}

/**
 * The Antigravity adapter that stands in for a canonical guard, by the naming
 * protocol the adapters already follow (`x.sh` → `x.agy.sh`).
 *
 * @param {string} filename
 * @returns {string}
 */
function adapterFor(filename) {
  return `${filename.slice(0, -".sh".length)}${ADAPTER_SUFFIX}`;
}

/**
 * Guard basenames the host enforcement dispatcher runs.
 *
 * Parsed out of the dispatcher's own `for guard in ...; do` loop rather than
 * restated, so a guard dropped from the loop stops counting as registered here
 * on the same edit.
 *
 * @param {string} repoRoot
 * @returns {Set<string>}
 */
export function readDispatcherGuards(repoRoot) {
  const dispatcher = path.join(repoRoot, DISPATCHER_PATH);
  if (!fs.existsSync(dispatcher)) return new Set();
  const source = fs.readFileSync(dispatcher, "utf8");
  const loop = /^for\s+guard\s+in\s+([\s\S]*?);\s*do$/m.exec(source);
  if (!loop) return new Set();
  return new Set(
    loop[1]
      .replace(/\\\n/g, " ")
      .split(/\s+/)
      .filter(Boolean)
      .map(guard => `${guard}.sh`)
  );
}

/**
 * Hook basenames a shipped skill or command instructs an agent to run.
 *
 * @param {string} stackRoot Absolute path to a `plugins/src/<stack>` directory.
 * @param {string[]} hookNames Basenames to look for.
 * @returns {Set<string>}
 */
function readDocumentedInvocations(stackRoot, hookNames) {
  const docs = [
    ...findFiles(path.join(stackRoot, "skills"), name => name.endsWith(".md")),
    ...findFiles(path.join(stackRoot, "commands"), name =>
      name.endsWith(".md")
    ),
  ];
  const invoked = new Set();
  for (const doc of docs) {
    const text = fs.readFileSync(doc, "utf8");
    for (const name of hookNames) {
      if (text.includes(name)) invoked.add(name);
    }
  }
  return invoked;
}

/**
 * Which sibling files in the same hooks directory INVOKE `filename`.
 *
 * Invocation, not mention. A guard's refusal text routinely names other guards,
 * and a mention-level test would exempt exactly the registered guards this
 * audit exists to protect — the guard that lost its manifest entry would look
 * like somebody's helper. Two properties separate the two: the reference has to
 * sit on a line that is not a comment, and the basename has to be preceded by a
 * path separator, which is what a script writes when it runs a sibling
 * (`"$LISA_HOOK_DIR/lisa-edit-gate.sh"`) and not what prose writes when it
 * cites one.
 *
 * References from `*.agy.sh` adapters do not count. An adapter delegating to
 * the canonical guard is the registered path doing its job, not evidence that
 * the guard is a library — counting it would exempt every guard that has an
 * Antigravity port.
 *
 * @param {string} hooksDir
 * @param {string} filename
 * @param {string[]} siblings
 * @returns {string[]}
 */
function siblingsInvoking(hooksDir, filename, siblings) {
  const invocation = new RegExp(
    `/${filename.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`
  );
  return siblings.filter(sibling => {
    if (sibling === filename) return false;
    if (sibling.endsWith(ADAPTER_SUFFIX)) return false;
    let text;
    try {
      text = fs.readFileSync(path.join(hooksDir, sibling), "utf8");
    } catch {
      return false;
    }
    return text
      .split("\n")
      .some(
        line => !/^\s*(?:#|\*|\/\*|\/\/)/.test(line) && invocation.test(line)
      );
  });
}

/**
 * Enumerate the plugin ports — every directory under `plugins/` that is not the
 * generator source. Derived from the directory listing so a port added later is
 * audited without editing this module.
 *
 * @param {string} repoRoot
 * @returns {Array<{ name: string, root: string }>}
 */
export function enumeratePorts(repoRoot) {
  const pluginsDir = path.join(repoRoot, "plugins");
  if (!fs.existsSync(pluginsDir)) return [];
  return fs
    .readdirSync(pluginsDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && entry.name !== "src")
    .map(entry => ({
      name: entry.name,
      root: path.join(pluginsDir, entry.name),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Enumerate the generator sources that carry hooks.
 *
 * @param {string} repoRoot
 * @returns {Array<{ stack: string, root: string, hooksDir: string }>}
 */
export function enumerateStacks(repoRoot) {
  const srcDir = path.join(repoRoot, "plugins", "src");
  if (!fs.existsSync(srcDir)) return [];
  return fs
    .readdirSync(srcDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => ({
      stack: entry.name,
      root: path.join(srcDir, entry.name),
      hooksDir: path.join(srcDir, entry.name, "hooks"),
    }))
    .filter(stack => fs.existsSync(stack.hooksDir))
    .sort((a, b) => a.stack.localeCompare(b.stack));
}

/**
 * Whether the per-agent ship list declares this script unshipped everywhere.
 *
 * @param {string} filename
 * @returns {boolean}
 */
function declaredUnshipped(filename) {
  return SHIP_LIST_AGENTS.every(agent => !shouldShipScript(filename, agent));
}

/**
 * Audit hook registration across every generator source and every port.
 *
 * @param {string} [repoRoot]
 * @returns {{
 *   scanned: { stacks: number, ports: number, surfaces: number, entryPoints: number, adapters: number, supportModules: number },
 *   surfaces: string[],
 *   violations: Array<{ kind: string, hook: string, surface: string, detail: string }>,
 * }}
 */
export function auditHookRegistration(repoRoot = REPO_ROOT) {
  const ports = enumeratePorts(repoRoot);
  const stacks = enumerateStacks(repoRoot);
  const dispatcherGuards = readDispatcherGuards(repoRoot);

  /** @type {Array<{ kind: string, hook: string, surface: string, detail: string }>} */
  const violations = [];
  const counts = { entryPoints: 0, adapters: 0, supportModules: 0 };

  // Every hook basename anywhere in the repository, so a manifest can be read
  // for names its own port no longer carries.
  const allHookNames = new Set();
  for (const dir of [
    ...stacks.map(stack => stack.hooksDir),
    ...ports.map(port => path.join(port.root, "hooks")),
  ]) {
    for (const file of listFiles(dir)) {
      if (classifyHookFile(file) !== "manifest") allHookNames.add(file);
    }
  }
  const hookNames = [...allHookNames].sort();

  /**
   * Every manifest in the repository that registers a hook, tagged with the
   * port it belongs to and the agent that reads it.
   * @type {Array<{ port: string, manifest: string, agent: string, registers: Set<string>, shipped: Set<string> }>}
   */
  const surfaces = [];
  for (const port of ports) {
    const shipped = new Set(listFiles(path.join(port.root, "hooks")));
    for (const surface of readManifestSurfaces(port.root, hookNames)) {
      surfaces.push({
        port: port.name,
        manifest: surface.manifest,
        agent: surfaceAgent(port.name, surface.manifest),
        registers: surface.registers,
        shipped,
      });
    }
  }

  // 1. A manifest that names a script its port does not ship registers nothing.
  for (const surface of surfaces) {
    for (const hook of [...surface.registers].sort()) {
      if (surface.shipped.has(hook)) continue;
      violations.push({
        kind: "registered-but-missing",
        hook,
        surface: surface.manifest,
        detail: `${surface.manifest} registers ${hook}, but plugins/${surface.port}/hooks/${hook} does not exist — the entry points at nothing.`,
      });
    }
  }

  for (const stack of stacks) {
    const files = listFiles(stack.hooksDir);
    const documented = readDocumentedInvocations(stack.root, files);
    const sourceSurfaces = readManifestSurfaces(stack.root, files);
    const sourceRegisters = new Set(
      sourceSurfaces.flatMap(surface => [...surface.registers])
    );

    for (const file of files) {
      const kind = classifyHookFile(file);
      if (kind === "manifest") continue;

      const registeredOn = surfaces.filter(surface =>
        surface.registers.has(file)
      );

      if (kind === "support") {
        counts.supportModules += 1;
        // The extension exempts it from registration; a sibling that invokes it
        // is what earns the exemption, so a dead support file cannot hide
        // behind its extension.
        const invokedBy = siblingsInvoking(stack.hooksDir, file, files);
        if (invokedBy.length === 0) {
          violations.push({
            kind: "support-module-orphan",
            hook: file,
            surface: `plugins/src/${stack.stack}`,
            detail: `${file} is exempt from manifest registration as a support module, but no sibling in plugins/src/${stack.stack}/hooks invokes it — nothing runs it on any surface.`,
          });
        }
        continue;
      }

      if (kind === "adapter") {
        counts.adapters += 1;
        const agy = registeredOn.filter(surface => surface.agent === "agy");
        if (agy.length === 0) {
          violations.push({
            kind: "adapter-unregistered",
            hook: file,
            surface: "agy",
            detail: `${file} is an Antigravity protocol adapter in plugins/src/${stack.stack}/hooks, but no Antigravity manifest registers it. The Antigravity generator keeps its own hook table (scripts/generate-agy-plugin-artifacts.mjs), so an adapter missing from that table emits no Antigravity artifact and the build still succeeds.`,
          });
        }
        const offSurface = registeredOn.filter(
          surface => surface.agent !== "agy"
        );
        if (offSurface.length > 0) {
          const named = offSurface.map(surface => surface.manifest).join(", ");
          violations.push({
            kind: "adapter-off-surface",
            hook: file,
            surface: named,
            detail: `${file} is an Antigravity-protocol adapter and belongs on the Antigravity surface only, but ${named} registers it.`,
          });
        }
        continue;
      }

      counts.entryPoints += 1;

      // A `.sh` can also be a support LIBRARY that sibling entry points source
      // or exec. Same exemption as a `.mjs` support module, earned the same way
      // — by a sibling that actually invokes it — so the shape is recognised
      // without a list naming which files are libraries.
      const libraryFor = siblingsInvoking(stack.hooksDir, file, files);

      // 2. Reachable by at least one declared channel, or declared unshipped
      //    for every agent by the repository's own per-agent ship list.
      const reachable =
        registeredOn.length > 0 ||
        dispatcherGuards.has(file) ||
        documented.has(file) ||
        libraryFor.length > 0;
      if (!reachable && !declaredUnshipped(file)) {
        violations.push({
          kind: "unregistered-entry-point",
          hook: file,
          surface: `plugins/src/${stack.stack}`,
          detail: `${file} is a hook entry point that no plugin manifest registers, the host enforcement dispatcher does not run, no sibling invokes, and no shipped skill or command calls. It ships and never fires.`,
        });
      }

      // 3. The ship-list declaration is load-bearing in both directions, so it
      //    cannot be used as a quiet exemption: a script declared unshipped for
      //    an agent must not still be registered on that agent's surface.
      for (const surface of registeredOn) {
        if (shouldShipScript(file, surface.agent)) continue;
        violations.push({
          kind: "ship-list-contradiction",
          hook: file,
          surface: surface.manifest,
          detail: `scripts/lib/per-agent-hook-filter.mjs declares ${file} unshipped for ${surface.agent}, but ${surface.manifest} registers it. One of the two is wrong.`,
        });
      }

      // 4. Every port is generated from the base Claude manifest, so an entry
      //    point registered on any port must be registered at the source. This
      //    is the arm that survives a list-append merge resolution dropping one
      //    member of a matcher array: the ports still carry it, the source does
      //    not, and the next build erases it everywhere.
      if (registeredOn.length > 0 && !sourceRegisters.has(file)) {
        violations.push({
          kind: "source-registration-missing",
          hook: file,
          surface: `plugins/src/${stack.stack}`,
          detail: `${file} is registered on ${registeredOn.map(surface => surface.manifest).join(", ")} but not in plugins/src/${stack.stack}'s own manifest, which every port is generated from. The next build drops it from every surface.`,
        });
      }

      // 5. Fan-out: a port that both ships the script and serves an agent the
      //    ship list says it ships to must register it. This is the arm that
      //    catches a generated port whose entry never landed while its source
      //    still has it.
      if (!sourceRegisters.has(file)) continue;
      for (const surface of surfaces) {
        if (!surface.shipped.has(file)) continue;
        if (!shouldShipScript(file, surface.agent)) continue;
        // On Antigravity the canonical guard is reached through its adapter, so
        // the adapter's registration is the guard's registration.
        const registered =
          surface.registers.has(file) ||
          (surface.agent === "agy" && surface.registers.has(adapterFor(file)));
        if (registered) continue;
        violations.push({
          kind: "port-registration-missing",
          hook: file,
          surface: surface.manifest,
          detail: `plugins/${surface.port}/hooks/${file} ships and plugins/src/${stack.stack} registers it, but ${surface.manifest} does not — on ${surface.agent} it is present and inert.`,
        });
      }
    }
  }

  return {
    scanned: {
      stacks: stacks.length,
      ports: ports.length,
      surfaces: surfaces.length,
      ...counts,
    },
    surfaces: surfaces.map(surface => surface.manifest),
    violations: violations.sort(
      (a, b) =>
        a.kind.localeCompare(b.kind) ||
        a.hook.localeCompare(b.hook) ||
        a.surface.localeCompare(b.surface)
    ),
  };
}

/**
 * Human-readable rendering of an audit result.
 *
 * @param {ReturnType<typeof auditHookRegistration>} result
 * @returns {string}
 */
export function formatAudit(result) {
  const { scanned, violations } = result;
  const header = `Scanned ${scanned.entryPoints} entry points, ${scanned.adapters} adapters and ${scanned.supportModules} support modules across ${scanned.stacks} generator sources and ${scanned.surfaces} manifests in ${scanned.ports} ports.`;
  if (violations.length === 0)
    return `${header}\nEvery shipped hook is registered.`;
  const lines = violations.map(
    violation =>
      `  [${violation.kind}] ${violation.hook} (${violation.surface})\n    ${violation.detail}`
  );
  return `${header}\n${violations.length} violation(s):\n${lines.join("\n")}`;
}

// Runnable by hand for the same answer the test asserts. The enforcing surface
// is the vitest suite (a check that only prints is a check nobody fails on), so
// this exits non-zero rather than reporting and returning 0.
if (invokedAsScript(import.meta.url)) {
  const result = auditHookRegistration();
  const report = formatAudit(result);
  if (result.violations.length > 0) {
    console.error(report);
    process.exit(1);
  }
  console.log(report);
}
