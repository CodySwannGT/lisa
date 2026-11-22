/**
 * The updater's `cacheSeed` option: an explicit, validated, read-only cache
 * that can only make a prepare succeed with the bytes its lock names, or fail
 * (CodySwannGT/lisa#5092).
 */
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { useIoLatencyBudget } from "../helpers/io-latency-budget.js";
import { prepareNativeUpdate as prepareUpdate } from "./support/npm-update-native-prepare.js";
import {
  baseline,
  CACHE_SEED,
  cachedTarball,
  config,
  PLAIN_LOCK,
  policy,
  seeded,
  SEEDED,
  UPDATE_INTEGRITY,
} from "./support/npm-update-dual-lock-fixture.js";
import {
  seedPrivateRoot,
  validCacheSeed,
} from "../../all/copy-overwrite/scripts/lib/npm-update-cache-seed.mjs";
import {
  validatePolicy,
  validateProposal,
} from "../../all/copy-overwrite/scripts/lib/npm-update-contract.mjs";
import { withPrivateRoot } from "../../all/copy-overwrite/scripts/lib/npm-update-process.mjs";
import { requireNativeBun } from "./support/native-path-bun.js";
import { createSymlink } from "../support/borrowed-node-modules.mjs";

useIoLatencyBudget();
const UPDATE_TARBALL =
  "https://registry.npmjs.org/is-number/-/is-number-7.0.0.tgz";

const scratch: string[] = [];

/**
 * A fresh, real (link-free) folder the test owns.
 * @returns Its absolute path.
 */
function folder(): string {
  const path = realpathSync(mkdtempSync(join(tmpdir(), "lisa-cache-seed-")));
  scratch.push(path);
  return path;
}

/**
 * A writable copy of the recorded seed.
 * @returns The copy, as a `cacheSeed`.
 */
function seedCopy(): { npm: string; bun: string } {
  const root = folder();
  const copy = { npm: join(root, "npm"), bun: join(root, "bun") };
  cpSync(CACHE_SEED.npm, copy.npm, { recursive: true });
  cpSync(CACHE_SEED.bun, copy.bun, { recursive: true });
  return copy;
}

afterEach(() => {
  for (const path of scratch.splice(0))
    rmSync(path, { force: true, recursive: true });
});

describe("prepareUpdate cacheSeed", () => {
  it("changes nothing when no seed is given", () => {
    const env = { NPM_CONFIG_CACHE: "/private/root/npm-cache" };
    expect(validCacheSeed(undefined)).toBeUndefined();
    expect(seedPrivateRoot("/private/root", env, undefined)).toBe(env);
  });

  it("refuses a seed that is not an owned, plain folder tree", () => {
    const real = seedCopy();
    const linked = folder();
    createSymlink(real.npm, join(linked, "npm"));
    const holdsLink = seedCopy();
    createSymlink("/etc", join(holdsLink.npm, "planted"));
    const shared = seedCopy();
    chmodSync(join(shared.npm, "_cacache"), 0o775);
    const file = join(folder(), "file");
    writeFileSync(file, "");
    for (const [seed, message] of [
      [null, "cache seed must be an object"],
      [[real.npm], "cache seed must be an object"],
      [{ bun: real.bun }, "names only an npm folder"],
      [{ ...real, registry: "https://example.invalid/" }, "names only"],
      [{ npm: "relative/npm" }, "must be an absolute path"],
      // A real folder another user owns: root's, on every supported host.
      [{ npm: "/usr/bin" }, "not owned by the updater's user"],
      [{ npm: join(linked, "npm") }, "must not pass through a link"],
      [{ npm: file }, "must be a folder"],
      [{ npm: holdsLink.npm }, "not a plain file or folder"],
      [{ npm: shared.npm }, "writable by another user"],
    ] as const)
      expect(() => validCacheSeed(seed), message).toThrow(message);
  });

  it("copies a seed into the private root only, and puts npm offline", () => {
    const seed = validCacheSeed(seedCopy());
    const root = folder();
    const cache = join(root, "npm-cache");
    expect(() =>
      seedPrivateRoot(root, { NPM_CONFIG_CACHE: "/elsewhere" }, seed)
    ).toThrow("outside the private root");
    const env = seedPrivateRoot(root, { NPM_CONFIG_CACHE: cache }, seed);
    expect(env).toEqual({
      NPM_CONFIG_CACHE: cache,
      NPM_CONFIG_OFFLINE: "true",
    });
    expect(existsSync(join(cache, "_cacache"))).toBe(true);
    expect(() =>
      seedPrivateRoot(root, { NPM_CONFIG_CACHE: cache }, seed)
    ).toThrow();
  });

  it("refuses a seed whose tarball differs from the lock's integrity", async () => {
    const poisoned = seedCopy();
    // A genuine tarball of another version, in place of the update's: valid
    // gzip, the wrong bytes.
    const baselineIntegrity = JSON.parse(readFileSync(PLAIN_LOCK, "utf8"))
      .packages["node_modules/is-number"].integrity;
    writeFileSync(
      cachedTarball(poisoned.npm, UPDATE_INTEGRITY),
      readFileSync(cachedTarball(poisoned.npm, baselineIntegrity))
    );
    const outcome = await withPrivateRoot(async (root, privateEnv) => {
      const env = seeded(root, privateEnv);
      const { cwd } = await baseline(root, env, false);
      const failure = await prepareUpdate(
        { cwd, policy, config, cacheSeed: poisoned },
        env
      ).then(
        () => undefined,
        (error: { stderr?: Buffer }) => error
      );
      return {
        failure,
        installed: JSON.parse(
          readFileSync(join(cwd, "node_modules/is-number/package.json"), "utf8")
        ).version,
      };
    });
    expect(
      outcome.failure,
      "prepare accepted a tampered tarball"
    ).toBeDefined();
    // npm checks the cached bytes against the lock's integrity, discards them,
    // and, offline, has nothing else to install.
    const diagnostic = outcome.failure?.stderr?.toString() ?? "";
    expect(diagnostic).toContain(
      `${UPDATE_TARBALL} (${UPDATE_INTEGRITY}) seems to be corrupted`
    );
    expect(diagnostic).toContain("ENOTCACHED");
    expect(outcome.installed).toBe("6.0.0");
  });

  it("refuses an npm-only seed for a host that commits bun.lock", async () => {
    requireNativeBun();
    const { npm } = seedCopy();
    const failure = await withPrivateRoot(async (root, privateEnv) => {
      const env = seeded(root, privateEnv);
      const { cwd } = await baseline(root, env);
      return prepareUpdate({ cwd, ...SEEDED, cacheSeed: { npm } }, env).then(
        () => undefined,
        (error: { stderr?: Buffer }) => error
      );
    });
    expect(failure, "prepare ran Bun without a Bun cache").toBeDefined();
    expect(failure?.stderr?.toString()).toContain(
      "cache seed has no Bun folder, and this host commits bun.lock"
    );
  });

  it("refuses a Bun manifest whose integrity differs from npm's", async () => {
    requireNativeBun();
    const forged = seedCopy();
    // Bun reads its own cached manifest, not npm's, to write bun.lock: forge
    // the update's integrity there, in place, and keep every other byte.
    const digest = Buffer.from(UPDATE_INTEGRITY.slice(7), "base64");
    const manifests = readdirSync(forged.bun).map(name =>
      join(forged.bun, name)
    );
    const manifest = manifests.find(path =>
      readFileSync(path).includes(digest)
    );
    if (manifest === undefined)
      throw new Error("no Bun manifest names the update");
    const bytes = readFileSync(manifest);
    const at = bytes.indexOf(digest);
    bytes.fill(0xab, at, at + digest.length);
    writeFileSync(manifest, bytes);
    const outcome = await withPrivateRoot(async (root, privateEnv) => {
      const env = seeded(root, privateEnv);
      const { cwd } = await baseline(root, env);
      const genuine = await prepareUpdate({ cwd, ...SEEDED }, env);
      const failure = await prepareUpdate(
        { cwd, ...SEEDED, cacheSeed: forged },
        env
      ).then(
        () => undefined,
        (error: { stderr?: Buffer }) => error
      );
      return { genuine, failure };
    });
    expect(
      outcome.failure,
      "prepare accepted a forged Bun manifest"
    ).toBeDefined();
    expect(outcome.failure?.stderr?.toString()).toContain(
      "Bun package identity differs from public npm lock"
    );
    // The genuine seed's proposal is marked, and every later phase refuses it.
    if (!("proposal" in outcome.genuine))
      throw new Error("seeded preparation did not produce an update");
    const proposal: Record<string, unknown> = outcome.genuine.proposal;
    expect(proposal.seeded).toBe(true);
    const checked = validatePolicy(policy, config);
    expect(() => validateProposal(proposal, checked)).toThrow(
      "unknown or missing fields"
    );
    const unmarked = Object.fromEntries(
      Object.entries(proposal).filter(([field]) => field !== "seeded")
    );
    expect(validateProposal(unmarked, checked)).toEqual(unmarked);
  });
});
