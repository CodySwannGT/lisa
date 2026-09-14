import * as fs from "fs-extra";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  boundedSpawnSync,
  useIoLatencyBudget,
} from "../helpers/io-latency-budget.js";

const root = fileURLToPath(new URL("../../", import.meta.url));
const runner = path.join(root, "all/copy-overwrite/scripts/lisa-run-gates.mjs");
const hook = path.join(
  root,
  "typescript/copy-overwrite/.claude/hooks/worktree-create.sh"
);
const PACKAGE_FILE = "package.json";
const ROOT_LIFECYCLE = "root lifecycle";
const INSTALLED_PARENT = "installed parent";
const PARENT_MESSAGE = "parent checkout";
const PUSH_FLAG = "--moment=push";
const DEPENDENCY_PATH = "node_modules/parent-only/index.js";

/**
 * Execute only inside the owned fixture, without shell startup or Git identity inheritance.
 * @param cwd - Fixture directory.
 * @param command - Executable.
 * @param args - Argument vector.
 * @param input - Optional hook payload.
 * @returns Captured process result.
 */
function run(cwd: string, command: string, args: string[], input?: string) {
  return boundedSpawnSync({
    label: "worktree dependency boundary fixture",
    command,
    args,
    cwd,
    ...(input === undefined ? {} : { input }),
    env: {
      PATH: process.env.PATH,
      HOME: cwd,
      BASH_ENV: "/dev/null",
      ENV: "/dev/null",
    },
  });
}

/**
 * Create real linked worktrees with an observable parent-only dependency.
 * @returns Owned fixture paths.
 */
async function fixture() {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "lisa-worktree-deps-"));
  const primary = path.join(temp, "primary");
  const nested = path.join(primary, ".claude/worktrees/nested");
  const isolated = path.join(temp, "isolated");
  const dependency = path.join(primary, DEPENDENCY_PATH);
  await fs.ensureDir(primary);
  expect(run(primary, "git", ["init", "-q", "-b", "main"]).status).toBe(0);
  await fs.writeJson(path.join(primary, PACKAGE_FILE), {
    name: "fixture",
    private: true,
    scripts: { fixture: "node -e \"require('parent-only')\"" },
  });
  await fs.writeJson(path.join(primary, ".lisa.config.json"), {
    gates: {
      ...Object.fromEntries(
        [
          "coverage-adequacy",
          "dependency-vulnerability",
          "test-correctness",
          "test-integration",
          "traceability",
          "type-correctness",
        ].map(name => [name, { push: { level: "off" } }])
      ),
      "x-fixture": { push: { level: "required", run: "fixture" } },
    },
  });
  expect(run(primary, "git", ["add", "."]).status).toBe(0);
  expect(
    run(primary, "git", [
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "commit",
      "-qm",
      "fixture",
    ]).status
  ).toBe(0);
  expect(
    run(
      primary,
      "/bin/sh",
      [hook],
      JSON.stringify({ cwd: primary, name: "nested" })
    )
  ).toMatchObject({ status: 0, stdout: `${nested}\n` });
  expect(
    run(primary, "git", ["worktree", "add", "-q", "-b", "isolated", isolated])
      .status
  ).toBe(0);
  await fs.outputFile(
    dependency,
    "process.stdout.write('PARENT_DEPENDENCY_EXECUTED');\n"
  );
  return { temp, primary, nested, isolated };
}

describe("nested worktree dependency boundary", () => {
  useIoLatencyBudget();

  it("names the parent dependency condition before a gate runs", async () => {
    const f = await fixture();
    try {
      const reproduction = run(f.nested, process.execPath, [
        "-e",
        "require('parent-only')",
      ]);
      expect(reproduction.stdout).toContain("PARENT_DEPENDENCY_EXECUTED");
      const result = run(f.nested, process.execPath, [runner, PUSH_FLAG]);
      expect(result.status).not.toBe(0);
      expect(String(result.stdout) + String(result.stderr)).toContain(
        PARENT_MESSAGE
      );
      expect(String(result.stdout) + String(result.stderr)).toContain(
        "not evidence of a defect"
      );
      expect(result.stdout).not.toContain("PARENT_DEPENDENCY_EXECUTED");
    } finally {
      await fs.remove(f.temp);
    }
  });

  it.each(["primary", "nested", "isolated"] as const)(
    "runs the gate normally in %s with its own dependencies",
    async kind => {
      const f = await fixture();
      try {
        await fs.outputFile(
          path.join(f[kind], DEPENDENCY_PATH),
          "process.stdout.write('OWN_DEPENDENCY_EXECUTED');\n"
        );
        const result = run(f[kind], process.execPath, [runner, PUSH_FLAG]);
        expect(
          result.status,
          String(result.stdout) + String(result.stderr)
        ).toBe(0);
        expect(result.stdout).toContain("OWN_DEPENDENCY_EXECUTED");
      } finally {
        await fs.remove(f.temp);
      }
    }
  );

  it("leaves an isolated checkout's normal missing-dependency error intact", async () => {
    const f = await fixture();
    try {
      const result = run(f.isolated, process.execPath, [runner, PUSH_FLAG]);
      expect(result.status).not.toBe(0);
      expect(String(result.stdout) + String(result.stderr)).toContain(
        "Cannot find module 'parent-only'"
      );
      expect(String(result.stdout) + String(result.stderr)).not.toContain(
        PARENT_MESSAGE
      );
    } finally {
      await fs.remove(f.temp);
    }
  });

  it("refuses the managed knip command before it launches a parent-only binary", async () => {
    const f = await fixture();
    const template = (await fs.readJson(
      path.join(root, "typescript/package-lisa/package.lisa.json")
    )) as { force: { scripts: Record<string, string> } };
    const manifest = path.join(f.nested, PACKAGE_FILE);
    try {
      await fs.outputFile(
        path.join(f.primary, "node_modules/.bin/knip"),
        "#!/bin/sh\necho PARENT_KNIP_EXECUTED\n",
        { mode: 0o755 }
      );
      await fs.writeJson(manifest, { scripts: { "knip:check": "knip" } });
      expect(
        run(f.nested, "npm", ["run", "--silent", "knip:check"]).stdout
      ).toContain("PARENT_KNIP_EXECUTED");
      await fs.copy(
        path.join(
          root,
          "all/copy-overwrite/scripts/lib/worktree-dependencies.mjs"
        ),
        path.join(f.nested, "scripts/lib/worktree-dependencies.mjs")
      );
      await fs.copy(
        path.join(root, "all/copy-overwrite/scripts/lib/invoked-as-script.mjs"),
        path.join(f.nested, "scripts/lib/invoked-as-script.mjs")
      );
      await fs.writeJson(manifest, {
        scripts: { "knip:check": template.force.scripts["knip:check:lisa"] },
      });
      const result = run(f.nested, "npm", ["run", "--silent", "knip:check"]);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain(PARENT_MESSAGE);
      expect(result.stdout).not.toContain("PARENT_KNIP_EXECUTED");
    } finally {
      await fs.remove(f.temp);
    }
  });

  it("refuses the public test launcher before starting its payload", async () => {
    const f = await fixture();
    try {
      const result = run(f.nested, process.execPath, [
        path.join(root, "dist/cli/lisa-test-run.js"),
        "--profile",
        "typescript",
        "--adapter",
        "direct",
        "--",
        process.execPath,
        "-e",
        "console.log('PAYLOAD_EXECUTED')",
      ]);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain(PARENT_MESSAGE);
      expect(result.stdout).not.toContain("PAYLOAD_EXECUTED");
    } finally {
      await fs.remove(f.temp);
    }
  });

  it.each([INSTALLED_PARENT, "uninstalled parent"])(
    "detects a worktree nested inside an %s",
    async kind => {
      const f = await fixture();
      const parent = kind === INSTALLED_PARENT ? f.isolated : f.nested;
      const nested = path.join(parent, ".claude/worktrees/grandchild");
      try {
        await fs.outputFile(
          path.join(
            kind === INSTALLED_PARENT ? parent : f.primary,
            DEPENDENCY_PATH
          ),
          "console.log('BORROWED_FROM_LINKED_PARENT');\n"
        );
        expect(
          run(
            parent,
            "/bin/sh",
            [hook],
            JSON.stringify({ cwd: parent, name: "grandchild" })
          ).status
        ).toBe(0);
        expect(
          run(nested, process.execPath, ["-e", "require('parent-only')"]).stdout
        ).toContain("BORROWED_FROM_LINKED_PARENT");
        const result = run(nested, process.execPath, [runner, PUSH_FLAG]);
        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain(PARENT_MESSAGE);
      } finally {
        await fs.remove(f.temp);
      }
    }
  );

  it.each([ROOT_LIFECYCLE, "phaser build"])(
    "checks before %s can launch build tools",
    async kind => {
      const f = await fixture();
      const source =
        kind === ROOT_LIFECYCLE
          ? PACKAGE_FILE
          : "phaser/package-lisa/package.lisa.json";
      const manifest = (await fs.readJson(path.join(root, source))) as {
        scripts: Record<string, string>;
        defaults: { scripts: Record<string, string> };
      };
      const scripts =
        kind === ROOT_LIFECYCLE
          ? {
              ...manifest.scripts,
              test: "node -e \"console.log('UNEXPECTED_TEST')\"",
            }
          : manifest.defaults.scripts;
      try {
        await fs.writeJson(path.join(f.nested, PACKAGE_FILE), { scripts });
        for (const name of [
          "worktree-dependencies.mjs",
          "invoked-as-script.mjs",
        ]) {
          await fs.copy(
            path.join(root, "all/copy-overwrite/scripts/lib", name),
            path.join(f.nested, "scripts/lib", name)
          );
        }
        await fs.outputFile(
          path.join(f.nested, "scripts/clean-dist.mjs"),
          "console.log('UNEXPECTED_CLEAN'); process.exit(1);\n"
        );
        await fs.outputFile(
          path.join(f.primary, "node_modules/.bin/vite"),
          "#!/bin/sh\necho UNEXPECTED_VITE\n",
          { mode: 0o755 }
        );
        const result = run(f.nested, "npm", [
          "run",
          "--silent",
          kind === ROOT_LIFECYCLE ? "test" : "build",
        ]);
        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain(PARENT_MESSAGE);
        expect(result.stdout).not.toContain("UNEXPECTED_");
      } finally {
        await fs.remove(f.temp);
      }
    }
  );
});
