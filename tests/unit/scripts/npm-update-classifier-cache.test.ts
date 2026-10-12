/** Synthetic registry replies exercise real archive/member checks, never hosted release proof. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  copyFileSync,
  existsSync,
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
const FILENAME = "codyswann-lisa-1.0.0.tgz";
const SELECTION_REFUSAL = "registry archive selection differs";
const fixture = vi.hoisted(() => ({
  root: "",
  archive: "",
  integrity: "",
  packOutput: Buffer.alloc(0),
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
        copyFileSync(fixture.archive, join(args[5]!, FILENAME));
        fixture.afterPack();
        return { stdout: Buffer.from(fixture.packOutput) };
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
    fixture.packOutput = Buffer.from(`${FILENAME}\n`);
    config = { automationProvenance: { signerDigest: "a".repeat(40) } };
    fixture.afterPack = () => {};
    fixture.beforeOwnerRead = () => {};
    vi.mocked(runNpm).mockClear();
  });
  afterEach(() => {
    rmSync(root, { recursive: true });
  });
  it("authenticates real archive members from a silent filename summary within original bounds", async () => {
    expect(typeof (await canonicalClassifier(config))).toBe("function");
    const calls = vi.mocked(runNpm).mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[0]![0]).toEqual(["view", `${PACKAGE}@1.0.0`, "--json"]);
    expect(calls[0]![1]).toMatchObject({ maximum: 1_048_576 });
    const destination = calls[1]![0][5]!;
    expect(calls[1]![0]).toEqual([
      "pack",
      `${PACKAGE}@1.0.0`,
      "--ignore-scripts",
      "--silent",
      "--pack-destination",
      destination,
    ]);
    expect(calls[1]![1]).toMatchObject({
      cwd: destination,
      timeout: 120_000,
      maximum: 1_048_576,
    });
    expect(existsSync(destination)).toBe(false);
  });
  it.each([
    ["missing newline", Buffer.from(FILENAME)],
    ["carriage return", Buffer.from(`${FILENAME}\r\n`)],
    ["multiple names", Buffer.from(`${FILENAME}\n${FILENAME}\n`)],
    ["wrong version", Buffer.from("codyswann-lisa-1.0.1.tgz\n")],
    ["parent traversal", Buffer.from(`../${FILENAME}\n`)],
    ["absolute path", Buffer.from(`/tmp/${FILENAME}\n`)],
    ["leading whitespace", Buffer.from(` ${FILENAME}\n`)],
    ["trailing junk", Buffer.from(`${FILENAME}\nnotice\n`)],
    [
      "legacy JSON inventory",
      Buffer.from(JSON.stringify([{ filename: FILENAME }])),
    ],
    [
      "invalid UTF-8 suffix",
      Buffer.concat([Buffer.from(`${FILENAME}\n`), Buffer.from([255])]),
    ],
    ["empty output", Buffer.alloc(0)],
  ])("refuses %s instead of selecting an archive", async (_label, output) => {
    fixture.packOutput = output as Buffer;
    await expect(canonicalClassifier(config)).rejects.toThrow(
      SELECTION_REFUSAL
    );
    const destination = vi.mocked(runNpm).mock.calls[1]![0][5]!;
    expect(existsSync(destination)).toBe(false);
  });
  it("re-authenticates after refusing an invalid summary rather than caching a grant", async () => {
    fixture.packOutput = Buffer.from(`${FILENAME}\nextra\n`);
    await expect(canonicalClassifier(config)).rejects.toThrow(
      SELECTION_REFUSAL
    );
    fixture.packOutput = Buffer.from(`${FILENAME}\n`);
    expect(typeof (await canonicalClassifier(config))).toBe("function");
    expect(runNpm).toHaveBeenCalledTimes(4);
  });
  it.each(["different bytes", "duplicate member"])(
    "refuses an integrity-matching archive with %s",
    async kind => {
      const member = `package/${CLASSIFIER_MEMBERS[0]!}`;
      if (kind === "different bytes")
        writeFileSync(join(root, member), "export const forged = true;\n");
      const packed = boundedSpawnSync({
        command: "tar",
        args: [
          "-czf",
          fixture.archive,
          "-C",
          root,
          "package",
          ...(kind === "duplicate member" ? [member] : []),
        ],
        label: "invalid but integrity-matching classifier archive",
        baseMs: 10_000,
        maxBuffer: 1_048_576,
      });
      expect(packed.status).toBe(0);
      fixture.integrity = `sha512-${createHash("sha512").update(readFileSync(fixture.archive)).digest("base64")}`;
      await expect(canonicalClassifier(config)).rejects.toThrow(
        /authenticated archive|missing or ambiguous/
      );
    }
  );
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
