/**
 * `lisa controls reconcile`, direction two: every command a commit or push
 * hook runs that no register entry declares (CodySwannGT/lisa#5000).
 *
 * A check someone adds to a hook runs on every commit, and nothing in the
 * register says what it proves. These cases add such a command the ways it
 * is added in practice (to Lisa's own hook script, to a hook the repository
 * already had, to a hook manager's configuration) and hold the command to
 * naming the hook and the command, and to staying quiet about a command the
 * register does declare. Nothing found is ever started: no case commits.
 * @module tests/integration/controls-reconcile-hooks
 */
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { carrierMarkers } from "../../src/controls/carrier-script.js";
import {
  gitHooksFolder,
  installManagerStandIn,
  writeExecutable,
} from "../support/carrier-hook-owners.js";
import { installCarriers } from "../support/carrier-install.js";
import {
  declaredRepository,
  LINT,
  LINT_ENTRY,
  missingPoints,
  reconcile,
  resultOf,
  undeclared,
  wiredRepository,
} from "../support/reconcile-run.js";

const PRE_COMMIT = "pre-commit";
const COMMIT_SCRIPT = ".lisa/hooks/pre-commit";
const SCAN = "node scripts/secret-scan.mjs --staged";
const LICENCES = "npm run licences";
const DECLARED = LINT.join(" ");
const UNDECLARED = "undeclared-command";

const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

/**
 * Build F-none with its gates declared and nothing installed, removed when
 * the case ends.
 * @returns The repository's root
 */
function declared(): string {
  const repository = declaredRepository();
  cleanups.push(repository.cleanup);
  return repository.fixture.repoPath;
}

/**
 * Install the carriers through whoever owns the hooks of a repository.
 * @param root - The repository
 */
async function install(root: string): Promise<void> {
  const run = await installCarriers(root);
  if (run.code !== 0) throw new Error(run.said.join("\n"));
}

describe("reconcile on a command added to a hook", () => {
  it("names the hook and the command added to Lisa's own hook script", async () => {
    const repository = await wiredRepository();
    cleanups.push(repository.cleanup);
    const root = repository.fixture.repoPath;
    appendFileSync(path.join(root, COMMIT_SCRIPT), `${SCAN}\n`);

    const run = await reconcile(root);

    expect(run.code).toBe(0);
    expect(undeclared(run)).toEqual([
      {
        command: SCAN,
        hook: PRE_COMMIT,
        kind: UNDECLARED,
        line: 17,
        message: `The commit hook also runs "${SCAN}" (.lisa/hooks/pre-commit line 17), which the register does not mention.`,
        moment: "commit",
        next: expect.stringContaining("this command never removes anything"),
        path: COMMIT_SCRIPT,
      },
    ]);
    expect(missingPoints(run)).toEqual([]);
    expect(run.said[1]).toContain(`also runs "${SCAN}"`);
  });

  it("reports a hook the repository already had, and not the call Lisa added to it", async () => {
    const root = declared();
    const hook = path.join(gitHooksFolder(root), PRE_COMMIT);
    writeExecutable(hook, `#!/bin/sh\nset -e\n${SCAN}\n`);
    await install(root);

    const run = await reconcile(root);

    expect(resultOf(run).hook_owner).toBe("git-hooks");
    expect(resultOf(run).hook_commands).toEqual([
      {
        command: SCAN,
        declared_by: [],
        hook: PRE_COMMIT,
        line: 3,
        moment: "commit",
        path: ".git/hooks/pre-commit",
        through: "git-hooks",
      },
    ]);
    expect(undeclared(run).map(finding => finding.path)).toEqual([
      ".git/hooks/pre-commit",
    ]);
    expect(missingPoints(run)).toEqual([]);
  });

  it("stays quiet about a command the register declares at that moment", async () => {
    const root = declared();
    writeExecutable(
      path.join(gitHooksFolder(root), PRE_COMMIT),
      `#!/bin/sh\n${DECLARED}\n`
    );
    writeExecutable(
      path.join(gitHooksFolder(root), "pre-push"),
      `#!/bin/sh\n${DECLARED}\n`
    );
    await install(root);

    const run = await reconcile(root);

    expect(
      resultOf(run).hook_commands.map(command => [
        command.moment,
        command.declared_by,
      ])
    ).toEqual([
      ["commit", [LINT_ENTRY]],
      ["push", []],
    ]);
    expect(undeclared(run).map(finding => finding.moment)).toEqual(["push"]);
  });
});

describe("reconcile on a hook manager's configuration", () => {
  it("reports a command a Lefthook configuration adds", async () => {
    const root = declared();
    writeFileSync(
      path.join(root, "lefthook.yml"),
      `pre-commit:\n  commands:\n    licences:\n      run: ${LICENCES}\n`
    );
    installManagerStandIn(root, "lefthook");
    await install(root);

    const run = await reconcile(root);

    expect(resultOf(run).hook_owner).toBe("lefthook");
    expect(undeclared(run)).toEqual([
      expect.objectContaining({
        command: LICENCES,
        hook: PRE_COMMIT,
        line: 4,
        path: "lefthook.yml",
      }),
    ]);
    expect(missingPoints(run)).toEqual([]);
  });

  it("reports a hook a pre-commit framework configuration adds", async () => {
    const root = declared();
    writeFileSync(
      path.join(root, ".pre-commit-config.yaml"),
      [
        "repos:",
        "  - repo: local",
        "    hooks:",
        "      - id: licences",
        "        name: licences",
        `        entry: ${LICENCES}`,
        "        language: system",
        "        stages: [pre-commit]",
        "",
      ].join("\n")
    );
    installManagerStandIn(root, PRE_COMMIT);
    await install(root);

    const run = await reconcile(root);

    expect(undeclared(run)).toEqual([
      expect.objectContaining({
        command: LICENCES,
        line: 4,
        moment: "commit",
        path: ".pre-commit-config.yaml",
      }),
    ]);
    expect(missingPoints(run)).toEqual([]);
  });
});

describe("reconcile on a hook a Lisa project type manages", () => {
  it("reads the host's own extension file and nothing from the managed block", async () => {
    const root = declared();
    mkdirSync(path.join(root, ".husky"));
    writeExecutable(
      path.join(root, ".husky/pre-push"),
      [
        "# BEGIN: AI GUARDRAILS",
        "gitleaks protect --staged",
        'node scripts/lisa-run-gates.mjs --moment=push --coverage="$COVERED"',
        ". .husky/pre-push.local",
        "# END: AI GUARDRAILS",
        "",
      ].join("\n")
    );
    writeFileSync(
      path.join(root, ".husky/pre-push.local"),
      "# the host's own checks\n$RUNNER verify:boot || exit 1\n"
    );

    const run = await reconcile(root);

    expect(undeclared(run)).toEqual([
      expect.objectContaining({
        command: "$RUNNER verify:boot",
        hook: "pre-push",
        line: 2,
        path: ".husky/pre-push.local",
      }),
    ]);
  });
});

describe("reconcile on a hook it cannot read reliably", () => {
  it("exits 2 and says which file, without guessing at its commands", async () => {
    const repository = await wiredRepository();
    cleanups.push(repository.cleanup);
    const root = repository.fixture.repoPath;
    appendFileSync(
      path.join(root, COMMIT_SCRIPT),
      `${carrierMarkers("commit").begin}\n${SCAN}\n`
    );

    const run = await reconcile(root);

    expect(run.code).toBe(2);
    expect(resultOf(run).outcome).toBe("incomplete");
    expect(undeclared(run)).toEqual([]);
    expect(
      resultOf(run).surfaces.find(surface => surface.surface === "hooks")
    ).toMatchObject({
      detail: expect.stringContaining("In .lisa/hooks/pre-commit, the lines"),
      state: "could-not-read",
    });
    expect(run.said[0]).toMatch(
      /^reconcile: INCOMPLETE\. This comparison is not complete: hooks could not be read\./u
    );
  });
});
