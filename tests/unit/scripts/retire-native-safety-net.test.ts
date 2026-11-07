/** Ownership and preservation at the actual retirement file boundary. */
import {
  chmodSync,
  copyFileSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { retireNativeSafetyNet } from "../../../scripts/retire-native-safety-net.mjs";
import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";

const worlds: string[] = [];
const legacy = path.resolve(
  "tests/fixtures/retired-native-safety-net/parity-safety-net.agy.sh"
);
const shim = readFileSync(
  "plugins/lisa-agy/hooks/parity-safety-net.agy.sh",
  "utf8"
);
const original = readFileSync(legacy, "utf8");

function world(): { root: string; file: string; plugins: string } {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "lisa-retire-")));
  worlds.push(root);
  const dir = path.join(root, "scripts/lisa-hooks");
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "parity-safety-net.agy.sh");
  copyFileSync(legacy, file);
  return { root, file, plugins: path.join(root, "installed") };
}

afterEach(() => {
  for (const root of worlds.splice(0))
    rmSync(root, { recursive: true, force: true });
});

describe("native safety-net retirement", () => {
  it("replaces exact old Lisa bytes while preserving settings and unrelated guards", () => {
    const { root, file } = world();
    const settings = path.join(root, "settings.json");
    const other = path.join(path.dirname(file), "block-no-verify.sh");
    writeFileSync(settings, '{"operator":{"keep":true},"hooks":["mixed"]}\n');
    writeFileSync(other, "operator sentinel\n");
    expect(retireNativeSafetyNet({ projectDir: root })).toContainEqual({
      path: file,
      status: "retired",
    });
    expect(readFileSync(file, "utf8")).toBe(shim);
    expect(readFileSync(settings, "utf8")).toBe(
      '{"operator":{"keep":true},"hooks":["mixed"]}\n'
    );
    expect(readFileSync(other, "utf8")).toBe("operator sentinel\n");
    expect(retireNativeSafetyNet({ projectDir: root })).toEqual([
      { path: file, status: "already-retired" },
    ]);
  });

  it("reports dry-run retirement without changing a byte", () => {
    const { root, file } = world();
    expect(retireNativeSafetyNet({ projectDir: root, dryRun: true })).toEqual([
      { path: file, status: "would-retire" },
    ]);
    expect(readFileSync(file, "utf8")).toBe(original);
  });

  it("rejects an unknown preview option before touching a handler", () => {
    const { root, file } = world();
    const result = boundedSpawnSync({
      label: "retirement option validation",
      command: process.execPath,
      args: [
        path.resolve("scripts/retire-native-safety-net.mjs"),
        root,
        "--dryrun",
      ],
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Unknown or duplicate retirement option");
    expect(readFileSync(file, "utf8")).toBe(original);
  });

  it("preserves the existing permission bits despite the creation umask", () => {
    const { root, file } = world();
    chmodSync(file, 0o770);
    retireNativeSafetyNet({ projectDir: root });
    expect(statSync(file).mode & 0o777).toBe(0o770);
  });

  it("preserves a customized target even under a Lisa filename", () => {
    const { root, file } = world();
    writeFileSync(file, `${original}\n# operator customization\n`);
    expect(retireNativeSafetyNet({ projectDir: root })).toEqual([
      { path: file, status: "preserved-custom" },
    ]);
    expect(readFileSync(file, "utf8")).toBe(
      `${original}\n# operator customization\n`
    );
  });

  it("retires independent installed copies without changing a shared cache inode", () => {
    const { root, file, plugins } = world();
    const dir = path.join(plugins, "lisa/old/hooks");
    mkdirSync(dir, { recursive: true });
    const installed = path.join(dir, path.basename(file));
    const cache = path.join(root, "cache-original");
    copyFileSync(legacy, cache);
    linkSync(cache, installed);
    const result = retireNativeSafetyNet({
      projectDir: root,
      pluginRoots: [plugins],
    });
    expect(result).toContainEqual({ path: installed, status: "retired" });
    expect(readFileSync(installed, "utf8")).toBe(shim);
    expect(readFileSync(cache, "utf8")).toBe(original);
  });

  it("does not traverse plugin symlinks into another checkout", () => {
    const { root, file, plugins } = world();
    mkdirSync(plugins);
    symlinkSync(path.dirname(file), path.join(plugins, "linked"));
    expect(
      retireNativeSafetyNet({
        projectDir: root,
        pluginRoots: [plugins],
        dryRun: true,
      })
    ).toEqual([{ path: file, status: "would-retire" }]);
    expect(readFileSync(file, "utf8")).toBe(original);
  });
});
