/** Actual task decisions and hook continuations with isolated synthetic sources. */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { taskFixture } from "../../helpers/task-readiness-fixture.js";
import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";
import { readConfig } from "../../../plugins/src/base/skills/lisa-secrets-access/scripts/surfaces.mjs";
import {
  credentialAvailability,
  taskReadiness,
} from "../../../plugins/src/base/skills/lisa-secrets-access/scripts/preflight-secrets.mjs";
import { AccessFailure } from "../../../plugins/src/base/skills/lisa-secrets-access/scripts/config-layers.mjs";

const roots: string[] = [];
const KEY = "TASK_API_KEY";
const MISSING_CREDENTIAL = "credential-missing";
const credential = {
  id: "task-input",
  kind: "credential",
  credential_names: [KEY],
};
const zero = { claim: 0, branch: 0, code: 0, external: 0 };
const one = { claim: 1, branch: 1, code: 1, external: 1 };
const CONFIG = ".lisa.config.json";
const LOCAL_CONFIG = ".lisa.config.local.json";
/** Register a synthetic project for cleanup.
 * @param routing - Add the GitHub routing floor.
 * @returns Isolated project and native continuation.
 */
function fixture(routing = false) {
  const f = taskFixture(routing);
  roots.push(f.root);
  return f;
}
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
/** Change only an owned fixture configuration.
 * @param f - Owned fixture.
 * @param value - Synthetic config document.
 * @param local - Select its local override.
 */
function changeConfig(
  f: ReturnType<typeof fixture>,
  value: unknown,
  local = false
) {
  writeFileSync(
    path.join(f.root, local ? LOCAL_CONFIG : CONFIG),
    JSON.stringify(value)
  );
}
/** Invoke the actual task-mode preclaim CLI.
 * @param f - Owned fixture with isolated environment.
 * @returns Actual exit status and streams.
 */
function decision(f: ReturnType<typeof fixture>) {
  return boundedSpawnSync({
    label: "real task preclaim CLI",
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
}

describe("task readiness source precedence and provider diagnosis", () => {
  it("permits actual env-only continuation without a provider call or vault CLI", () => {
    const f = fixture();
    f.env[KEY as keyof typeof f.env] = "synthetic-injected";
    rmSync(path.join(f.root, "bin/bws"));
    f.refresh([credential]);
    const result = f.run();
    expect(result.counters).toEqual(one);
    expect(result.ordered).toEqual([]);
    expect(JSON.parse(String(decision(f).stdout)).allowed).toBe(true);
  });
  it("resolves supported materialization without a vault and refuses the same file on local", () => {
    const f = fixture();
    f.env.LISA_SECRETS_SURFACE = "container";
    const dir = path.join(
      f.env.XDG_CONFIG_HOME ?? path.join(f.root, "home/.config"),
      "fixture"
    );
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      path.join(dir, "secrets.env"),
      "export TASK_API_KEY='synthetic-file'\n"
    );
    rmSync(path.join(f.root, "bin/bws"));
    f.refresh([credential]);
    expect(f.run().counters).toEqual(one);
    f.env.LISA_SECRETS_SURFACE = "local";
    f.refresh([credential]);
    const refused = f.run();
    expect(refused.counters).toEqual(zero);
    expect(refused.stderr).toContain("tool-missing");
  });
  it("honors env before declaration, but never widens the file/provider allowlist", () => {
    const cfg = { require: [], capabilities: { materialized: true } };
    expect(
      credentialAvailability(cfg, KEY, {
        env: { [KEY]: "synthetic" },
        provider: () => {
          throw Error("must not run");
        },
      }).source
    ).toBe("environment");
    expect(() =>
      credentialAvailability(cfg, KEY, {
        env: {},
        materialized: () => new Map([[KEY, "synthetic"]]),
      })
    ).toThrow("config-invalid");
    expect(cfg.require).toEqual([]);
  });
  it.each([
    "provider-unreachable",
    "tool-missing",
    "bootstrap-missing",
    "adapter-unsupported",
  ])("keeps %s distinct and does not echo thrown source text", code => {
    const cfg = {
      ...readConfig(fixture().root, {}),
      require: null,
      capabilities: { materialized: false },
      requiredFloor: [],
      projectRoot: "/synthetic",
    };
    const result = taskReadiness({
      cfg,
      requirements: { required_access: [credential] },
      env: {},
      provider: () => {
        throw new AccessFailure(code);
      },
    });
    expect(result.allowed).toBe(false);
    expect(result.code).toBe(code);
  });
  it("distinguishes readable provider absence from outage", () => {
    const cfg = {
      ...readConfig(fixture().root, {}),
      require: null,
      capabilities: { materialized: false },
      requiredFloor: [],
    };
    const requirements = { required_access: [credential] };
    const missing = taskReadiness({
      cfg,
      requirements,
      env: {},
      provider: () => new Map(),
    });
    const down = taskReadiness({
      cfg,
      requirements,
      env: {},
      provider: () => {
        throw Error("untrusted provider error");
      },
    });
    expect(missing.code).toBe(MISSING_CREDENTIAL);
    expect(down.code).toBe("provider-unreachable");
  });
  it("uses local-over-base Doppler and retains declared/default and absent distinctions", () => {
    const f = fixture();
    changeConfig(
      f,
      {
        secrets: {
          provider: "doppler",
          bootstrap: { sources: ["env"], key: "FIXTURE_BOOTSTRAP" },
        },
      },
      true
    );
    const cfg = readConfig(f.root, {});
    expect(cfg.provider).toBe("doppler");
    expect(cfg.provenance.provider).toBe("declared");
    rmSync(path.join(f.root, CONFIG));
    expect(readConfig(f.root, {}).provider).toBe("doppler");
    rmSync(path.join(f.root, LOCAL_CONFIG));
    const absent = readConfig(f.root, {});
    expect(absent.provider).toBe("env");
    expect(absent.provenance.status).toBe("absent");
    changeConfig(f, {});
    expect(readConfig(f.root, {}).provenance.provider).toBe("default");
  });
  it("retains a no-provider project's supported environment path without optional integrations", () => {
    const f = fixture();
    changeConfig(f, {});
    f.env[KEY as keyof typeof f.env] = "synthetic";
    f.refresh([credential]);
    expect(f.run().counters).toEqual(one);
  });
  it("actually resolves through the alternate configured provider and measures readable absence", () => {
    const f = fixture();
    changeConfig(
      f,
      {
        secrets: {
          provider: "doppler",
          bootstrap: { sources: ["env"], key: "FIXTURE_BOOTSTRAP" },
        },
      },
      true
    );
    Object.assign(f.env, { FIXTURE_PROVIDER_FAIL: "0" });
    f.refresh([credential]);
    const passed = f.run();
    expect(passed.counters).toEqual(one);
    expect(passed.ordered).toContain("doppler:secrets:download");
    rmSync(path.join(f.root, LOCAL_CONFIG));
    Object.assign(f.env, { FIXTURE_RECORD_ABSENT: "1" });
    f.refresh([credential]);
    const absent = f.run();
    expect(absent.counters).toEqual(zero);
    expect(absent.stderr).toContain(MISSING_CREDENTIAL);
  });
  it("observes an actual unreadable config object instead of assuming chmod defeats a privileged process", () => {
    const f = fixture();
    const file = path.join(f.root, CONFIG);
    rmSync(file);
    mkdirSync(file);
    const result = f.run();
    expect(result.counters).toEqual(zero);
    expect(result.stderr).toContain("config-unreadable");
  });
});
