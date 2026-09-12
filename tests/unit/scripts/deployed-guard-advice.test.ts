/**
 * The check reads DEPLOYED guard copies, which no other control here can see.
 *
 * `parity-safety-net-no-stash-advice.test.ts` proves the repository forbids the
 * advice. This file proves something the repository cannot prove about itself:
 * whether any copy actually serving an agent is still dispensing it. Those are
 * two claims, and only the first was testable before #3998 — which is why the
 * source suite was green on the same day three sessions were told to use the
 * shared stash.
 *
 * ## The empty report is the hazard
 *
 * The healthy state of this sweep is no findings, so a wrong path, an
 * unreadable cache directory, or a channel the resolver does not know about all
 * produce empty and read as clean. Two cases below exist for that alone: an
 * unresolvable channel must come back `NOT_MEASURED`, and the sweep must be
 * shown firing against a copy KNOWN to carry the advice before any empty result
 * from it means anything.
 *
 * ## Why the rejection control uses real bytes
 *
 * The dirty copy is not a fixture string. It is the file as it actually shipped
 * at `7fb401909c^`, taken out of git, because a pattern that has only ever been
 * run against prose someone wrote for it is not evidence about the prose it was
 * written to catch — a mistake this repository has already made once with these
 * exact patterns.
 * @module tests/unit/scripts/deployed-guard-advice
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  FORBIDDEN_ADVISORY_PATTERNS,
  SOURCE_GUARD_ROOTS,
  cacheChannels,
  deployedGuardAdviceExitCode,
  formatDeployedGuardAdviceReport,
  pluginManifestChannel,
  repositoryChannel,
  resolveGuardChannels,
  resolveSourceChannels,
  scanDeployedGuardAdvice,
  sessionChannel,
} from "../../../scripts/deployed-guard-advice.mjs";
import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

/** The guard every scenario here is about. */
const GUARD = "parity-safety-net";

/**
 * The commit BEFORE the fix that removed the advice from source.
 *
 * Its `plugins/lisa/hooks/parity-safety-net.sh` is the real text that shipped
 * to operators, and it carries every one of the outlawed advisory spellings.
 */
const PRE_FIX_TREEISH = "7fb401909c^:plugins/lisa/hooks/parity-safety-net.sh";

/** The vintage stamped on the scratch copies the rejection control reads. */
const PINNED = "2.0.0";

/** Text that names the stash while PROHIBITING it, which must not be reported. */
const PROHIBITION = 'block "git stash drop destroys another worktree\'s entry"';

const temporaries: string[] = [];

afterAll(() => {
  for (const dir of temporaries.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * A scratch directory removed after the suite.
 * @param prefix Name prefix.
 * @returns Absolute path.
 */
function scratch(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  temporaries.push(dir);
  return dir;
}

/**
 * Write a file, creating its parent directories.
 * @param file Absolute path.
 * @param body Contents.
 */
function put(file: string, body: string): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, body);
}

/** The pre-fix guard text, read out of git rather than authored here. */
let preFixGuard = "";

beforeAll(() => {
  const outcome = boundedSpawnSync({
    label: `git show ${PRE_FIX_TREEISH}`,
    command: "git",
    args: ["show", PRE_FIX_TREEISH],
    cwd: REPO_ROOT,
    input: "",
    childMayExitBeforeReading: true,
    maxBuffer: 8 * 1024 * 1024,
  });
  // A missing object must fail loudly. A rejection control that quietly ran
  // against an empty string would pass while proving nothing, which is the
  // exact failure mode this whole file exists to close.
  expect(outcome.status, `could not read ${PRE_FIX_TREEISH}`).toBe(0);
  preFixGuard = outcome.stdout;
  expect(preFixGuard.length).toBeGreaterThan(1000);
});

describe("the rejection control: a copy known to carry the advice", () => {
  it("reports the real pre-fix guard text, by pattern", () => {
    const cache = scratch("lisa-advice-cache-");
    const copy = path.join(cache, "hooks", `${GUARD}.sh`);
    put(copy, preFixGuard);

    const result = scanDeployedGuardAdvice({
      channels: [
        { channel: `cache:${PINNED}`, path: copy, version: PINNED, reason: "" },
      ],
    });

    expect(result.verdict).toBe("OUTLAWED_ADVICE");
    // All four, measured rather than expected: every pattern in the shared
    // list is proved against the bytes that actually shipped.
    expect(
      result.findings
        .map(finding => finding.id)
        .sort((left, right) => left.localeCompare(right))
    ).toEqual([
      "guard-3-old-refusal",
      "guard-4-old-refusal",
      "push-pop-safe-alternative",
      "stash-as-preservation",
    ]);
    expect(result.findings.at(0)?.path).toBe(copy);
    expect(result.findings.at(0)?.version).toBe(PINNED);
    expect(deployedGuardAdviceExitCode(result)).toBe(1);
  });

  it("names the resolved path and vintage in the report an operator reads", () => {
    const cache = scratch("lisa-advice-report-");
    const copy = path.join(cache, "hooks", `${GUARD}.sh`);
    put(copy, preFixGuard);

    const report = formatDeployedGuardAdviceReport(
      scanDeployedGuardAdvice({
        channels: [
          {
            channel: `cache:${PINNED}`,
            path: copy,
            version: PINNED,
            reason: "",
          },
        ],
      })
    );

    expect(report).toContain(copy);
    expect(report).toContain(`lisa ${PINNED}`);
    expect(report).toContain("guard 4's old refusal");
  });

  it("does not report a message that PROHIBITS the stash", () => {
    // The direction that keeps the patterns advisory-shaped: guard 7's own
    // message must keep containing the word while refusing the operation.
    const cache = scratch("lisa-advice-prohibition-");
    const copy = path.join(cache, "hooks", `${GUARD}.sh`);
    put(copy, `#!/bin/bash\n${PROHIBITION}\n`);

    const result = scanDeployedGuardAdvice({
      channels: [
        { channel: "cache:9.9.9", path: copy, version: "9.9.9", reason: "" },
      ],
    });

    expect(result.verdict).toBe("CLEAN");
    expect(result.findings).toEqual([]);
  });
});

describe("the check reads deployed copies, not only source", () => {
  /**
   * A tree whose SOURCE copies are all clean and whose cached deployed copy
   * carries the pre-fix text — the shape of the live defect.
   * @returns The project root and the config directory beside it.
   */
  function cleanSourceDirtyDeploy(): {
    readonly projectDir: string;
    readonly configDir: string;
    readonly deployed: string;
  } {
    const root = scratch("lisa-advice-tree-");
    const projectDir = path.join(root, "project");
    const configDir = path.join(root, "config");
    for (const source of SOURCE_GUARD_ROOTS) {
      put(
        path.join(projectDir, source, `${GUARD}.sh`),
        `#!/bin/bash\n${PROHIBITION}\n`
      );
    }
    const deployed = path.join(
      configDir,
      "plugins",
      "cache",
      "lisa",
      "lisa",
      "4.0.0",
      "hooks",
      `${GUARD}.sh`
    );
    put(deployed, preFixGuard);
    return { projectDir, configDir, deployed };
  }

  it("reports the deployed copy", () => {
    const tree = cleanSourceDirtyDeploy();

    const result = scanDeployedGuardAdvice({
      channels: cacheChannels(tree.configDir, GUARD),
    });

    expect(result.verdict).toBe("OUTLAWED_ADVICE");
    expect(result.findings.map(finding => finding.path)).toContain(
      tree.deployed
    );
    expect(result.findings.at(0)?.version).toBe("4.0.0");
  });

  it("and a source-only scan over the same tree reports nothing", () => {
    const tree = cleanSourceDirtyDeploy();

    const result = scanDeployedGuardAdvice({
      channels: resolveSourceChannels(tree.projectDir, GUARD),
    });

    // Same scanner, same patterns, different copies. That the two answers
    // differ is the gap #3998 closes, stated as two numbers.
    expect(result.verdict).toBe("CLEAN");
    expect(result.findings).toEqual([]);
    expect(result.examinedCount).toBe(SOURCE_GUARD_ROOTS.length);
  });
});

describe("an unresolvable copy is an unanswered question", () => {
  it("returns NOT_MEASURED for a channel with no readable copy", () => {
    const result = scanDeployedGuardAdvice({
      channels: cacheChannels(scratch("lisa-advice-bare-"), GUARD),
    });

    expect(result.verdict).toBe("NOT_MEASURED");
    expect(result.notMeasured.at(0)?.reason).toBe("cache-directory-unreadable");
    expect(deployedGuardAdviceExitCode(result)).toBe(2);
  });

  it("returns NOT_MEASURED when the session declares no plugin root", () => {
    const result = scanDeployedGuardAdvice({
      channels: [sessionChannel(undefined, GUARD)],
    });

    expect(result.verdict).toBe("NOT_MEASURED");
    expect(result.notMeasured.at(0)).toEqual({
      channel: "session",
      reason: "plugin-root-not-declared",
    });
  });

  it("returns NOT_MEASURED when the roster itself is unavailable", () => {
    const result = scanDeployedGuardAdvice({});

    expect(result.verdict).toBe("NOT_MEASURED");
    expect(result.examinedCount).toBe(0);
  });

  it("keeps a real finding visible beside an unreadable channel", () => {
    // Blindness outranks findings for the VERDICT, but a finding does not stop
    // mattering because some other channel could not be read.
    const cache = scratch("lisa-advice-mixed-");
    const copy = path.join(cache, "hooks", `${GUARD}.sh`);
    put(copy, preFixGuard);

    const result = scanDeployedGuardAdvice({
      channels: [
        { channel: `cache:${PINNED}`, path: copy, version: PINNED, reason: "" },
        sessionChannel(undefined, GUARD),
      ],
    });

    expect(result.verdict).toBe("NOT_MEASURED");
    expect(result.findings.length).toBeGreaterThan(0);
    expect(formatDeployedGuardAdviceReport(result)).toContain(copy);
  });
});

describe("channel resolution", () => {
  it("is first-wins: an applied host tree shadows the plugin tree", () => {
    const projectDir = path.join(scratch("lisa-advice-first-"), "project");
    put(
      path.join(projectDir, "scripts", "lisa-hooks", `${GUARD}.sh`),
      "#!/bin/bash\n"
    );
    put(
      path.join(projectDir, "plugins", "lisa", "hooks", `${GUARD}.sh`),
      "#!/bin/bash\n"
    );
    put(
      path.join(projectDir, ".lisa", "apply-receipt.json"),
      JSON.stringify({ lisa_version: "4.10.0" })
    );

    const channel = repositoryChannel(projectDir, GUARD);

    expect(channel.path).toContain(path.join("scripts", "lisa-hooks"));
    expect(channel.version).toBe("4.10.0");
  });

  it("keys the plugin channel on the PROJECT directory, not the machine", () => {
    const root = scratch("lisa-advice-record-");
    const mine = path.join(root, "mine");
    const theirs = path.join(root, "theirs");
    const configDir = path.join(root, "config");
    put(
      path.join(configDir, "plugins", "installed_plugins.json"),
      JSON.stringify({
        plugins: {
          "lisa@lisa": [
            {
              projectPath: theirs,
              installPath: path.join(root, "cache", "lisa", "lisa", "4.47.0"),
              version: "4.47.0",
            },
            {
              projectPath: mine,
              installPath: path.join(root, "cache", "lisa", "lisa", "4.10.0"),
              version: "4.10.0",
            },
          ],
        },
      })
    );

    const channel = pluginManifestChannel(configDir, mine, GUARD);

    expect(channel.version).toBe("4.10.0");
    expect(channel.path).toContain(path.join("lisa", "lisa", "4.10.0"));
  });

  it("leaves the plugin channel unresolved rather than clean when unrecorded", () => {
    const configDir = path.join(scratch("lisa-advice-norecord-"), "config");

    const channel = pluginManifestChannel(configDir, "/nowhere", GUARD);

    expect(channel.path).toBe("");
    expect(channel.reason).toBe("install-record-unreadable");
  });

  it("names every channel a guard can be served from", () => {
    const root = scratch("lisa-advice-roster-");

    const names = resolveGuardChannels({
      projectDir: path.join(root, "project"),
      configDir: path.join(root, "config"),
      guard: GUARD,
    }).map(channel => channel.channel);

    expect(names).toEqual([
      "repository",
      "plugin-manifest",
      "session",
      "marketplace",
      "cache",
    ]);
  });
});

describe("one pattern list, cited by both scans", () => {
  it("exports the advisory patterns the source suite also uses", () => {
    // Two lists drift, and the drift is invisible: the source suite would stay
    // green against patterns this sweep no longer looks for.
    expect(FORBIDDEN_ADVISORY_PATTERNS.length).toBeGreaterThan(0);
    for (const entry of FORBIDDEN_ADVISORY_PATTERNS) {
      expect(entry.id).toMatch(/^[a-z0-9-]+$/);
      expect(entry.pattern).toBeInstanceOf(RegExp);
      expect(entry.why.length).toBeGreaterThan(0);
    }
  });

  it("matches the pre-fix bytes and not the shipped ones", () => {
    // Both directions, on real text. A pattern that matches everything and a
    // pattern that matches nothing are equally worthless, and only running it
    // against both vintages separates them.
    const shipped = scanDeployedGuardAdvice({
      channels: resolveSourceChannels(REPO_ROOT, GUARD),
    });

    expect(shipped.verdict).toBe("CLEAN");
    expect(shipped.examinedCount).toBe(SOURCE_GUARD_ROOTS.length);
    expect(
      FORBIDDEN_ADVISORY_PATTERNS.filter(entry =>
        entry.pattern.test(preFixGuard)
      ).length
    ).toBeGreaterThan(0);
  });
});

describe("the live sweep over this machine's own channels", () => {
  const configDir =
    process.env.CLAUDE_CONFIG_DIR ??
    path.join(process.env.HOME ?? "", ".claude");

  it("answers about every channel it resolves, or says it could not", () => {
    const result = scanDeployedGuardAdvice({
      channels: resolveGuardChannels({
        projectDir: REPO_ROOT,
        configDir,
        pluginRoot: process.env.CLAUDE_PLUGIN_ROOT,
        guard: GUARD,
      }),
    });

    // Report-only, so no verdict is asserted: on a host with no harness
    // configuration every channel is legitimately unresolvable. What IS
    // asserted is that the sweep accounted for each one — a channel that is
    // neither read nor reported unread is the silent gap this file closes.
    expect(result.examinedCount + result.notMeasured.length).toBeGreaterThan(0);
    expect(result.reportOnly).toBe(true);
    expect(deployedGuardAdviceExitCode(result)).toBe(
      result.verdict === "CLEAN"
        ? 0
        : result.verdict === "OUTLAWED_ADVICE"
          ? 1
          : 2
    );
  });
});
