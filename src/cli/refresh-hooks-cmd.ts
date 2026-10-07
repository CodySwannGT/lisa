/** Refresh a finite released hook cohort through retained native file identities. */
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Command } from "commander";
import {
  classifyHostCopy,
  type HashLedger,
} from "../core/lisa-owned-provenance.js";
import { LISA_OWNED_HASH_LEDGER } from "../core/lisa-owned-hash-ledger.js";
import { ConsoleLogger } from "../logging/index.js";
import {
  HookFiles,
  HookPair,
  bytes,
  checkPath,
  type Pin,
} from "./hook-refresh-files.js";

const COHORTS: Readonly<Record<string, readonly string[]>> = {
  "parity-safety-net": [
    "parity-safety-net.sh",
    "parity-safety-net-heredoc.py",
    "guard-dedupe.bash",
  ],
  "block-no-verify": ["block-no-verify.sh", "guard-dedupe.bash"],
};
const PREFIX = "scripts/lisa-hooks";

/**
 * Register finite refresh without entering full apply.
 * @param program - CLI program.
 * @param execute - Native refresh or command-routing fixture.
 */
export function addHookRefreshCommand(
  program: Command,
  execute: typeof refreshHooks
): void {
  program
    .command("refresh-hooks")
    .description(
      "Refresh only explicitly selected released guards and companions"
    )
    .argument("<destination>", "Host project root")
    .requiredOption(
      "--guards <names>",
      "Closed guard cohort: parity-safety-net,block-no-verify"
    )
    .action(async (destination: string, options: { guards: string }) => {
      await execute(destination, {}, options.guards);
    });
}

/** Installed-package and shipping-history seams for protocol fixtures. */
export interface HookRefreshDependencies {
  readonly packageDir?: string;
  readonly ledger?: HashLedger;
}

/**
 * Select only unique declared guards and required companions.
 * @param selection - Exact comma-separated names.
 * @returns Deterministic filenames.
 */
export function hookCohort(selection: string): readonly string[] {
  const names = selection.split(",");
  if (
    new Set(names).size !== names.length ||
    names.some(name => !Object.hasOwn(COHORTS, name))
  )
    throw new Error(
      "Select unique closed guards: parity-safety-net,block-no-verify"
    );
  return [...new Set(names.flatMap(name => COHORTS[name] ?? []))].sort(
    (left, right) => left.localeCompare(right)
  );
}

/**
 * Validate the installed release through a retained descriptor.
 * @param packageDir - Installed package root.
 * @param files - Lifetime handle registry.
 */
async function assertReleasedPackage(
  packageDir: string,
  files: HookFiles
): Promise<void> {
  const pin = await files.retain(
    path.join(packageDir, "package.json"),
    constants.O_RDONLY
  );
  const metadata: unknown = JSON.parse((await bytes(pin)).toString("utf8"));
  if (
    typeof metadata !== "object" ||
    metadata === null ||
    !("name" in metadata) ||
    metadata.name !== "@codyswann/lisa" ||
    !("version" in metadata) ||
    typeof metadata.version !== "string" ||
    !/^\d+\.\d+\.\d+$/.test(metadata.version) ||
    !("lisaReleaseTag" in metadata) ||
    metadata.lisaReleaseTag !== `v${metadata.version}` ||
    !("lisaReleaseCommit" in metadata) ||
    typeof metadata.lisaReleaseCommit !== "string" ||
    !/^[0-9a-f]{40}$/.test(metadata.lisaReleaseCommit)
  )
    throw new Error("Hook refresh requires a released Lisa package");
  await checkPath(pin);
}

/**
 * Authenticate every companion before writing.
 * @param root - Host root.
 * @param packageDir - Release root.
 * @param ledger - Shipping history.
 * @param hooks - Closed filenames.
 * @param files - Lifetime handle registry.
 * @returns Descriptor-bound cohort and ancestors.
 */
async function prepare(
  root: string,
  packageDir: string,
  ledger: HashLedger,
  hooks: readonly string[],
  files: HookFiles
) {
  const dirs = [
    ...(await files.directories(root, PREFIX)),
    ...(await files.directories(packageDir, `all/copy-overwrite/${PREFIX}`)),
  ];
  await assertReleasedPackage(packageDir, files);
  const results = await Promise.allSettled(
    hooks.map(async name => {
      const relative = `${PREFIX}/${name}`;
      const source = await files.retain(
        path.join(packageDir, "all/copy-overwrite", relative),
        constants.O_RDONLY
      );
      const host = await files.retain(
        path.join(root, relative),
        constants.O_RDWR
      );
      if ((await host.handle.stat({ bigint: true })).nlink !== 1n)
        throw new Error("Hook refresh requires single-link host files");
      const sourceBytes = await bytes(source);
      const hostBytes = await bytes(host);
      if (
        !(ledger[relative] ?? []).includes(
          createHash("sha256").update(sourceBytes).digest("hex")
        )
      )
        throw new Error(
          `${relative}: packaged hook is not recorded shipping source`
        );
      const verdict = classifyHostCopy(
        relative,
        hostBytes,
        sourceBytes,
        ledger
      );
      if (verdict.kind !== "identical" && verdict.kind !== "provably-stale")
        throw new Error(`${relative}: preserved ${verdict.kind} host hook`);
      return new HookPair(source, host, sourceBytes, hostBytes);
    })
  );
  const failed = results.find(result => result.status === "rejected");
  if (failed?.status === "rejected") throw failed.reason;
  const pairs = results.flatMap(result =>
    result.status === "fulfilled" ? [result.value] : []
  );
  return { dirs, pairs };
}

/**
 * Recheck original paths, source bytes and untouched host bytes/mode.
 * @param pair - Retained companion.
 * @param dirs - Retained ancestor authority.
 */
async function beforeWrite(
  pair: HookPair,
  dirs: readonly Pin[]
): Promise<void> {
  for (const pin of [...dirs, pair.source, pair.host]) await checkPath(pin);
  const actual = await pair.host.handle.stat({ bigint: true });
  if (
    actual.nlink !== 1n ||
    actual.mode !== pair.host.identity.mode ||
    !(await bytes(pair.source)).equals(pair.sourceBytes) ||
    !(await bytes(pair.host)).equals(pair.hostBytes)
  )
    throw new Error("Hook changed after preflight");
}

/**
 * Refresh a closed cohort with bounded backups on retained original inodes.
 * @param destination - Host root; unrelated dirty files are permitted.
 * @param dependencies - Package/history defaults or fixture inputs.
 * @param selection - Closed guard names.
 */
export async function refreshHooks(
  destination: string,
  dependencies: HookRefreshDependencies = {},
  selection = "parity-safety-net"
): Promise<void> {
  if (!constants.O_NOFOLLOW || !constants.O_DIRECTORY)
    throw new Error(
      "Hook refresh requires native no-follow descriptor support"
    );
  const root = await realpath(path.resolve(destination));
  const packageDir = await realpath(
    dependencies.packageDir ??
      path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
  );
  const files = new HookFiles();
  try {
    const { dirs, pairs } = await prepare(
      root,
      packageDir,
      dependencies.ledger ?? LISA_OWNED_HASH_LEDGER,
      hookCohort(selection),
      files
    );
    for (const pair of pairs) {
      await beforeWrite(pair, dirs);
      files.mark(pair);
      await pair.write(pair.sourceBytes);
      await pair.chmod(Number(pair.source.identity.mode & 0o777n));
      for (const pin of [...dirs, pair.source, pair.host]) await checkPath(pin);
      if (!(await bytes(pair.host)).equals(pair.sourceBytes))
        throw new Error("Hook refresh readback differs");
    }
  } catch (error) {
    await files.rollback(error);
  } finally {
    await files.close();
  }
  files.assertSuccess();
  new ConsoleLogger().success(
    `Refreshed only ${selection} and its verified companions`
  );
}
