/** Synthetic registry replies exercise real archive/member checks, never hosted release proof. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import {
  boundedSpawnSync,
  useIoLatencyBudget,
} from "../../helpers/io-latency-budget.js";

useIoLatencyBudget();

const MANIFEST_FILE = "package.json";
const PACKAGE = "@codyswann/lisa";
const fixture = vi.hoisted(() => ({
  root: "",
  archive: "",
  integrity: "",
  afterPack: () => {},
  beforeOwnerRead: () => {},
}));
vi.mock(
  "../../../all/copy-overwrite/scripts/lib/npm-update-npm.mjs",
  async original => {
    const actual =
      await original<
        typeof import("../../../all/copy-overwrite/scripts/lib/npm-update-npm.mjs")
      >();
    return {
      ...actual,
      findLisaPackageOwner: () => {
        fixture.beforeOwnerRead();
        return {
          root: fixture.root,
          metadata: JSON.parse(
            readFileSync(join(fixture.root, MANIFEST_FILE), "utf8")
          ),
        };
      },
      runNpm: vi.fn(async (args: string[]) => {
        if (args[0] === "view")
          return {
            stdout: Buffer.from(
              JSON.stringify({
                name: PACKAGE,
                version: "1.0.0",
                gitHead: "a".repeat(40),
                dist: { integrity: fixture.integrity },
              })
            ),
          };
        if (args[0] !== "pack" || args[4] !== "--pack-destination")
          throw Error("Unexpected synthetic registry request");
        const filename = "codyswann-lisa-1.0.0.tgz";
        copyFileSync(fixture.archive, join(args[5]!, filename));
        fixture.afterPack();
        return { stdout: Buffer.from(JSON.stringify([{ filename }])) };
      }),
    };
  }
);

import { runNpm } from "../../../all/copy-overwrite/scripts/lib/npm-update-npm.mjs";
import { canonicalClassifier } from "../../../all/copy-overwrite/scripts/lib/npm-update-helper.mjs";
import { CLASSIFIER_MEMBERS } from "../../../all/copy-overwrite/scripts/lib/npm-update-helper-inventory.mjs";

describe("invocation-local authenticated classifier reuse", () => {
  let root: string;
  let config: { automationProvenance: { signerDigest: string } };
  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), "lisa-classifier-cache-")));
    fixture.root = join(root, "installed");
    const packaged = join(root, "package");
    for (const owner of [fixture.root, packaged]) {
      mkdirSync(owner, { mode: 0o700 });
      writeFileSync(
        join(owner, MANIFEST_FILE),
        JSON.stringify({
          name: PACKAGE,
          version: "1.0.0",
        })
      );
      for (const member of CLASSIFIER_MEMBERS) {
        mkdirSync(dirname(join(owner, member)), { recursive: true });
        copyFileSync(member, join(owner, member));
      }
    }
    fixture.archive = join(root, "synthetic.tgz");
    const packed = boundedSpawnSync({
      command: "tar",
      args: ["-czf", fixture.archive, "-C", root, "package"],
      label: "synthetic classifier archive",
      baseMs: 10_000,
      maxBuffer: 1_048_576,
    });
    expect(packed.status).toBe(0);
    fixture.integrity = `sha512-${createHash("sha512").update(readFileSync(fixture.archive)).digest("base64")}`;
    config = { automationProvenance: { signerDigest: "a".repeat(40) } };
    fixture.afterPack = () => {};
    fixture.beforeOwnerRead = () => {};
    vi.mocked(runNpm).mockClear();
  });
  afterEach(() => {
    rmSync(root, { recursive: true });
  });
  it("authenticates an identical released classifier once while evaluating each fresh hold", async () => {
    const first = await canonicalClassifier(config);
    expect(first({ body: "ordinary task" }).held).toBe(false);
    const next = await canonicalClassifier(config);
    expect(next({ labels: ["human-needed"] }).held).toBe(true);
    expect(await canonicalClassifier(config)).toBe(first);
    expect(vi.mocked(runNpm).mock.calls.map(([args]) => args[0])).toEqual([
      "view",
      "pack",
    ]);
  });
  it("does not share successful authentication with another config object", async () => {
    await canonicalClassifier(config);
    await canonicalClassifier({
      automationProvenance: { ...config.automationProvenance },
    });
    expect(runNpm).toHaveBeenCalledTimes(4);
  });
  it("refuses changed member bytes despite the same imported module URL", async () => {
    const first = await canonicalClassifier(config);
    const member = join(fixture.root, CLASSIFIER_MEMBERS[0]!);
    const original = readFileSync(member);
    writeFileSync(member, `${original.toString()}\n// changed\n`);
    await expect(canonicalClassifier(config)).rejects.toThrow();
    writeFileSync(member, original);
    expect(await canonicalClassifier(config)).toBe(first);
    expect(runNpm).toHaveBeenCalledTimes(2);
  });
  it("refuses a symlink replacing an authenticated member", async () => {
    await canonicalClassifier(config);
    const member = join(fixture.root, CLASSIFIER_MEMBERS[0]!);
    unlinkSync(member);
    symlinkSync(join(root, "package", CLASSIFIER_MEMBERS[0]!), member);
    await expect(canonicalClassifier(config)).rejects.toThrow(
      /aliased|changed/
    );
    expect(runNpm).toHaveBeenCalledTimes(2);
  });
  it.each(["version", "signer", "owner"])(
    "refuses changed %s identity before returning the cached classifier",
    async kind => {
      await canonicalClassifier(config);
      if (kind === "version")
        writeFileSync(
          join(fixture.root, MANIFEST_FILE),
          JSON.stringify({ name: PACKAGE, version: "1.0.1" })
        );
      if (kind === "signer")
        config.automationProvenance.signerDigest = "b".repeat(40);
      if (kind === "owner") fixture.root = join(root, "package");
      await expect(canonicalClassifier(config)).rejects.toThrow();
      expect(runNpm).toHaveBeenCalledTimes(2);
    }
  );
  it("does not retain failed archive authentication as a successful grant", async () => {
    const original = fixture.integrity;
    fixture.integrity = "sha512-invalid";
    await expect(canonicalClassifier(config)).rejects.toThrow(/integrity/);
    fixture.integrity = original;
    expect(typeof (await canonicalClassifier(config))).toBe("function");
    expect(runNpm).toHaveBeenCalledTimes(4);
  });
  it("refuses the uncertain imported URL after an await-time change is restored for any config", async () => {
    const member = join(fixture.root, CLASSIFIER_MEMBERS[0]!);
    const original = readFileSync(member);
    fixture.afterPack = () => {
      writeFileSync(
        member,
        `${original.toString()}\n// await-time replacement\n`
      );
    };
    await expect(canonicalClassifier(config)).rejects.toThrow(/changed/);
    fixture.afterPack = () => {};
    writeFileSync(member, original);
    const retries = await Promise.allSettled([
      canonicalClassifier(config),
      canonicalClassifier({
        automationProvenance: { ...config.automationProvenance },
      }),
    ]);
    expect(retries.map(result => result.status)).toEqual([
      "rejected",
      "rejected",
    ]);
    expect(runNpm).toHaveBeenCalledTimes(2);
  });
  it("shares only successful pending authentication for the same invocation", async () => {
    const [first, second] = await Promise.all([
      canonicalClassifier(config),
      canonicalClassifier(config),
    ]);
    expect(first).toBe(second);
    expect(runNpm).toHaveBeenCalledTimes(2);
  });
  it("refuses an imported owner that changed and reverted during authentication", async () => {
    const selected = fixture.root;
    const replacement = join(root, "package");
    let reads = 0;
    fixture.beforeOwnerRead = () => {
      if (++reads === 2) fixture.root = replacement;
    };
    fixture.afterPack = () => {
      fixture.root = selected;
    };
    await expect(canonicalClassifier(config)).rejects.toThrow(
      /classifier import owner changed/
    );
    for (const owner of [selected, replacement]) {
      fixture.root = owner;
      await expect(
        canonicalClassifier({
          automationProvenance: { ...config.automationProvenance },
        })
      ).rejects.toThrow(/import lifetime is uncertain/);
    }
    expect(runNpm).toHaveBeenCalledTimes(2);
  });
  it("refuses a pending sibling after another caller poisons its restored import", async () => {
    const member = join(fixture.root, CLASSIFIER_MEMBERS[0]!);
    const original = readFileSync(member);
    let reads = 0;
    fixture.beforeOwnerRead = () => {
      if (++reads === 5) writeFileSync(member, original);
    };
    fixture.afterPack = () => {
      writeFileSync(member, `${original.toString()}\n// pending replacement\n`);
    };
    const calls = await Promise.allSettled([
      canonicalClassifier(config),
      canonicalClassifier(config),
    ]);
    expect(reads).toBe(5);
    expect(calls.map(result => result.status)).toEqual([
      "rejected",
      "rejected",
    ]);
    expect(runNpm).toHaveBeenCalledTimes(2);
  });
  it("refuses a nonregular member replacing authenticated bytes", async () => {
    await canonicalClassifier(config);
    const member = join(fixture.root, CLASSIFIER_MEMBERS[0]!);
    unlinkSync(member);
    mkdirSync(member);
    await expect(canonicalClassifier(config)).rejects.toThrow(/aliased|absent/);
    expect(runNpm).toHaveBeenCalledTimes(2);
  });
  it.each([undefined, null])(
    "retains genuine current Git HEAD qualification without signer pin %s",
    async signerDigest => {
      const git = (args: string[]) => {
        const result = boundedSpawnSync({
          command: "git",
          args,
          cwd: fixture.root,
          env: {
            PATH: process.env.PATH,
            HOME: "/nonexistent",
            GIT_TERMINAL_PROMPT: "0",
          },
          label: "owned source classifier Git fixture",
          baseMs: 10_000,
        });
        expect(result.status).toBe(0);
      };
      git(["init"]);
      git(["add", ...CLASSIFIER_MEMBERS]);
      const commit = [
        "-c",
        "user.name=Fixture",
        "-c",
        "user.email=fixture@example.invalid",
        "commit",
        "-m",
        "fixture: classifier source",
      ];
      git(commit);
      const unpinned = { automationProvenance: { signerDigest } };
      expect(typeof (await canonicalClassifier(unpinned))).toBe("function");
      const member = join(fixture.root, CLASSIFIER_MEMBERS[0]!);
      writeFileSync(
        member,
        `${readFileSync(member, "utf8")}\n// new committed source\n`
      );
      git(["add", ...CLASSIFIER_MEMBERS]);
      git(commit);
      expect(typeof (await canonicalClassifier(unpinned))).toBe("function");
      expect(runNpm).not.toHaveBeenCalled();
    }
  );
});
