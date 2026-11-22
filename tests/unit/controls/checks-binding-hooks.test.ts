/**
 * The repository's own hook files in the digest evidence is bound to, and
 * what is said when the repository no longer is what the proofs ran
 * against.
 *
 * Where Husky, a hook manager or a committed hooks folder owns a
 * repository's hooks, the call that starts the gate runner sits in a file
 * of the repository's own. Someone can take the call out of that file, or
 * put an `exit 0` above it, without touching anything Lisa placed. So the
 * files the read-only carrier check names as holding the marked call are
 * covered too.
 */
import { afterEach, describe, expect, it } from "vitest";

import { carrierCallBlock } from "../../../src/controls/carrier-script.js";
import type { installCarriers } from "../../../src/controls/carriers.js";
import {
  bindingDifferenceLines,
  digestOfCovered,
  hostHookFiles,
} from "../../../src/controls/checks-binding.js";
import type {
  ChecksBinding,
  CoveredCheckFile,
} from "../../../src/controls/evidence-types.js";
import {
  DECLARATION,
  emptyFolder,
  put,
  removeFolders,
  RUNNER,
  VIOLATION_PATCH,
} from "./support/binding-folders.js";

const HUSKY_COMMIT = ".husky/pre-commit";
const HUSKY_PUSH = ".husky/pre-push";
const LEFTHOOK = "lefthook.yml";
const ABOUT =
  "The verdict is about the checks as they were proved, so it does not describe what is here.";

/** One point as the carrier check reports it, as far as it is read here. */
interface ReportedPoint {
  readonly kind: "git-hook" | "agent-hook";
  readonly moment: string;
  readonly path: string | null;
}

/**
 * A read-only carrier check that reports the given points.
 * @param points - The points
 * @returns The check
 */
function reporting(points: readonly ReportedPoint[]): typeof installCarriers {
  const run = { problems: null, result: { enforcement_points: points } };
  return (() => Promise.resolve(run)) as unknown as typeof installCarriers;
}

/**
 * A hook file that holds Lisa's marked call for a moment after its own.
 * @param moment - The moment
 * @returns The file's content
 */
function hookCalling(moment: "commit" | "push"): string {
  return `#!/bin/sh\nnpx lint-staged\n${carrierCallBlock(moment)}\n`;
}

/**
 * A binding of some files, with the digest the list gives.
 * @param files - Each path and a letter its digest is made of
 * @returns The binding
 */
function bindingOf(files: Readonly<Record<string, string>>): ChecksBinding {
  const covered: readonly CoveredCheckFile[] = Object.entries(files).map(
    ([path, letter]) => ({ path, sha256: letter.repeat(64) })
  );
  return { covered, digest: digestOfCovered(covered) };
}

afterEach(() => {
  removeFolders();
});

describe("the repository's own hook files that hold Lisa's marked call", () => {
  it("are the files the carrier check names that hold the marked lines for their moment", async () => {
    const root = emptyFolder();
    put(root, HUSKY_COMMIT, hookCalling("commit"));
    put(root, HUSKY_PUSH, hookCalling("push"));

    expect(
      await hostHookFiles(
        root,
        reporting([
          { kind: "git-hook", moment: "commit", path: HUSKY_COMMIT },
          { kind: "git-hook", moment: "push", path: HUSKY_PUSH },
        ])
      )
    ).toEqual([HUSKY_COMMIT, HUSKY_PUSH]);
  });

  it("name a hook manager's one file once, though it holds the call for both moments", async () => {
    const root = emptyFolder();
    put(
      root,
      LEFTHOOK,
      `pre-commit:\n  commands:\n    ${carrierCallBlock("commit").replaceAll("\n", "\n    ")}\npre-push:\n  commands:\n    ${carrierCallBlock("push").replaceAll("\n", "\n    ")}\n`
    );

    expect(
      await hostHookFiles(
        root,
        reporting([
          { kind: "git-hook", moment: "commit", path: LEFTHOOK },
          { kind: "git-hook", moment: "push", path: LEFTHOOK },
        ])
      )
    ).toEqual([LEFTHOOK]);
  });

  it.each([
    ["a file that does not hold the marked lines", HUSKY_COMMIT, "#!/bin/sh\n"],
    [
      "a file that holds the lines of the other moment only",
      HUSKY_COMMIT,
      hookCalling("push"),
    ],
    ["a setting, which is no file", "core.hooksPath", null],
    [
      "a hook in git's own folder, which no clone has",
      ".git/hooks/pre-commit",
      hookCalling("commit"),
    ],
    [
      "a hook in the folder every working tree shares",
      "<git-common-dir>/hooks/pre-commit",
      null,
    ],
    ["a hook outside the checkout", "<outside the checkout>/pre-commit", null],
    ["a path that climbs out", "../hooks/pre-commit", null],
  ])("leave out %s", async (_name, file, content) => {
    const root = emptyFolder();
    if (content !== null) put(root, file, content);

    expect(
      await hostHookFiles(
        root,
        reporting([{ kind: "git-hook", moment: "commit", path: file }])
      )
    ).toEqual([]);
  });

  it("leave out a coding agent's hook, and a point with no file", async () => {
    const root = emptyFolder();
    put(root, ".claude/settings.json", carrierCallBlock("commit"));

    expect(
      await hostHookFiles(
        root,
        reporting([
          {
            kind: "agent-hook",
            moment: "commit",
            path: ".claude/settings.json",
          },
          { kind: "git-hook", moment: "commit", path: null },
        ])
      )
    ).toEqual([]);
  });

  it.each([
    [
      "gives no result",
      (() =>
        Promise.resolve({
          problems: ["not a repository"],
        })) as unknown as typeof installCarriers,
    ],
    [
      "cannot be run",
      (() =>
        Promise.reject(
          new Error("no git")
        )) as unknown as typeof installCarriers,
    ],
  ])("are none when the carrier check %s", async (_name, check) => {
    expect(await hostHookFiles(emptyFolder(), check)).toEqual([]);
  });
});

describe("what is said when the repository is not what the proofs ran against", () => {
  const recorded = bindingOf({
    [DECLARATION]: "a",
    [VIOLATION_PATCH]: "b",
    [RUNNER]: "c",
  });

  it("is nothing when nothing differs", () => {
    expect(bindingDifferenceLines(recorded, recorded)).toEqual([]);
  });

  it("names what changed, what is gone and what is new, each on a line of its own", () => {
    const current = bindingOf({
      [DECLARATION]: "a",
      [VIOLATION_PATCH]: "d",
      [HUSKY_COMMIT]: "e",
    });

    expect(bindingDifferenceLines(recorded, current)).toEqual([
      `What defines the checks is not what the proofs ran against. Changed since: ${VIOLATION_PATCH}. ${ABOUT}`,
      `What defines the checks is not what the proofs ran against. No longer here: ${RUNNER}. ${ABOUT}`,
      `What defines the checks is not what the proofs ran against. Here now and not there then: ${HUSKY_COMMIT}. ${ABOUT}`,
    ]);
  });

  it("names the declaration by the part of it that counts", () => {
    const current = bindingOf({
      [DECLARATION]: "f",
      [VIOLATION_PATCH]: "b",
      [RUNNER]: "c",
    });

    expect(bindingDifferenceLines(recorded, current)).toEqual([
      `What defines the checks is not what the proofs ran against. Changed since: the gates block of ${DECLARATION}. ${ABOUT}`,
    ]);
  });

  it("counts the files it does not name", () => {
    const many = Object.fromEntries(
      Array.from({ length: 11 }, (_unused, index) => [
        `.lisa/controls/proofs/p${String(index).padStart(2, "0")}.patch`,
        "a",
      ])
    );
    const [line] = bindingDifferenceLines(bindingOf(many), bindingOf({}));

    expect(line).toContain("p07.patch and 3 more.");
    expect(line).not.toContain("p08.patch");
  });

  it("says the file's own account does not add up when its digest is not the digest of its list", () => {
    const tampered = { ...recorded, digest: "0".repeat(64) };

    expect(bindingDifferenceLines(tampered, recorded)).toEqual([
      "The evidence file's own account of what defines the checks does not add up: its digest is not the digest of the files it lists. It was not written this way by a run.",
    ]);
  });
});
