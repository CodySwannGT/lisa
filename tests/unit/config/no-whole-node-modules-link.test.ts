/**
 * No test may link a whole `node_modules` directory (CodySwannGT/lisa#5028).
 *
 * A fixture that runs a real Vitest through such a link reaches the lender's
 * `node_modules/.vitest-cache`. The fixture has no lockfile, so Vitest's
 * lockfile-hash check never matches, and it clears the lender's cache. When
 * the lender is this checkout, that happens in the middle of the suite, and
 * every sibling test file still reading the cache fails with ENOENT.
 *
 * Whether a path held in a variable names a whole `node_modules` cannot be
 * told from the source text, so the rule does not read arguments at all. It
 * is structural: no file under tests/ calls `symlink` or `symlinkSync`
 * itself. Links go through `tests/support/borrowed-node-modules.mjs`, the one
 * module that creates them, the same single-accessor shape as one module
 * owning `process.env`. That module checks both ends of every link on
 * resolved paths at runtime, so a variable-bound path is refused as surely as
 * a literal one.
 * @module tests/unit/config/no-whole-node-modules-link
 */
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  isShellScript,
  SCRIPT_FILE,
  scriptLinks,
  shellLinks,
} from "../../helpers/link-call-scan.js";
import { checkoutFiles } from "../../helpers/tracked-files.js";
import {
  createSymlink,
  linkForeignNodeModules,
  linkPackage,
} from "../../support/borrowed-node-modules.mjs";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..", "..");

/** The one module under tests/ allowed to create links. */
const ACCESSOR = "tests/support/borrowed-node-modules.mjs";

/**
 * The call name, spelled so the samples below are not themselves calls in
 * this file's text, which the corpus case scans like any other.
 */
const LINK = ["sym", "link", "Sync"].join("");

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

/**
 * A fresh directory outside this checkout.
 * @param prefix - Directory name prefix
 * @returns Its resolved path
 */
function scratch(prefix: string): string {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(tmpdir(), prefix)));
  roots.push(root);
  return root;
}

describe("no whole node_modules link in a test", () => {
  it("recognises every direct link call, however its paths are spelled", () => {
    // The detector's own red. The last sample is the variable-bound shape a
    // reading of the arguments missed: the path is in a local, not the call.
    const before = [
      `${LINK}(NODE_MODULES, path.join(root, "node_modules"), "dir");`,
      `fs.${LINK}(\n  path.join(REPO_ROOT, "node_modules"),\n  path.join(root, "node_modules"),\n  "dir"\n);`,
      `await ${LINK.replace("Sync", "")}(\n    path.join(source, "node_modules"),\n    path.join(destination, "node_modules"),\n    "dir"\n  );`,
      `fs.${LINK}(path.join(source, entry), path.join(target, entry));`,
      `const source = path.join(REPO_ROOT, "node_modules");\nfs.${LINK}(source, target, "dir");`,
      `import { ${LINK} as mk } from "node:fs";\nmk(source, target);`,
      `const { ${LINK.replace("Sync", "")}: s } = fsp;\nawait s(source, target);`,
      `fs["${LINK}"](source, target);`,
      `execFileSync("ln", ["-s", source, target]);`,
      `spawnSync("/bin/ln", ["-s", source, target]);`,
      `boundedExecFileSync({ label: "x", command: "/bin/ln", args: ["-s", a, b] });`,
      `execSync(\`ln -sf \${source} \${target}\`);`,
      `exec("cd x && ln -s a b");`,
      `spawn("sh", ["-c", "ln -fs a b"]);`,
      `Bun.spawn(["ln", "-s", a, b]);`,
      `await Bun.$\`ln -s \${a} \${b}\`;`,
    ];
    for (const sample of before) {
      expect(scriptLinks("sample.ts", sample), sample).toHaveLength(1);
    }
    expect(shellLinks('ln -s "$a" "$b"\nln -sf a b # relink\n')).toHaveLength(
      2
    );
    expect(isShellScript("tools/stub", "#!/usr/bin/env bash\n")).toBe(true);
    expect(isShellScript("tools/run.sh", "")).toBe(true);
  });

  it("does not count a call name inside a string or a comment", () => {
    const allowed = [
      `const script = "${LINK}(a, b)";`,
      `// ${LINK}(a, b)`,
      `createSymlink(path.join(source, entry), path.join(target, entry));`,
      `execFileSync("git", ["log", "--oneline"]);`,
      `execSync("ls -s");`,
    ];
    for (const sample of allowed) {
      expect(scriptLinks("sample.ts", sample), sample).toEqual([]);
    }
    expect(shellLinks("# ln -s a b\nls -s\n")).toEqual([]);
  });

  it("refuses a variable-bound whole node_modules at runtime", () => {
    const root = scratch("lisa-link-whole-");
    const source = path.join(REPO_ROOT, "node_modules");
    const target = path.join(root, "node_modules");
    expect(() => createSymlink(source, target, "dir")).toThrow(
      /whole node_modules/u
    );
    expect(() =>
      createSymlink(path.join(REPO_ROOT, "package.json"), target)
    ).toThrow(/whole node_modules/u);
    expect(fs.existsSync(target)).toBe(false);
  });

  it("refuses a tool's state directory inside node_modules", () => {
    const root = scratch("lisa-link-state-");
    fs.mkdirSync(path.join(root, "node_modules"));
    expect(() =>
      createSymlink(
        path.join(REPO_ROOT, "node_modules", ".vitest-cache"),
        path.join(root, "node_modules", ".vitest-cache"),
        "dir"
      )
    ).toThrow(/tool's state/u);
  });

  it("links one package entry, and refuses a whole node_modules as one", () => {
    const root = scratch("lisa-link-package-");
    const linked = linkPackage(
      path.join(REPO_ROOT, "node_modules", "vitest"),
      root,
      "vitest"
    );
    expect(fs.realpathSync(linked)).toBe(
      fs.realpathSync(path.join(REPO_ROOT, "node_modules", "vitest"))
    );
    expect(() =>
      linkPackage(path.join(REPO_ROOT, "node_modules"), root, "whole")
    ).toThrow(/whole node_modules/u);
    expect(() => linkPackage(REPO_ROOT, root, "..")).toThrow(
      /not a package name/u
    );
  });

  it("refuses a foreign link whose source is inside this checkout", () => {
    expect(() =>
      linkForeignNodeModules(path.join(REPO_ROOT, "node_modules"), REPO_ROOT)
    ).toThrow(/inside the checkout/u);
  });

  it("refuses a source in a checkout child whose name begins with ..", () => {
    // `..probe-x` is a child of this checkout, not a step out of it; a test
    // of the relative path's first two characters read it as outside.
    const child = fs.mkdtempSync(path.join(REPO_ROOT, "..lisa-foreign-probe-"));
    try {
      expect(() =>
        linkForeignNodeModules(path.join(child, "node_modules"), child)
      ).toThrow(/inside the checkout/u);
      expect(fs.existsSync(path.join(child, "node_modules"))).toBe(false);
    } finally {
      fs.rmSync(child, { recursive: true, force: true });
    }
  });

  it("refuses a link outside the checkout that points at its node_modules", () => {
    // The alias stands outside the checkout, so only resolving the source
    // (not just its parent) shows it is the checkout's node_modules. A scratch
    // checkout stands in for this one, so the helper itself makes the alias.
    const checkout = scratch("lisa-foreign-checkout-");
    fs.mkdirSync(path.join(checkout, "node_modules"));
    const alias = linkForeignNodeModules(
      path.join(checkout, "node_modules"),
      scratch("lisa-foreign-alias-")
    );
    const root = scratch("lisa-foreign-host-");
    expect(() => linkForeignNodeModules(alias, root, checkout)).toThrow(
      /inside the checkout/u
    );
    expect(fs.existsSync(path.join(root, "node_modules"))).toBe(false);
  });

  it("finds no link made outside the helper in any tracked file under tests/", () => {
    const offenders = checkoutFiles(REPO_ROOT)
      .filter(file => file.startsWith("tests/") && file !== ACCESSOR)
      .flatMap(file => {
        const absolute = path.join(REPO_ROOT, file);
        if (!fs.lstatSync(absolute).isFile()) return [];
        const source = fs.readFileSync(absolute, "utf8");
        const calls = SCRIPT_FILE.test(file)
          ? scriptLinks(file, source)
          : isShellScript(file, source)
            ? shellLinks(source)
            : [];
        return calls.map(call => `${file}: ${call}`);
      });

    expect(offenders).toEqual([]);
  });
});
