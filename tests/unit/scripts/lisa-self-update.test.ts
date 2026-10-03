/**
 * The host-side Lisa updater (CodySwannGT/lisa#4325).
 *
 * The decisions are tested as pure functions, and the whole flow is driven
 * through `main` with an injected command runner over a fabricated project, so
 * what is asserted is the exact command sequence a host's workflow would run —
 * not a paraphrase of it. Nothing here touches git, npm or GitHub.
 *
 * Imported from `all/copy-overwrite/`: that is the file `lisa apply` writes into
 * a host project.
 * @module tests/unit/scripts/lisa-self-update
 */
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  chooseBase,
  chooseMergeFlag,
  choosePackageManager,
  chooseSelfTarget,
  commitMessage,
  declaresLisa,
  isOlder,
  isSelfManifest,
  main,
  onlySelfBumps,
  packageCommands,
  parseFlags,
  planUpdate,
  pullRequestBody,
  receiptProblem,
  selfBumpSubject,
  supersededPullRequests,
  workItemBody,
  workItemLabels,
} from "../../../all/copy-overwrite/scripts/lisa-self-update.mjs";

/** Installed version in the fabricated host. */
const OLD = "4.40.0";
/** Version npm reports as latest. */
const NEW = "4.66.5";
/** This run's branch. */
const BRANCH = `lisa/update-${NEW}`;
/** The fabricated repository. */
const REPO = "owner/host";
/** URL the fake `gh pr create` returns. */
const PR_URL = "https://github.com/owner/host/pull/7";
/** Manifest filename. */
const MANIFEST = "package.json";
/** The package being kept current. */
const LISA = "@codyswann/lisa";
/** Command prefix that opens a pull request. */
const PR_CREATE = "gh pr create";
/** Command prefix that files a work item. */
const ISSUE_CREATE = "gh issue create";

describe("lisa-self-update: decisions", () => {
  it("refuses an unknown flag instead of ignoring it", () => {
    expect(parseFlags(["--dry-run"])).toEqual({ dryRun: true, help: false });
    expect(() => parseFlags(["--dryrun"])).toThrow(/unknown argument/u);
  });

  it("only updates projects that install Lisa from npm, never Lisa itself", () => {
    expect(declaresLisa({ devDependencies: { [LISA]: "^4" } })).toBe(true);
    expect(declaresLisa({ dependencies: { [LISA]: "4.0.0" } })).toBe(true);
    expect(declaresLisa({ name: LISA })).toBe(false);
    expect(declaresLisa({ devDependencies: {} })).toBe(false);
    expect(declaresLisa(null)).toBe(false);
  });

  it("treats engines as authoritative over lockfiles", () => {
    expect(choosePackageManager({ bun: "please-use-npm" }, ["bun.lock"])).toBe(
      "npm"
    );
    expect(choosePackageManager({ npm: "please-use-bun" }, [])).toBe("bun");
    expect(choosePackageManager({ bun: "1.3.8" }, ["bun.lock"])).toBe("bun");
    expect(choosePackageManager(undefined, ["pnpm-lock.yaml"])).toBe("pnpm");
    expect(choosePackageManager(undefined, ["yarn.lock"])).toBe("yarn");
    expect(choosePackageManager(undefined, [])).toBe("npm");
  });

  it("bumps with install -D / add -D to the exact target, never update", () => {
    expect(packageCommands("npm", NEW).bump).toEqual([
      "npm",
      "install",
      "-D",
      `@codyswann/lisa@${NEW}`,
    ]);
    expect(packageCommands("bun", NEW).bump).toEqual([
      "bun",
      "add",
      "-D",
      `@codyswann/lisa@${NEW}`,
    ]);
    expect(packageCommands("npm", NEW).install).toEqual(["npm", "ci"]);
  });

  it("compares releases numerically", () => {
    expect(isOlder("4.9.0", "4.10.0")).toBe(true);
    expect(isOlder("4.10.0", "4.9.0")).toBe(false);
    expect(isOlder(NEW, NEW)).toBe(false);
    expect(isOlder(`${NEW}-rc.1`, NEW)).toBe(true);
    expect(isOlder(NEW, `${NEW}-rc.1`)).toBe(false);
    expect(isOlder(`${NEW}+build.1`, NEW)).toBe(false);
  });

  it("plans an update only when installed is behind latest", () => {
    expect(planUpdate({ declares: true, installed: OLD, latest: NEW })).toEqual(
      { action: "update", from: OLD, to: NEW, branch: BRANCH }
    );
    expect(
      planUpdate({ declares: true, installed: NEW, latest: NEW }).action
    ).toBe("skip");
    expect(
      planUpdate({ declares: true, installed: null, latest: NEW }).action
    ).toBe("skip");
    expect(
      planUpdate({ declares: true, installed: OLD, latest: null }).action
    ).toBe("skip");
    expect(
      planUpdate({ declares: false, installed: OLD, latest: NEW }).action
    ).toBe("skip");
  });

  it("targets the lowest deploy environment's branch", () => {
    expect(
      chooseBase(
        {
          deploy: {
            order: ["dev", "staging", "production"],
            branches: { production: "main", staging: "staging", dev: "dev" },
          },
        },
        "main"
      )
    ).toBe("dev");
    expect(
      chooseBase({ deploy: { branches: { production: "main" } } }, "x")
    ).toBe("main");
    expect(chooseBase(null, "trunk")).toBe("trunk");
  });

  it("arms auto-merge only with a method the repository allows", () => {
    expect(
      chooseMergeFlag({
        allow_auto_merge: true,
        allow_merge_commit: false,
        allow_squash_merge: true,
      })
    ).toBe("--squash");
    expect(
      chooseMergeFlag({ allow_auto_merge: true, allow_merge_commit: true })
    ).toBe("--merge");
    expect(
      chooseMergeFlag({ allow_auto_merge: false, allow_merge_commit: true })
    ).toBeNull();
  });

  it("closes every other open update PR and nothing else", () => {
    expect(
      supersededPullRequests(
        [
          { number: 1, headRefName: "lisa/update-4.50.0" },
          { number: 2, headRefName: BRANCH },
          { number: 3, headRefName: "feature/thing" },
        ],
        BRANCH
      )
    ).toEqual([1]);
  });

  it("adds the standing work item as a trailer only when configured", () => {
    expect(commitMessage("s", "b", "PROJ-1")).toBe(
      "s\n\nb\n\nWork-Item: PROJ-1\n"
    );
    expect(commitMessage("s", "b", undefined)).toBe("s\n\nb\n");
    expect(pullRequestBody({ from: OLD, to: NEW }, undefined)).toContain(
      "LISA_UPDATE_WORK_ITEM"
    );
    expect(pullRequestBody({ from: OLD, to: NEW }, "PROJ-1")).not.toContain(
      "LISA_UPDATE_WORK_ITEM"
    );
  });

  it("requires a full-mode receipt for the target version", () => {
    expect(receiptProblem(null, NEW)).toMatch(/no .lisa\/apply-receipt/u);
    expect(
      receiptProblem({ lisa_version: OLD, apply_mode: "full" }, NEW)
    ).toMatch(/names 4\.40\.0/u);
    expect(
      receiptProblem({ lisa_version: NEW, apply_mode: "postinstall-safe" }, NEW)
    ).toMatch(/not "full"/u);
    expect(receiptProblem({ lisa_version: NEW, apply_mode: "full" }, NEW)).toBe(
      null
    );
  });
});

/**
 * A fabricated host project.
 * @param options - What the project carries
 * @param options.installed - Installed Lisa version
 * @param options.engines - The engines field
 * @returns Absolute project root
 */
function host(options: {
  installed: string;
  engines?: Record<string, string>;
}): string {
  const root = mkdtempSync(path.join(tmpdir(), "lisa-self-update-"));
  writeFileSync(
    path.join(root, MANIFEST),
    JSON.stringify({
      name: "host",
      devDependencies: { [LISA]: `^${options.installed}` },
      engines: options.engines ?? {},
    })
  );
  writeFileSync(path.join(root, "bun.lock"), "");
  const lisa = path.join(root, "node_modules", "@codyswann", "lisa");
  mkdirSync(lisa, { recursive: true });
  writeFileSync(
    path.join(lisa, MANIFEST),
    JSON.stringify({ version: options.installed })
  );
  return root;
}

/**
 * A command runner that records argv and answers like the real tools.
 * @param root - Project root, so the fake apply can write its receipt
 * @param answers - Overrides keyed by the command's first two words
 * @returns The runner and the commands it saw
 */
function fakeRunner(
  root: string,
  answers: Record<string, string> = {}
): {
  run: (argv: string[]) => Promise<string>;
  seen: string[][];
} {
  const seen: string[][] = [];
  const defaults: Record<string, string> = {
    "npm view": NEW,
    "gh pr list": "",
    [PR_CREATE]: PR_URL,
    "gh api": JSON.stringify({
      allow_auto_merge: true,
      allow_merge_commit: true,
    }),
    "git diff": MANIFEST,
  };
  const run = async (argv: string[]): Promise<string> => {
    seen.push(argv);
    if (argv[0] === "node" && argv[1]?.endsWith("dist/index.js")) {
      mkdirSync(path.join(root, ".lisa"), { recursive: true });
      writeFileSync(
        path.join(root, ".lisa", "apply-receipt.json"),
        JSON.stringify({ lisa_version: NEW, apply_mode: "full" })
      );
    }
    if (argv.slice(0, 3).join(" ") === "gh pr list") {
      return argv.includes("--search") ? "[]" : "";
    }
    const three = argv.slice(0, 3).join(" ");
    const two = argv.slice(0, 2).join(" ");
    return (
      answers[three] ?? answers[two] ?? defaults[three] ?? defaults[two] ?? ""
    );
  };
  return { run, seen };
}

describe("lisa-self-update: the whole flow", () => {
  it("bumps, applies, proves the receipt, pushes and opens one PR", async () => {
    const root = host({ installed: OLD, engines: { bun: "1.3.8" } });
    const { run, seen } = fakeRunner(root);
    const code = await main({
      root,
      repo: REPO,
      dryRun: false,
      run,
      log: () => {},
    });
    expect(code).toBe(0);
    const lines = seen.map(argv => argv.join(" "));
    const order = [
      "git checkout -B main origin/main",
      "bun install --frozen-lockfile",
      `git checkout -B ${BRANCH}`,
      `bun add -D @codyswann/lisa@${NEW}`,
      "node node_modules/@codyswann/lisa/dist/index.js --yes .",
      `git push --force -u origin ${BRANCH}`,
      `gh pr merge ${PR_URL} --auto --merge`,
    ].map(expected => lines.findIndex(line => line.startsWith(expected)));
    expect(order.every(index => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(lines.some(line => line.startsWith(PR_CREATE))).toBe(true);
  });

  it("uses npm when engines forbids bun, even with a bun lockfile", async () => {
    const root = host({ installed: OLD, engines: { bun: "please-use-npm" } });
    const { run, seen } = fakeRunner(root);
    await main({ root, repo: REPO, dryRun: false, run, log: () => {} });
    const lines = seen.map(argv => argv.join(" "));
    expect(lines).toContain(`npm install -D @codyswann/lisa@${NEW}`);
    expect(lines.some(line => line.startsWith("bun "))).toBe(false);
  });

  it("does nothing beyond reading when Lisa is current", async () => {
    const root = host({ installed: NEW });
    const { run, seen } = fakeRunner(root);
    const logs: string[] = [];
    await main({
      root,
      repo: REPO,
      dryRun: false,
      run,
      log: line => logs.push(line),
    });
    const lines = seen.map(argv => argv.join(" "));
    expect(lines.some(line => line.startsWith("git push"))).toBe(false);
    expect(lines.some(line => line.startsWith(PR_CREATE))).toBe(false);
    expect(logs.join("\n")).toContain("Lisa is current");
  });

  it("fails loudly when the apply did not run in full", async () => {
    const root = host({ installed: OLD });
    const { run: base } = fakeRunner(root);
    const run = async (argv: string[]): Promise<string> => {
      const out = await base(argv);
      if (argv[0] === "node") {
        writeFileSync(
          path.join(root, ".lisa", "apply-receipt.json"),
          JSON.stringify({ lisa_version: NEW, apply_mode: "postinstall-safe" })
        );
      }
      return out;
    };
    await expect(
      main({ root, repo: REPO, dryRun: false, run, log: () => {} })
    ).rejects.toThrow(/not "full"/u);
  });

  it("dry run plans without installing, committing or pushing", async () => {
    const root = host({ installed: OLD });
    const { run, seen } = fakeRunner(root);
    const logs: string[] = [];
    await main({
      root,
      repo: REPO,
      dryRun: true,
      run,
      log: line => logs.push(line),
    });
    expect(seen.map(argv => argv.join(" "))).toEqual([
      "npm view @codyswann/lisa version",
    ]);
    expect(logs.join("\n")).toContain("Dry run");
  });

  it("closes superseded update PRs and leaves PRs open when auto-merge is off", async () => {
    const root = host({ installed: OLD });
    const { run: base, seen } = fakeRunner(root, {
      "gh api": JSON.stringify({ allow_auto_merge: false }),
    });
    const run = async (argv: string[]): Promise<string> =>
      argv.includes("--search")
        ? JSON.stringify([{ number: 4, headRefName: "lisa/update-4.50.0" }])
        : base(argv);
    const logs: string[] = [];
    await main({
      root,
      repo: REPO,
      dryRun: false,
      run,
      log: line => logs.push(line),
    });
    const lines = seen.map(argv => argv.join(" "));
    expect(lines.some(line => line.startsWith("gh pr close 4"))).toBe(true);
    expect(lines.some(line => line.startsWith("gh pr merge"))).toBe(false);
    expect(logs.join("\n")).toContain("Auto-merge is not enabled");
  });
});

/** The release Lisa's own manifest has just cut. */
const RELEASED = "4.68.0";
/** A subject the release workflow writes. */
const RELEASE_COMMIT = `chore(release): ${RELEASED} [skip ci] [skip-cd]`;
/** Lisa's own repository. */
const LISA_REPO = "CodySwannGT/lisa";
/** The per-update work item the fake tracker hands back. */
const FILED = `${LISA_REPO}#77`;
/** The update branch for {@link RELEASED}. */
const SELF_BRANCH = `lisa/update-${RELEASED}`;

/**
 * Lisa's own repository: its manifest is `@codyswann/lisa` itself, it pins a
 * published copy of itself, and it tracks work in GitHub Issues.
 * @param installed - The self-dependency currently installed
 * @returns Absolute project root
 */
function lisaRepo(installed: string): string {
  const root = host({ installed });
  writeFileSync(
    path.join(root, MANIFEST),
    JSON.stringify({
      name: LISA,
      version: RELEASED,
      devDependencies: { [LISA]: `^${installed}` },
      engines: { npm: "please-use-bun", bun: "1.3.8" },
    })
  );
  writeFileSync(
    path.join(root, ".lisa.config.json"),
    JSON.stringify({
      tracker: "github",
      github: { org: "CodySwannGT", repo: "lisa" },
      deploy: { branches: { production: "main" } },
    })
  );
  mkdirSync(path.join(root, "scripts"), { recursive: true });
  writeFileSync(path.join(root, "scripts", "lisa-work-item.mjs"), "");
  return root;
}

/**
 * A runner for Lisa's own repository, answering the self-mode questions.
 * @param root - Project root, so the fake bump can update node_modules
 * @param subjects - Commit subjects between the pinned and released tags
 * @returns The runner and the commands it saw
 */
function selfRunner(
  root: string,
  subjects: readonly string[]
): { run: (argv: string[]) => Promise<string>; seen: string[][] } {
  const { run: base, seen } = fakeRunner(root, {
    [ISSUE_CREATE]: `https://github.com/${LISA_REPO}/issues/77`,
  });
  const run = async (argv: string[]): Promise<string> => {
    if (argv[0] === "npm" && argv[1] === "view") {
      seen.push(argv);
      return argv[2] === `@codyswann/lisa@${RELEASED}` ? RELEASED : NEW;
    }
    if (argv[0] === "git" && argv[1] === "log") {
      seen.push(argv);
      return subjects.join("\n");
    }
    if (argv[0] === "bun" && argv[1] === "add") {
      writeFileSync(
        path.join(root, "node_modules", "@codyswann", "lisa", MANIFEST),
        JSON.stringify({ version: RELEASED })
      );
    }
    return base(argv);
  };
  return { run, seen };
}

/**
 * Every command a run made, as single lines.
 * @param seen - Recorded argv arrays
 * @returns Joined command lines
 */
function commandLines(seen: readonly string[][]): string[] {
  return seen.map(argv => argv.join(" "));
}

describe("lisa-self-update: Lisa updating itself", () => {
  it("recognises only Lisa's own manifest as self", () => {
    expect(isSelfManifest({ name: LISA })).toBe(true);
    expect(isSelfManifest({ name: "host" })).toBe(false);
    expect(isSelfManifest(null)).toBe(false);
  });

  it("targets the release main just cut once npm serves it", () => {
    expect(chooseSelfTarget(RELEASED, true, NEW)).toBe(RELEASED);
    expect(chooseSelfTarget(RELEASED, false, NEW)).toBe(NEW);
    expect(chooseSelfTarget(OLD, true, NEW)).toBe(NEW);
    expect(chooseSelfTarget(RELEASED, true, null)).toBe(RELEASED);
    expect(chooseSelfTarget(undefined, false, null)).toBeNull();
  });

  it("treats a release that only carries self-bumps as the same release", () => {
    expect(onlySelfBumps([RELEASE_COMMIT, selfBumpSubject(NEW)])).toBe(true);
    expect(onlySelfBumps([])).toBe(true);
    expect(onlySelfBumps([RELEASE_COMMIT, "fix: something real"])).toBe(false);
    expect(
      onlySelfBumps([`chore(release): ${RELEASED} [skip ci] trailing`])
    ).toBe(false);
  });

  it("files a fresh work item per update, only for GitHub-tracked projects", () => {
    expect(
      workItemLabels({
        tracker: "github",
        github: {
          repo: "lisa",
          labels: { build: { ready: "r", claimed: "c" } },
        },
      })
    ).toEqual({ ready: "r", claimed: "c", repo: "repo:lisa" });
    expect(
      workItemLabels({ tracker: "github", github: { repo: "x" } })
    ).toEqual({
      ready: "status:ready",
      claimed: "status:in-progress",
      repo: "repo:x",
    });
    expect(workItemLabels({ tracker: "jira" })).toBeNull();
    expect(workItemLabels(null)).toBeNull();
    expect(workItemBody({ from: OLD, to: NEW }, true)).toContain(
      "## Acceptance Criteria"
    );
  });

  it("declares the work item in the PR body", () => {
    expect(pullRequestBody({ from: OLD, to: NEW }, FILED, true)).toContain(
      `\nWork-Item: ${FILED}\n`
    );
  });

  it("does not chase the release its own merge cut", async () => {
    const root = lisaRepo(NEW);
    const { run, seen } = selfRunner(root, [
      RELEASE_COMMIT,
      selfBumpSubject(NEW),
    ]);
    const logs: string[] = [];
    await main({
      root,
      repo: LISA_REPO,
      dryRun: false,
      run,
      log: line => logs.push(line),
    });
    const lines = commandLines(seen);
    expect(lines).toContain(
      `git log --no-merges --format=%s v${NEW}..v${RELEASED}`
    );
    expect(lines.some(line => line.startsWith(ISSUE_CREATE))).toBe(false);
    expect(lines.some(line => line.startsWith("git push"))).toBe(false);
    expect(logs.join("\n")).toContain("effectively current");
  });

  it("bumps the self-dependency with a work item and no template apply", async () => {
    const root = lisaRepo(NEW);
    const { run, seen } = selfRunner(root, [
      RELEASE_COMMIT,
      "feat: something that shipped",
    ]);
    await main({ root, repo: LISA_REPO, dryRun: false, run, log: () => {} });
    const lines = commandLines(seen);
    const order = [
      ISSUE_CREATE,
      "gh issue edit 77",
      `git checkout -B ${SELF_BRANCH}`,
      `bun add -D @codyswann/lisa@^${RELEASED}`,
      "git commit",
      `git push --force -u origin ${SELF_BRANCH}`,
      PR_CREATE,
      `node scripts/lisa-work-item.mjs backlink --ref ${FILED} --pr-url ${PR_URL}`,
      `gh pr merge ${PR_URL} --auto --merge`,
    ].map(expected => lines.findIndex(line => line.startsWith(expected)));
    expect(order.every(index => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(lines.some(line => line.includes("dist/index.js"))).toBe(false);
    const commit = seen.find(argv => argv[1] === "commit") ?? [];
    expect(commit[3]).toContain(selfBumpSubject(RELEASED));
    expect(commit[3]).toContain(`Work-Item: ${FILED}`);
    const created =
      seen.find(argv => argv.slice(0, 3).join(" ") === PR_CREATE) ?? [];
    expect(created.at(-1)).toContain(`Work-Item: ${FILED}`);
  });

  it("fails loudly when the bump did not install the target", async () => {
    const root = lisaRepo(NEW);
    const { run: base } = selfRunner(root, ["feat: x"]);
    const run = async (argv: string[]): Promise<string> =>
      argv[0] === "bun" && argv[1] === "add" ? "" : base(argv);
    await expect(
      main({ root, repo: LISA_REPO, dryRun: false, run, log: () => {} })
    ).rejects.toThrow(/installed 4\.66\.5, not 4\.68\.0/u);
  });

  it("reuses an open update PR instead of filing a second work item", async () => {
    const root = lisaRepo(NEW);
    const { run: base, seen } = selfRunner(root, ["feat: x"]);
    const run = async (argv: string[]): Promise<string> => {
      if (
        argv.slice(0, 3).join(" ") === "gh pr list" &&
        !argv.includes("--search")
      ) {
        seen.push(argv);
        return PR_URL;
      }
      return base(argv);
    };
    await main({ root, repo: LISA_REPO, dryRun: false, run, log: () => {} });
    const lines = commandLines(seen);
    expect(lines.some(line => line.startsWith(ISSUE_CREATE))).toBe(false);
    expect(lines.some(line => line.startsWith("git push"))).toBe(false);
    expect(lines).toContain(`gh pr merge ${PR_URL} --auto --merge`);
  });
});
