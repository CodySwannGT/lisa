/** Attacker markers remain in fixture inputs/memory, never emitted or persisted as evidence. */
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { taskFixture, HEADER } from "../../helpers/task-readiness-fixture.js";
import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";
const roots: string[] = [];
const CONFIG = ".lisa.config.json";
const CONTEXT = ".lisa/work-item-context.md";
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
describe("safe exact readiness diagnoses and actual output sinks", () => {
  it.each(["provider", "api", "config", "parse", "header", "descriptor"])(
    "does not reflect an attacker marker from %s",
    mode => {
      const f = taskFixture(false);
      roots.push(f.root);
      const canary = `synthetic-private-${Date.now()}`;
      f.env.FIXTURE_CANARY = canary;
      if (mode === "api")
        Object.assign(f.env, {
          FIXTURE_PROVIDER_FAIL: "0",
          FIXTURE_API_FAIL: "1",
        });
      if (mode === "config")
        writeFileSync(
          path.join(f.root, CONFIG),
          JSON.stringify({ secrets: { provider: canary } })
        );
      if (mode === "parse")
        writeFileSync(path.join(f.root, CONFIG), `{"${canary}":`);
      if (mode === "header")
        writeFileSync(
          path.join(f.root, CONTEXT),
          `${HEADER + JSON.stringify({ ...f.manifest, passed: canary })}\n-->\n${f.body}`
        );
      if (mode === "descriptor")
        f.refresh([
          {
            id: canary,
            kind: "capability",
            credential_names: ["TASK_API_KEY"],
            access_layer: "custom-service",
            operation: "resource-read",
            resource: canary,
          },
        ]);
      const hook = f.run();
      const cli = boundedSpawnSync({
        label: "safe diagnosis actual CLI",
        command: process.execPath,
        args: [
          path.join(
            f.plugin,
            "skills/lisa-secrets-access/scripts/preflight-secrets.mjs"
          ),
          "--task",
          "--ref",
          "fixture/project#1",
        ],
        cwd: f.root,
        env: f.env,
      });
      const result = JSON.parse(String(cli.stdout));
      const artifact = path.join(f.root, "safe-evidence.json");
      writeFileSync(
        artifact,
        JSON.stringify({ stdout: hook.stdout, stderr: hook.stderr, result })
      );
      const sinks = [
        hook.stdout,
        hook.stderr,
        cli.stdout,
        cli.stderr,
        readFileSync(artifact, "utf8"),
      ];
      if (mode === "provider" || mode === "api")
        sinks.push(readFileSync(path.join(f.root, CONTEXT), "utf8"));
      expect(sinks.every(value => !String(value).includes(canary))).toBe(true);
      expect(hook.counters).toEqual({
        claim: 0,
        branch: 0,
        code: 0,
        external: 0,
      });
      if (mode === "provider") {
        expect(result.credential).toBe("GITGUARDIAN_API_KEY");
        expect(result.provider).toBe("bitwarden");
        expect(result.tool).toBe("bws");
        expect(result.code).toBe("provider-unreachable");
      }
      if (mode === "api") {
        expect(result.code).toBe("capability-unreachable");
        expect(result.provider_health).toBe("reachable");
        expect(result.tool).toBe("curl");
      }
      console.info(
        "QUALIFICATION_OBSERVATION",
        JSON.stringify({
          case: `safe-${mode}`,
          code: result.code,
          outcome: result.outcome,
          actual_sink_canary_absent: true,
          fixture_effects: hook.counters,
        })
      );
    }
  );
});
