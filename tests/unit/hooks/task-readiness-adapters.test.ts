/** Actual wrapper/native callback execution, separated from generated inspection. */
import {
  cpSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { taskFixture } from "../../helpers/task-readiness-fixture.js";
import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";

const roots: string[] = [];
const BUN = boundedSpawnSync({
  label: "pinned Bun path",
  command: "/usr/bin/which",
  args: ["bun"],
}).stdout.trim();
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
/** Register one isolated native-adapter project.
 * @returns Owned fixture.
 */
function fixture() {
  const f = taskFixture(false);
  roots.push(f.root);
  return f;
}

describe("task readiness native adapters", () => {
  it("refuses the explicit native before-tool entry when both decoders are missing, while SessionStart stays advisory", () => {
    const f = fixture();
    rmSync(path.join(f.env.PATH, "node"));
    rmSync(path.join(f.env.PATH, "jq"));
    const run = (before: boolean) =>
      boundedSpawnSync({
        label: "native hook decoder failure",
        command: "/bin/bash",
        args: [
          path.join(f.plugin, "hooks/secrets-preflight.sh"),
          ...(before ? ["--task-hook"] : []),
        ],
        cwd: f.root,
        env: f.env,
        input: before
          ? JSON.stringify({
              hook_event_name: "PreToolUse",
              cwd: f.root,
              tool_name: "Write",
              tool_input: { file_path: "product.txt" },
            })
          : "",
      });
    const refused = run(true);
    expect(refused.status).toBe(2);
    expect(refused.stderr).toContain("tool-missing");
    expect(run(false).status).toBe(0);
  });
  it("agy's real decision protocol denies affected shell work and allows an established empty-extra task", () => {
    const f = fixture();
    const run = () =>
      boundedSpawnSync({
        label: "agy readiness envelope",
        command: "/bin/bash",
        args: [path.join(f.plugin, "hooks/secrets-preflight.agy.sh")],
        cwd: f.root,
        env: f.env,
        input: JSON.stringify({
          cwd: f.root,
          toolCall: {
            name: "run_command",
            args: { CommandLine: "synthetic-mutation" },
          },
        }),
      });
    expect(JSON.parse(String(run().stdout)).decision).toBe("deny");
    f.env.FIXTURE_PROVIDER_FAIL = "0";
    expect(JSON.parse(String(run().stdout)).decision).toBe("allow");
    f.env.FIXTURE_PROVIDER_FAIL = "1";
    f.refresh([]);
    expect(JSON.parse(String(run().stdout)).decision).toBe("allow");
  });
  it("OpenCode's actual before callback throws before the mutable continuation, and its success control writes once", () => {
    const f = fixture();
    mkdirSync(path.join(f.root, "plugins"));
    symlinkSync(f.plugin, path.join(f.root, "plugins/lisa"));
    const dir = path.join(f.root, "adapter");
    mkdirSync(dir);
    cpSync(
      "src/opencode/plugin-templates/lisa-task-readiness.ts",
      path.join(dir, "plugin.ts")
    );
    for (const name of ["task-readiness-guard.sh", "task-readiness-guard.mjs"])
      cpSync(path.join(f.plugin, "hooks", name), path.join(dir, name));
    const driver = path.join(dir, "driver.mjs");
    writeFileSync(
      driver,
      'import {LisaTaskReadiness} from "./plugin.ts";import{writeFileSync}from"node:fs";const hook=await LisaTaskReadiness();let continued=0;try{await hook["tool.execute.before"]({tool:"write"},{args:{file_path:"product.txt"}});writeFileSync("product.txt","synthetic");continued++;}catch{}console.log(JSON.stringify({continued}));'
    );
    const run = () =>
      boundedSpawnSync({
        label: "OpenCode readiness real callback",
        command: BUN,
        args: [driver],
        cwd: f.root,
        env: f.env,
      });
    const blocked = run();
    expect(blocked.status).toBe(0);
    expect(JSON.parse(String(blocked.stdout)).continued).toBe(0);
    f.env.FIXTURE_PROVIDER_FAIL = "0";
    const allowed = run();
    expect(allowed.status).toBe(0);
    expect(JSON.parse(String(allowed.stdout)).continued).toBe(1);
    expect(readFileSync(path.join(f.root, "product.txt"), "utf8")).toBe(
      "synthetic"
    );
    f.refresh([]);
    f.env.FIXTURE_PROVIDER_FAIL = "1";
    expect(JSON.parse(String(run().stdout)).continued).toBe(1);
  });
});
