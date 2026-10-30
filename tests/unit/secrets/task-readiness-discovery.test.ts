/** Real repository/metadata discovery and registered recovery/probe admission. */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { taskFixture } from "../../helpers/task-readiness-fixture.js";
import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";
import { readConfig } from "../../../plugins/src/base/skills/lisa-secrets-access/scripts/surfaces.mjs";
import { taskReadiness } from "../../../plugins/src/base/skills/lisa-secrets-access/scripts/task-readiness.mjs";
const roots: string[] = [];
const credential = {
  id: "task-input",
  kind: "credential",
  credential_names: ["TASK_API_KEY"],
};
const zero = { claim: 0, branch: 0, code: 0, external: 0 };
/** Make one isolated project.
 * @returns Owned fixture.
 */
function fixture() {
  const f = taskFixture(true);
  roots.push(f.root);
  return f;
}
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
describe("readiness root, binding and registered recovery", () => {
  it("refuses a primitive canonical binding even when the same task's API access is established", () => {
    const f = fixture();
    f.env.FIXTURE_PROVIDER_FAIL = "0";
    expect(f.run().status).toBe(0);
    mkdirSync(path.join(f.root, ".git/lisa"), { recursive: true });
    writeFileSync(path.join(f.root, ".git/lisa/work-item.json"), "null\n");
    const refused = f.run();
    expect(refused.status).toBe(2);
    expect(refused.stderr).toContain("requirements-stale");
    expect(refused.counters).toEqual(zero);
  });
  it("retains a no-config repository root from nested cwd and permits its active supported task", () => {
    const f = fixture();
    rmSync(path.join(f.root, ".lisa.config.json"));
    const nested = path.join(f.root, "src/nested");
    mkdirSync(nested, { recursive: true });
    f.env.TASK_API_KEY = "synthetic";
    f.refresh([credential]);
    const cfg = readConfig(nested, {});
    expect(cfg.projectRoot).toBe(f.root);
    expect(cfg.provenance.status).toBe("absent");
    expect(cfg.provider).toBe("env");
    expect(f.runFrom(nested).counters).toEqual({
      claim: 1,
      branch: 1,
      code: 1,
      external: 1,
    });
  });
  it("distinguishes genuinely undiscovered and unreadable roots without reflecting them", () => {
    const f = fixture();
    const absent = path.join(f.root, "missing-root");
    const cfg = readConfig(absent, {});
    expect(cfg.provenance.status).toBe("undiscovered");
    expect(taskReadiness({ cfg }).code).toBe("config-undiscovered");
    const file = path.join(f.root, "not-a-directory");
    writeFileSync(file, "synthetic");
    expect(() => readConfig(file, {})).toThrow("config-unreadable");
  });
  it.each(["missing-git", "failed-git", "unreadable-binding"])(
    "refuses %s instead of erasing active scope",
    mode => {
      const f = fixture();
      if (mode === "unreadable-binding") {
        mkdirSync(path.join(f.root, ".git/lisa/work-item.json"), {
          recursive: true,
        });
      } else {
        const git = path.join(f.env.PATH, "git");
        rmSync(git);
        if (mode === "failed-git")
          writeFileSync(git, `#!${process.execPath}\nprocess.exitCode=128;\n`, {
            mode: 0o755,
          });
      }
      const result = f.run();
      expect(result.counters).toEqual(zero);
      expect(result.status).toBe(2);
      expect(result.stderr).toContain(
        mode === "missing-git" ? "tool-missing" : "requirements-stale"
      );
    }
  );
  it("preserves positive repo-less credential use and confirmed binding absence", () => {
    const f = fixture();
    rmSync(path.join(f.root, ".git"), { recursive: true });
    rmSync(path.join(f.root, ".lisa.config.json"));
    rmSync(path.join(f.root, ".lisa/work-item-context.md"));
    f.env.TASK_API_KEY = "synthetic";
    const result = boundedSpawnSync({
      label: "repo-less supported resolver",
      command: process.execPath,
      args: [
        path.join(
          f.plugin,
          "skills/lisa-secrets-access/scripts/resolve-secret.mjs"
        ),
        "get",
        "TASK_API_KEY",
      ],
      cwd: f.root,
      env: f.env,
    });
    expect(result.status).toBe(0);
    expect(taskReadiness({ cfg: readConfig(f.root, {}) }).code).toBe(
      "no-active-task"
    );
  });
  it("admits fixed documented probes and recovery through the registered wrapper, not chained work", () => {
    const f = fixture();
    const hook = path.join(f.plugin, "hooks/secrets-preflight.sh");
    const probe = (command: string) =>
      boundedSpawnSync({
        label: "registered before-tool read probe",
        command: "/bin/bash",
        args: [hook, "--task-hook"],
        cwd: f.root,
        env: f.env,
        input: JSON.stringify({
          hook_event_name: "PreToolUse",
          cwd: f.root,
          tool_name: "Bash",
          tool_input: { command },
        }),
      });
    expect(probe("gh api repos/fixture/project").status).toBe(0);
    expect(probe("gh api user").status).toBe(0);
    expect(probe("gh api repos/other/project").status).toBe(2);
    expect(probe("gh api user; synthetic-mutation").status).toBe(2);
    expect(f.run().counters).toEqual(zero);
    const command = `node ${path.join(f.plugin, "skills/lisa-secrets-access/scripts/preflight-secrets.mjs")} --prepare --ref fixture/project#1`;
    expect(probe(command).status).toBe(0);
    f.env.FIXTURE_PROVIDER_FAIL = "0";
    expect(f.run().status).toBe(0);
    expect(readFileSync(path.join(f.root, "code-mutation.json"), "utf8")).toBe(
      '{"calls":1}'
    );
  });
});
