/**
 * `lisa controls install-carriers` and a hook whose end is never reached
 * (CodySwannGT/lisa#4989).
 *
 * The call is added at the end of a hook the repository owns. A hook that
 * always leaves before its last line would take the added lines with it: the
 * result would say `installed`, and every commit would pass with no check
 * run. So the command reads every line above the place the call goes, and
 * refuses when one of them can end the hook with success. It asks the same
 * questions again of a hook it already wired, because a hook changes after
 * the day it was wired.
 * @module tests/integration/controls-install-carriers-reachable
 */
import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { CARRIERS_BLOCKED_EXIT_CODE } from "../../src/controls/commands/install-carriers.js";
import {
  gitHooksFolder,
  type OwnedRepository,
  ownedRepository,
  writeExecutable,
} from "../support/carrier-hook-owners.js";
import {
  commitInstalled,
  commitLine,
  installCarriers,
  PLANTED,
  runs,
} from "../support/carrier-install.js";

const BEGIN = "# >>> lisa-carrier commit";
const END = "# <<< lisa-carrier commit";

const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

/**
 * Build F-none with a declared check, removed when the case ends.
 * @returns The repository and its commit hook file
 */
function repository(): {
  readonly owned: OwnedRepository;
  readonly hook: string;
} {
  const owned = ownedRepository();
  cleanups.push(owned.repository.cleanup);
  return { hook: path.join(gitHooksFolder(owned.root), "pre-commit"), owned };
}

/** One hook that always leaves before its last line. */
interface LeavingHook {
  /** What the hook is. */
  readonly name: string;
  /** Its lines after the first. */
  readonly lines: readonly string[];
  /** The line the result must name. */
  readonly line: number;
}

const LEAVING: readonly LeavingHook[] = [
  {
    line: 4,
    lines: ["if true; then", "  true", "  exit $?", "else", "  exit 0", "fi"],
    name: "an if whose branches both exit, closed by fi",
  },
  {
    line: 2,
    lines: ["echo checked; exit $?"],
    name: "a last line that exits after another command",
  },
  {
    line: 2,
    lines: ["exec true", "echo never reached"],
    name: "a line that hands over to another program before the last one",
  },
];

describe.each(LEAVING)("a commit hook with $name", leaving => {
  it("is left as it is, and the point is blocked with the line and what to add", async () => {
    const { hook, owned } = repository();
    const script = ["#!/bin/sh", ...leaving.lines, ""].join("\n");
    writeExecutable(hook, script);

    const run = await installCarriers(owned.root);
    const [commit, push] = run.result?.enforcement_points ?? [];

    expect(run.code).toBe(CARRIERS_BLOCKED_EXIT_CODE);
    expect(commit?.outcome).toBe("blocked");
    expect(commit?.reason).toContain(`line ${leaving.line}`);
    expect(commit?.reason).toMatch(/might never run/u);
    expect(commit?.reason).toContain(BEGIN);
    expect(commit?.reason).toContain(END);
    expect(push?.outcome).toBe("installed");
    expect(readFileSync(hook, "utf8")).toBe(script);
  });
});

describe("a commit hook that was wired and has changed since", () => {
  it("is reported as not wired once a line above the call always exits", async () => {
    const { hook, owned } = repository();
    writeExecutable(hook, `#!/bin/sh\n${owned.hostCommand}\n`);
    await installCarriers(owned.root);
    commitInstalled(owned.root);
    const wired = readFileSync(hook, "utf8");
    const changed = wired.replace(
      `${owned.hostCommand}\n`,
      `${owned.hostCommand}\nexit 0\n`
    );
    writeFileSync(hook, changed);

    const check = await installCarriers(owned.root, { check: true });
    const run = await installCarriers(owned.root);
    const before = runs(owned.commitRan);
    const passes = commitLine(owned.root, `# ${PLANTED}`);

    expect(changed).not.toBe(wired);
    expect(check.code).toBe(CARRIERS_BLOCKED_EXIT_CODE);
    expect(check.result?.enforcement_points[0]?.outcome).toBe("blocked");
    expect(run.result?.enforcement_points[0]?.reason).toMatch(
      /line 3.*the lines this command added there might never run/su
    );
    expect(readFileSync(hook, "utf8")).toBe(changed);
    // The hook really is unreachable: this is what the report must not hide.
    expect(passes.status).toBe(0);
    expect(runs(owned.commitRan)).toBe(before);
  });

  it("is reported as not wired once git no longer starts it", async () => {
    const { hook, owned } = repository();
    writeExecutable(hook, `#!/bin/sh\n${owned.hostCommand}\n`);
    await installCarriers(owned.root);
    commitInstalled(owned.root);
    chmodSync(hook, 0o644);

    const check = await installCarriers(owned.root, { check: true });

    expect(check.code).toBe(CARRIERS_BLOCKED_EXIT_CODE);
    expect(check.result?.enforcement_points[0]?.outcome).toBe("blocked");
    expect(check.result?.enforcement_points[0]?.reason).toMatch(
      /is not marked executable, so git does not run it/u
    );
    expect(check.result?.enforcement_points[1]?.outcome).toBe("already-wired");
  });

  it("is wired again by lines a person moved above the line that leaves", async () => {
    const { hook, owned } = repository();
    const script = `#!/bin/sh\n${owned.hostCommand}\nexec true\n`;
    writeExecutable(hook, script);
    const blocked = await installCarriers(owned.root);
    const reason = blocked.result?.enforcement_points[0]?.reason ?? "";
    const block = reason.slice(reason.indexOf(BEGIN));
    writeFileSync(hook, script.replace("exec true\n", `${block}\nexec true\n`));

    const check = await installCarriers(owned.root, { check: true });
    const run = await installCarriers(owned.root);
    commitInstalled(owned.root);
    const rejected = commitLine(owned.root, `# ${PLANTED}`);

    expect(block.endsWith(END)).toBe(true);
    expect(check.code).toBe(0);
    expect(check.result?.outcome).toBe("already-wired");
    expect(run.code).toBe(0);
    expect(rejected.status).not.toBe(0);
  });
});
