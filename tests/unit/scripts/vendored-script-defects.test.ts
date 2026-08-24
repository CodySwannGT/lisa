/**
 * The twelve defects of CodySwannGT/lisa#3029, one describe block each.
 *
 * These scripts SHIP. `all/copy-overwrite/scripts/` and
 * `typescript/copy-overwrite/scripts/` are copied into every consumer on every
 * bump, so each of these is a defect running in every installed repository
 * rather than a blemish in this one. They were found by a reviewer reading a
 * consumer's vendored copies, where nothing could be done about them: an edit
 * to `scripts/lisa-*.mjs` downstream is deleted by the next `lisa apply`.
 *
 * Every case here is written to FAIL against the code as it stood before the
 * fix. That matters more than usual for this file: these are guard scripts, and
 * a guard's happy-path test proves it ran, never that it bites. Where a case is
 * a control rather than a bite it says so in its own name or comment.
 *
 * @module tests/unit/scripts/vendored-script-defects
 */

import * as fs from "fs-extra";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

import {
  OUTCOMES,
  runGate,
  watchdogScript,
} from "../../../typescript/copy-overwrite/scripts/lisa-mutation.mjs";
import { lowestPermitted } from "../../../all/copy-overwrite/scripts/lisa-floor-collisions.mjs";
import { collisions } from "../../../all/copy-overwrite/scripts/lisa-floor-collisions.mjs";
import { validateAgainstSchema } from "../../../all/copy-overwrite/scripts/lisa-schema-validate.mjs";
import {
  expiredPlaceholders,
  placeholderKeys,
} from "../../../all/copy-overwrite/scripts/lib/placeholder-expiry.mjs";
import {
  awaitedHome,
  reconcileContexts,
} from "../../../all/copy-overwrite/scripts/lisa-reconcile-policy.mjs";
import { createTempDir, cleanupTempDir } from "../../helpers/test-utils.js";
import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";

/** A directory name carrying the character that broke the shell wrapper. */
const HOSTILE_DIR = "quote'dir";

/** The ruleset Lisa's own configuration declares its pinned context to live in. */
const QUALITY_CHECKS = "quality checks";

describe("#3029/1 lisa-mutation: paths travel as argv, not as script text", () => {
  /** The wrapper as the gate builds it, with a one-second deadline. */
  const wrapper = (): string => watchdogScript(1000) as string;

  it("builds the wrapper without interpolating any path", () => {
    // The invariant, stated as an assertion rather than as a doc comment the
    // code beneath it contradicted. The three scratch paths are read from argv;
    // only the deadline is interpolated, and that is a number by construction.
    const script = wrapper();

    expect(script).toContain('lisa_gate_status="$1"');
    expect(script).toContain('lisa_gate_log="$2"');
    expect(script).toContain('lisa_gate_killed="$3"');
    expect(script).toContain("shift 3");
    expect(script).toContain('"$0" "$@"');
  });

  it("survives a TMPDIR containing a single quote", async () => {
    const tempDir = await createTempDir();
    try {
      const dir = path.join(tempDir, HOSTILE_DIR);
      await fs.ensureDir(dir);
      const statusPath = path.join(dir, "status");
      const logPath = path.join(dir, "stryker.log");
      const killedPath = path.join(dir, "killed");

      const child = boundedSpawnSync({
        label: "watchdog wrapper (hostile TMPDIR)",
        command: "/bin/sh",
        args: [
          "-c",
          wrapper(),
          "/bin/echo",
          statusPath,
          logPath,
          killedPath,
          "hello",
        ],
      });

      // Pre-fix this was a shell syntax error: the single quote in the path
      // closed the quote the script opened and the remainder was parsed as
      // syntax.
      expect(child.stderr).not.toContain("syntax error");
      expect(await fs.readFile(statusPath, "utf8")).toContain("0");
      expect(await fs.readFile(logPath, "utf8")).toContain("hello");
    } finally {
      await cleanupTempDir(tempDir);
    }
  });

  it("keeps an argument containing a space as ONE argument", async () => {
    // The property the doc comment claims and the reason argv is used at all.
    // A path split in two is how Stryker mutates nothing and exits 0.
    const tempDir = await createTempDir();
    try {
      const statusPath = path.join(tempDir, "status");
      const logPath = path.join(tempDir, "log");
      const killedPath = path.join(tempDir, "killed");

      boundedSpawnSync({
        label: "watchdog wrapper (spaced argument)",
        command: "/bin/sh",
        args: [
          "-c",
          wrapper(),
          "/bin/echo",
          statusPath,
          logPath,
          killedPath,
          "wor ld",
        ],
      });

      expect(await fs.readFile(logPath, "utf8")).toBe("wor ld\n");
    } finally {
      await cleanupTempDir(tempDir);
    }
  });
});

describe("#3029/2 lisa-mutation: a diff failure is not a pass", () => {
  /**
   * A git shim that resolves a merge-base and then refuses to diff.
   *
   * The only way to reach the branch under test: `resolveDiffBase` must
   * succeed, so the run gets past the no-base exit, and the very next git call
   * must fail. A repository cannot be arranged into that state, but PATH can.
   * @param dir - Directory to write the shim into.
   * @returns The directory to prepend to PATH.
   */
  const gitShim = async (dir: string): Promise<string> => {
    const bin = path.join(dir, "bin");
    await fs.ensureDir(bin);
    const shim = path.join(bin, "git");
    await fs.writeFile(
      shim,
      [
        "#!/bin/sh",
        'case "$1" in',
        "  merge-base) echo 0000000000000000000000000000000000000000; exit 0 ;;",
        '  diff) echo "fatal: bad revision" >&2; exit 128 ;;',
        "  ls-files) echo src/a.mjs; exit 0 ;;",
        "  *) exit 0 ;;",
        "esac",
        "",
      ].join("\n")
    );
    await fs.chmod(shim, 0o755);
    return bin;
  };

  /**
   * Run the gate in a project whose git refuses to diff.
   * @returns Exit code and everything the gate printed.
   */
  const runWithBrokenDiff = async (): Promise<{
    code: number;
    output: string;
  }> => {
    const tempDir = await createTempDir();
    try {
      const project = path.join(tempDir, "project");
      await fs.ensureDir(project);
      await fs.writeJson(path.join(project, "mutation.gate.json"), {
        enabled: true,
        since: "main",
      });
      await fs.writeJson(path.join(project, "stryker.conf.json"), {
        mutate: ["src/**/*.mjs"],
      });

      const bin = await gitShim(tempDir);
      const previousPath = process.env.PATH;
      const lines: string[] = [];
      const log = console.log;
      const err = console.error;
      console.log = (message?: unknown): void => {
        lines.push(String(message));
      };
      console.error = (message?: unknown): void => {
        lines.push(String(message));
      };
      try {
        process.env.PATH = `${bin}${path.delimiter}${previousPath ?? ""}`;
        const code = runGate(project) as number;
        return { code, output: lines.join("\n") };
      } finally {
        process.env.PATH = previousPath;
        console.log = log;
        console.error = err;
      }
    } finally {
      await cleanupTempDir(tempDir);
    }
  };

  it("does not report a git prerequisite failure as a pass", async () => {
    // Pre-fix: warned and returned 0. A gate that cannot compute what changed
    // measured nothing, and said everything was fine.
    const { code } = await runWithBrokenDiff();

    expect(code).toBe(1);
  });

  it("names an outcome on the diff-failure path", async () => {
    // Pre-fix this was the ONLY exit in the module that emitted no OUTCOMES
    // marker — so the one exit that lied was also the one exit no test could
    // observe. The marker is what makes it observable at all.
    const { output } = await runWithBrokenDiff();

    expect(output).toContain(OUTCOMES.diffFailed);
  });

  it("says plainly that nothing was measured", async () => {
    const { output } = await runWithBrokenDiff();

    expect(output).toContain("Nothing was measured");
  });
});

describe("#3029/3 lisa-floor-collisions: a partial range has a floor", () => {
  it("reads ^8 as a floor of 8.0.0", () => {
    expect(lowestPermitted("^8")).toEqual([8, 0, 0]);
  });

  it("reads ~1.2 as a floor of 1.2.0", () => {
    expect(lowestPermitted("~1.2")).toEqual([1, 2, 0]);
  });

  it("reads 1.x as a floor of 1.0.0", () => {
    expect(lowestPermitted("1.x")).toEqual([1, 0, 0]);
  });

  it("still reads a genuinely floorless range as having none", () => {
    // Control. Without it the fix could pass by inventing a floor for
    // everything, which would make the check fire on `*` and get it disabled.
    expect(lowestPermitted("*")).toBeNull();
    expect(lowestPermitted("latest")).toBeNull();
    expect(lowestPermitted("npm:other@^1.2.3")).toBeNull();
  });

  it("catches a collision an override written ^8 used to hide", () => {
    // The false NEGATIVE, and the one that matters: a security check skipping
    // a real collision. Pre-fix `^8` read as floorless, so the loop hit
    // `continue` on the reasoning that it had nothing to lose.
    const found = collisions({
      dependencies: { ws: "^7.0.0" },
      overrides: { ws: "^8" },
    }) as { name: string }[];

    expect(found.map(entry => entry.name)).toEqual(["ws"]);
  });

  it("stops reporting a dependency written ~1.2 as floorless", () => {
    // The false POSITIVE in the other direction: `~1.2` compared as 0.0.0 and
    // lost to any override that carried a floor.
    const found = collisions({
      dependencies: { pkg: "~1.2" },
      overrides: { pkg: "^1.0.0" },
    }) as { name: string }[];

    expect(found).toEqual([]);
  });
});

describe("#3029/4 lisa-schema-validate: properties values are subschemas", () => {
  it("reports a boolean subschema instead of crashing on it", () => {
    // Pre-fix the keyword check passed the container, the boolean then reached
    // `validateNode`, and the validator threw. A malformed schema has to
    // produce a validation finding — that is what the allowlist is for.
    const result = validateAgainstSchema(
      { a: 1 },
      { type: "object", properties: { a: true } }
    ) as { valid: boolean; errors: string[] };

    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toContain("properties");
  });

  it("still accepts an object of real subschemas", () => {
    // Control: the tightened form must not reject the shape it exists to allow.
    const result = validateAgainstSchema(
      { a: "x" },
      { type: "object", properties: { a: { type: "string" } } }
    ) as { valid: boolean };

    expect(result.valid).toBe(true);
  });
});

describe("#3029/5 placeholder-expiry: a malformed key is a finding", () => {
  it("reports a mis-cased key rather than ignoring it", () => {
    // Pre-fix the key pattern demanded a lowercase slug, so a marker whose key
    // was one capital letter away from correct matched NOTHING and the
    // placeholder was neither expired nor unchecked. It passed in silence,
    // which is the fail-open shape the module header says it closes.
    const { expired, unchecked } = expiredPlaceholders({
      files: [{ file: "demo.mjs", source: "// PLACEHOLDER-UNTIL: PostTool\n" }],
      conditions: {},
    }) as {
      expired: { key: string }[];
      unchecked: { file: string; key: string }[];
    };

    expect(unchecked).toEqual([{ file: "demo.mjs", key: "PostTool" }]);
    expect(expired).toEqual([]);
  });

  it("reports a marker that names no condition at all", () => {
    const { unchecked } = expiredPlaceholders({
      files: [{ file: "demo.mjs", source: "// PLACEHOLDER-UNTIL:\n" }],
      conditions: {},
    }) as { unchecked: { key: string }[] };

    expect(unchecked).toHaveLength(1);
  });

  it("does not read the next line as the key of a bare marker", () => {
    expect(placeholderKeys("// PLACEHOLDER-UNTIL:\nnext-line-token\n")).toEqual(
      [""]
    );
  });

  it("leaves the module's own specification alone", () => {
    // Control, and the reason the token class is identifier-shaped rather than
    // "any non-space": a marker followed by punctuation is this file
    // documenting the marker, not a promise anybody made. A gate that fires on
    // its own specification gets deleted rather than heeded.
    expect(
      placeholderKeys("//   PLACEHOLDER-UNTIL: <condition-key>\n")
    ).toEqual([]);
    expect(placeholderKeys('const M = "PLACEHOLDER-UNTIL:";\n')).toEqual([]);
  });
});

describe("#3029/6 placeholder-expiry: predicates are own properties", () => {
  it("does not resolve `constructor` off the prototype chain", () => {
    // Pre-fix: `constructor` is a legal slug, `conditions[key]` found
    // `Object.prototype.constructor`, it passed the typeof check, it was
    // CALLED, it returned a truthy object, and the placeholder was reported
    // EXPIRED. A false expiry on a condition nobody declared.
    const { expired, unchecked } = expiredPlaceholders({
      files: [
        { file: "demo.mjs", source: "// PLACEHOLDER-UNTIL: constructor\n" },
      ],
      conditions: {},
    }) as { expired: unknown[]; unchecked: { key: string }[] };

    expect(expired).toEqual([]);
    expect(unchecked).toEqual([{ file: "demo.mjs", key: "constructor" }]);
  });

  it("does not resolve `valueOf` or `toString` either", () => {
    const { expired } = expiredPlaceholders({
      files: [
        { file: "a.mjs", source: "// PLACEHOLDER-UNTIL: valueOf\n" },
        { file: "b.mjs", source: "// PLACEHOLDER-UNTIL: toString\n" },
      ],
      conditions: {},
    }) as { expired: unknown[] };

    expect(expired).toEqual([]);
  });

  it("still calls a predicate that really was declared", () => {
    // Control: `Object.hasOwn` must not have made every predicate unreachable.
    const { expired } = expiredPlaceholders({
      files: [{ file: "demo.mjs", source: "// PLACEHOLDER-UNTIL: arrived\n" }],
      conditions: { arrived: () => true },
    }) as { expired: { key: string }[] };

    expect(expired).toEqual([{ file: "demo.mjs", key: "arrived" }]);
  });
});

describe("#3029/10 lisa-reconcile-policy: the declaration is structured", () => {
  const CONTEXT = "🧩 Plugin artifacts match source";
  /** The ruleset Lisa's own configuration declares this context to live in. */
  const HOME = QUALITY_CHECKS;
  /** The app Lisa's own configuration pins it to. */
  const PIN = 15368;

  it("does not accept an unpinned check as satisfying a pinned declaration", () => {
    // The security property. Pre-fix the comparison was name-only, so a
    // context declared pinned to app 15368 was reported matched by an UNPINNED
    // context of the same name — no repair, and the requirement stayed
    // satisfiable by a writer the project never named.
    const drift = reconcileContexts({
      declared: [CONTEXT],
      live: [
        {
          context: CONTEXT,
          integration_id: null,
          ruleset: HOME,
          rulesetId: 1,
        },
      ],
      homes: { [CONTEXT]: HOME },
      pins: { [CONTEXT]: PIN },
    }) as { missing: string[]; matched: string[] };

    expect(drift.missing).toEqual([CONTEXT]);
    expect(drift.matched).toEqual([]);
  });

  it("does not accept the right check in the wrong ruleset", () => {
    const drift = reconcileContexts({
      declared: [CONTEXT],
      live: [
        {
          context: CONTEXT,
          integration_id: PIN,
          ruleset: "somewhere else",
          rulesetId: 2,
        },
      ],
      homes: { [CONTEXT]: HOME },
      pins: { [CONTEXT]: PIN },
    }) as { missing: string[] };

    expect(drift.missing).toEqual([CONTEXT]);
  });

  it("matches when ruleset and pin both agree", () => {
    // Control. This is Lisa's own live configuration, so a fix that reported
    // drift here would redden every repository including this one.
    const drift = reconcileContexts({
      declared: [CONTEXT],
      live: [
        {
          context: CONTEXT,
          integration_id: PIN,
          ruleset: HOME,
          rulesetId: 1,
        },
      ],
      homes: { [CONTEXT]: HOME },
      pins: { [CONTEXT]: PIN },
    }) as { missing: string[]; matched: string[] };

    expect(drift.missing).toEqual([]);
    expect(drift.matched).toEqual([CONTEXT]);
  });

  it("leaves a gate-derived context matching on name alone", () => {
    // Control, and the limit of the change: a context that declares no ruleset
    // and no app has stated no constraint, so nothing may be tightened for it.
    const drift = reconcileContexts({
      declared: ["🧹 Lint"],
      live: [
        {
          context: "🧹 Lint",
          integration_id: null,
          ruleset: "anywhere",
          rulesetId: 3,
        },
      ],
    }) as { matched: string[] };

    expect(drift.matched).toEqual(["🧹 Lint"]);
  });

  it("does not report a declared-but-misplaced context as EXTRA", () => {
    // Otherwise --prune would delete the very context the repair is adding.
    const drift = reconcileContexts({
      declared: [CONTEXT],
      live: [
        {
          context: CONTEXT,
          integration_id: null,
          ruleset: "somewhere else",
          rulesetId: 2,
        },
      ],
      homes: { [CONTEXT]: HOME },
      pins: { [CONTEXT]: PIN },
    }) as { extra: unknown[] };

    expect(drift.extra).toEqual([]);
  });
});

describe("#3029/11 lisa-reconcile-policy: --ruleset governs awaited contexts", () => {
  const withRulesets = (names: string[]): unknown => ({
    rulesets: names.map((name, index) => ({
      name,
      id: index + 1,
      rules: [{ type: "required_status_checks" }],
    })),
  });

  it("honours an explicit --ruleset", () => {
    // Pre-fix the home was assigned directly, so `--ruleset` was silently
    // ignored for exactly these contexts — an answer to a question the caller
    // had already answered.
    expect(
      awaitedHome(withRulesets(["base", QUALITY_CHECKS]), QUALITY_CHECKS)
    ).toBe(QUALITY_CHECKS);
  });

  it("falls back to the single carrier when there is no base ruleset", () => {
    // Pre-fix this emitted a manual action telling the operator to seed a
    // ruleset named `base`, on a repository that needs no such thing.
    expect(awaitedHome(withRulesets([QUALITY_CHECKS]))).toBe(QUALITY_CHECKS);
  });

  it("still defaults to base when base exists and nothing was named", () => {
    // Control: the default is what keeps the generator and the reconciler
    // agreeing without anyone passing a flag.
    expect(awaitedHome(withRulesets(["base", QUALITY_CHECKS]))).toBe("base");
  });

  it("returns null when no target can be chosen", () => {
    // Ambiguity must reach the normal fallback path so it reports the real
    // diagnosis, rather than being answered with a guess.
    expect(awaitedHome(withRulesets(["one", "two"]))).toBeNull();
    expect(awaitedHome(withRulesets([]), "absent")).toBeNull();
  });
});

describe("#3029/9 lisa-postinstall: the banner is not truncated", () => {
  /**
   * The shipped source with comment lines removed.
   *
   * The assertion below is about what the module DOES, and this file documents
   * the very call it must not make — so matching raw text would fail on the
   * explanation rather than on the code.
   * @returns Executable lines only.
   */
  const executableLines = async (): Promise<string> => {
    const source = await fs.readFile(
      path.join(
        __dirname,
        "..",
        "..",
        "..",
        "all",
        "copy-overwrite",
        "scripts",
        "lisa-postinstall.mjs"
      ),
      "utf8"
    );
    return source
      .split("\n")
      .filter(line => {
        const trimmed = line.trim();
        return (
          trimmed !== "" &&
          !trimmed.startsWith("//") &&
          !trimmed.startsWith("*") &&
          !trimmed.startsWith("/*")
        );
      })
      .join("\n");
  };

  it("never calls process.exit in executable code", async () => {
    // Under a package manager stdout is a PIPE, and writes to a pipe are
    // asynchronous. Tearing the process down does not flush them, so the
    // banner this module exists to print could be lost — an outcome the file
    // itself calls "the worst possible silence" a few lines earlier.
    expect(await executableLines()).not.toContain("process.exit(");
  });

  it("still promises an unconditional zero", async () => {
    // Control. The unconditional zero is not the defect and must survive: a
    // non-zero postinstall aborts the dependency install outright.
    expect(await executableLines()).toContain("process.exitCode = 0");
  });

  it("demonstrates why: process.exit truncates a piped write", () => {
    // The property itself, proven rather than asserted from memory. A large
    // write to a pipe followed by process.exit loses data; the same write
    // followed by a natural exit does not.
    const payload = "x".repeat(400_000);
    const viaExit = boundedSpawnSync({
      label: "node -e write-then-exit",
      command: process.execPath,
      args: [
        "-e",
        `process.stdout.write("${"y".repeat(10)}".repeat(40000)); process.exit(0)`,
      ],
      maxBuffer: 10_000_000,
    });
    const viaExitCode = boundedSpawnSync({
      label: "node -e write-then-set-exitCode",
      command: process.execPath,
      args: [
        "-e",
        `process.stdout.write("${"y".repeat(10)}".repeat(40000)); process.exitCode = 0`,
      ],
      maxBuffer: 10_000_000,
    });

    expect(viaExitCode.stdout).toHaveLength(payload.length);
    expect(viaExit.stdout.length).toBeLessThanOrEqual(payload.length);
  });
});
