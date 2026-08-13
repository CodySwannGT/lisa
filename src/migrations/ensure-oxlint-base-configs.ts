import { readFile, writeFile } from "node:fs/promises";
import * as path from "node:path";
import * as fse from "fs-extra";
import { readJsonOrNull } from "../utils/json-utils.js";
import type {
  Migration,
  MigrationContext,
  MigrationResult,
} from "./migration.interface.js";

const OXLINTRC = ".oxlintrc.json";

/**
 * Repo-relative home for the Lisa oxlint configs vendored into a host project.
 *
 * The `lisa-` path segment is deliberate: `isLisaOwnedTemplate()` keys on that
 * namespace, and it is how Lisa marks files it owns outright and may refresh
 * without asking. Hosts never hand-edit these — they layer their own rules in
 * `.oxlintrc.json`, which stays host-owned.
 */
const VENDOR_DIR = ".lisa/lisa-oxlint";

/** `extends` prefix that points at a vendored config. */
const VENDOR_PREFIX = `./${VENDOR_DIR}/`;

/** Directory inside the Lisa package holding the canonical oxlint configs. */
const SOURCE_DIR = "oxlint";

/**
 * Legacy `extends` entry shape, pointing into the installed Lisa package.
 * Captures the config's basename so it can be remapped to the vendored copy.
 */
const LEGACY_ENTRY =
  /^\.?\/?node_modules\/@codyswann\/lisa\/oxlint\/([^/]+\.json)$/;

/** Minimal shape of an oxlint config file. */
interface OxlintConfigLike {
  readonly extends?: readonly string[];
  readonly $schema?: unknown;
  readonly [key: string]: unknown;
}

/** What a run of this migration would change. */
interface Plan {
  /** Rewritten `extends` list for the host `.oxlintrc.json`. */
  readonly nextExtends: readonly string[];
  /** Whether `nextExtends` differs from what is on disk. */
  readonly extendsChanged: boolean;
  /** Vendored file basename to the exact content it should hold. */
  readonly files: ReadonlyMap<string, string>;
  /** Vendored files that are missing or stale on disk. */
  readonly staleFiles: readonly string[];
}

/**
 * Serialize a vendored oxlint config.
 *
 * `$schema` is dropped on the way in. It is an editor affordance that oxlint
 * itself never reads, and every value Lisa ships is a `node_modules`-relative
 * path — exactly the fragility this migration exists to remove. Leaving a
 * dangling pointer inside the file that fixes dangling pointers would be
 * self-defeating.
 * @param config - Parsed source config
 * @returns Canonical file content, newline-terminated
 */
function serialize(config: OxlintConfigLike): string {
  const { $schema: _schema, ...rest } = config;
  return `${JSON.stringify(rest, null, 2)}\n`;
}

/**
 * Rewrite one `extends` entry, remapping a legacy package-relative path to its
 * vendored equivalent and leaving anything else untouched.
 * @param entry - Raw `extends` entry
 * @returns Rewritten entry
 */
function remapEntry(entry: string): string {
  const legacy = LEGACY_ENTRY.exec(entry);
  return legacy ? `${VENDOR_PREFIX}${legacy[1]}` : entry;
}

/**
 * Collect the vendored config basenames an `extends` list depends on.
 * @param entries - Rewritten `extends` entries
 * @returns Basenames such as `typescript.json`
 */
function vendoredNames(entries: readonly string[]): readonly string[] {
  return entries
    .filter(entry => entry.startsWith(VENDOR_PREFIX))
    .map(entry => entry.slice(VENDOR_PREFIX.length))
    .filter(name => name.length > 0 && !name.includes("/"));
}

/**
 * Sibling config basenames a config inherits from.
 * @param config - Parsed oxlint config
 * @returns Basenames such as `base.json`
 */
function siblingParents(config: OxlintConfigLike): readonly string[] {
  return (config.extends ?? [])
    .filter(entry => entry.startsWith("./") && !entry.slice(2).includes("/"))
    .map(entry => entry.slice(2));
}

/**
 * Accumulate one config and everything it inherits from.
 *
 * Lisa's oxlint configs form a sibling chain (`expo.json` extends
 * `./typescript.json` extends `./base.json`), so vendoring a leaf without its
 * ancestors would leave a dangling reference — the very failure being fixed.
 * A config Lisa does not ship contributes nothing rather than a partial chain.
 * @param lisaDir - Lisa installation directory
 * @param name - Config basename to collect
 * @param seen - Already-collected basename to content
 * @returns Updated basename to serialized content
 */
async function collectChain(
  lisaDir: string,
  name: string,
  seen: ReadonlyMap<string, string>
): Promise<ReadonlyMap<string, string>> {
  if (seen.has(name)) {
    return seen;
  }
  const config = await readJsonOrNull<OxlintConfigLike>(
    path.join(lisaDir, SOURCE_DIR, name)
  );
  if (!config) {
    return seen;
  }
  const withSelf: ReadonlyMap<string, string> = new Map([
    ...seen,
    [name, serialize(config)] as const,
  ]);
  return siblingParents(config).reduce<Promise<ReadonlyMap<string, string>>>(
    async (acc, parent) => collectChain(lisaDir, parent, await acc),
    Promise.resolve(withSelf)
  );
}

/**
 * Walk the `extends` chains of every config the host references.
 * @param lisaDir - Lisa installation directory
 * @param roots - Config basenames referenced by the host
 * @returns Basename to serialized content for the whole closure
 */
async function resolveClosure(
  lisaDir: string,
  roots: readonly string[]
): Promise<ReadonlyMap<string, string>> {
  return roots.reduce<Promise<ReadonlyMap<string, string>>>(
    async (acc, root) => collectChain(lisaDir, root, await acc),
    Promise.resolve(new Map<string, string>())
  );
}

/**
 * Identify vendored configs whose on-disk content does not match what Lisa
 * ships, including those not written yet.
 * @param projectDir - Host project directory
 * @param files - Basename to expected content
 * @returns Basenames needing a write
 */
async function findStaleFiles(
  projectDir: string,
  files: ReadonlyMap<string, string>
): Promise<readonly string[]> {
  const checked = await Promise.all(
    [...files].map(async ([name, content]) => {
      const existing = await readFile(
        path.join(projectDir, VENDOR_DIR, name),
        "utf-8"
      ).catch(() => null as string | null);
      return { name, stale: existing !== content };
    })
  );
  return checked.filter(entry => entry.stale).map(entry => entry.name);
}

/**
 * Compute what this migration would change for a project.
 * @param ctx - Migration context
 * @returns The plan, or null when the project has no managed oxlint config
 */
async function buildPlan(ctx: MigrationContext): Promise<Plan | null> {
  const oxlintrcPath = path.join(ctx.projectDir, OXLINTRC);
  const oxlintrc = await readJsonOrNull<OxlintConfigLike>(oxlintrcPath);
  if (!oxlintrc || !Array.isArray(oxlintrc.extends)) {
    return null;
  }

  const current = oxlintrc.extends;
  const nextExtends = [...new Set(current.map(remapEntry))];
  const names = vendoredNames(nextExtends);
  if (names.length === 0) {
    return null;
  }

  const files = await resolveClosure(ctx.lisaDir, names);
  if (files.size === 0) {
    return null;
  }

  const staleFiles = await findStaleFiles(ctx.projectDir, files);

  const extendsChanged =
    nextExtends.length !== current.length ||
    nextExtends.some((entry, index) => entry !== current[index]);

  return { nextExtends, extendsChanged, files, staleFiles };
}

/**
 * Migration: vendor Lisa's oxlint configs into the host repository and point
 * `.oxlintrc.json` at them, so linting works in a checkout without an install.
 *
 * oxlint resolves every `extends` entry as a plain path relative to the config
 * file that declares it — its schema says so, and it performs no Node-style
 * upward module resolution. A `./node_modules/@codyswann/lisa/oxlint/*.json`
 * entry therefore dies in any checkout lacking its own `node_modules`, most
 * commonly a fresh `git worktree`. Since `.lintstagedrc.json` runs
 * `oxlint --fix` from the husky pre-commit hook, that blocked every commit in
 * such a worktree, with the failure surfacing as a downstream prettier kill
 * rather than as the config error it was (#2465).
 *
 * Vendoring is what makes it worktree-proof: git checks tracked files into
 * every worktree, whereas `node_modules` is untracked by definition. The two
 * layers are preserved — Lisa owns the vendored base, the host still owns
 * `.oxlintrc.json` — so projects keep overriding rules exactly as before.
 *
 * Pruning the legacy entry is not cosmetic. The `merge` strategy unions arrays
 * and can never drop an element, so an upgraded project would otherwise carry
 * the new path *and* the old one; oxlint hard-fails on any unresolvable entry,
 * so changing the templates alone would fix nothing for existing hosts.
 */
export class EnsureOxlintBaseConfigsMigration implements Migration {
  readonly name = "ensure-oxlint-base-configs";
  readonly description =
    "Vendor Lisa oxlint configs into .lisa/lisa-oxlint/ so linting works without node_modules";

  /**
   * The migration applies when the vendored configs are missing or stale, or
   * when `.oxlintrc.json` still carries a legacy package-relative entry.
   * @param ctx - Migration context
   * @returns True when there is work to do
   */
  async applies(ctx: MigrationContext): Promise<boolean> {
    const plan = await buildPlan(ctx);
    return plan !== null && (plan.extendsChanged || plan.staleFiles.length > 0);
  }

  /**
   * Write the vendored configs and normalize the host `extends` list.
   * @param ctx - Migration context
   * @returns Result describing the action taken
   */
  async apply(ctx: MigrationContext): Promise<MigrationResult> {
    const plan = await buildPlan(ctx);
    if (!plan || (!plan.extendsChanged && plan.staleFiles.length === 0)) {
      return { name: this.name, action: "noop" };
    }

    const changedFiles = [
      ...plan.staleFiles.map(name => `${VENDOR_DIR}/${name}`),
      ...(plan.extendsChanged ? [OXLINTRC] : []),
    ];
    const message = `vendored ${plan.files.size} oxlint config(s) into ${VENDOR_DIR}`;

    if (ctx.dryRun) {
      ctx.logger.dry(`Would ${message}`);
      return { name: this.name, action: "applied", changedFiles, message };
    }

    const vendorDir = path.join(ctx.projectDir, VENDOR_DIR);
    await fse.ensureDir(vendorDir);
    await Promise.all(
      plan.staleFiles.map(name =>
        writeFile(path.join(vendorDir, name), plan.files.get(name) as string)
      )
    );

    if (plan.extendsChanged) {
      const oxlintrcPath = path.join(ctx.projectDir, OXLINTRC);
      const oxlintrc = (await readJsonOrNull<OxlintConfigLike>(
        oxlintrcPath
      )) as OxlintConfigLike;
      await writeFile(
        oxlintrcPath,
        `${JSON.stringify({ ...oxlintrc, extends: plan.nextExtends }, null, 2)}\n`
      );
    }

    ctx.logger.success(message);
    return { name: this.name, action: "applied", changedFiles, message };
  }
}
