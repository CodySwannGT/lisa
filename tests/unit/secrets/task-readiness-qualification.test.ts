/** Hook/CLI qualification. Recorder effects are fixture files, never vendor writes. */
import { createHash } from "node:crypto";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { env as processEnv } from "node:process";
import { afterEach, describe, expect, it } from "vitest";
import { taskFixture } from "../../helpers/task-readiness-fixture.js";
import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";
import {
  expectHookList,
  pairedReadback,
} from "../../helpers/task-readiness-matched.js";
const roots: string[] = [];
const UNREACHABLE = "provider-unreachable";
const BWS_LIST = "bws:secret:list";
const OBSERVATION = "QUALIFICATION_OBSERVATION";
const CONFIG = ".lisa.config.json";
const SENTRY_TOKEN = "SENTRY_AUTH_TOKEN";
const OWNER = "skills/lisa-secrets-access/scripts/preflight-secrets.mjs";
const CONTEXT = ".lisa/work-item-context.md";
const zero = { claim: 0, branch: 0, code: 0, external: 0 };
const one = { claim: 1, branch: 1, code: 1, external: 1 };
/** Create an isolated preclaim project with fresh canonical metadata.
 * @param routing - Include independent repository routing requirements.
 * @returns Owned project.
 */
function fixture(routing = true) {
  const f = taskFixture(routing);
  roots.push(f.root);
  return f;
}
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
/** Invoke the actual shared CLI.
 * @param f - Owned project.
 * @returns Actual transport and semantic result.
 */
function decision(f: ReturnType<typeof fixture>) {
  const result = boundedSpawnSync({
    label: "qualification actual task CLI",
    command: process.execPath,
    args: [path.join(f.plugin, OWNER), "--task", "--ref", "fixture/project#1"],
    cwd: f.root,
    env: f.env,
  });
  return { ...result, value: JSON.parse(String(result.stdout)) };
}
describe("focused required-access functional qualification", () => {
  it("denies an unsupported executable operation without inventing a native route or calling metadata malformed", () => {
    const f = fixture(false);
    f.env.FIXTURE_PROVIDER_FAIL = "0";
    f.refresh([{ ...f.manifest.required_access[0], operation: "scan" }]);
    const result = decision(f);
    expect(result.status).toBe(2);
    expect(result.value.outcome).toBe("DENIED");
    expect(result.value.code).toBe("adapter-unsupported");
    expect(result.value.owner).toBeUndefined();
    expect(f.run().nativeHandoff).toBe(false);
  });
  it.each([true, false])(
    "stops the real task API path with hook-owned attempts, routing=%s",
    routing => {
      const f = fixture(routing);
      const selected = processEnv.LISA_READINESS_BASELINE;
      const receipts = processEnv.LISA_READINESS_INPUT_RECEIPTS;
      if (receipts) {
        const prefix = `${selected ? "old" : "candidate"}-${routing}`;
        for (const [name, relative] of [
          ["config.json", CONFIG],
          ["context.md", CONTEXT],
          ["ignore.txt", ".gitignore"],
        ] as const)
          writeFileSync(
            path.join(receipts, `${prefix}-${name}`),
            readFileSync(path.join(f.root, relative)),
            { flag: "wx", mode: 0o600 }
          );
      }
      const context = readFileSync(path.join(f.root, CONTEXT));
      const observed = selected ? f.runPlugin(selected) : f.run();
      if (selected)
        pairedReadback(f, observed, { context, routing, source: selected });
      console.info(
        OBSERVATION,
        JSON.stringify({
          case: "task-api-refusal",
          routing,
          stage: "preclaim",
          source_sha256: createHash("sha256")
            .update(readFileSync(path.join(selected ?? f.plugin, OWNER)))
            .digest("hex"),
          baseline: Boolean(selected),
          status: observed.status,
          preparatory: observed.preparatoryOrdered,
          hook: observed.ordered,
          preparatory_operations: observed.preparatoryJournal,
          hook_operations: observed.journal,
          reason: selected ? "advisory-transport-success" : UNREACHABLE,
          effects: observed.counters,
          config_digest: f.manifest.effective_config_sha256,
          requirements_digest: f.manifest.requirements_sha256,
          setup_failure: observed.setupFailure,
        })
      );
      expect(observed.setupFailure).toBe(false);
      expect(observed.journal.every(row => row.accepted)).toBe(true);
      if (selected) {
        expect(
          observed.journal.some(row => row.operation === "secret-list")
        ).toBe(false);
        expect(
          observed.journal.some(
            row => row.tool === "bws" && row.operation === "version"
          )
        ).toBe(true);
      } else expectHookList(observed.journal);
      expect(observed.counters).toEqual(zero);
      expect(observed.status).toBe(2);
      expect(observed.stderr).toContain(UNREACHABLE);
      expect(observed.ordered).toContain(BWS_LIST);
      expect(observed.preparatoryOrdered).toContain(BWS_LIST);
      expect(observed.stderr).toContain("GITGUARDIAN_API_KEY");
      expect(observed.stderr).toContain("bitwarden (bws)");
    }
  );
  it("permits one same-active-task continuation after provider and scoped API proof", () => {
    const f = fixture();
    const context = path.join(f.root, CONTEXT);
    const before = readFileSync(context);
    expect(f.run().counters).toEqual(zero);
    f.env.FIXTURE_PROVIDER_FAIL = "0";
    const proved = f.run();
    expect(proved.ordered).toEqual([
      "gh:api:user",
      "gh:api:repos/fixture/project",
      BWS_LIST,
      "gitguardian:token-self",
    ]);
    expect(proved.counters).toEqual(one);
    expect(readFileSync(context)).toEqual(before);
    const cli = decision(f);
    expect(cli.status).toBe(0);
    expect(cli.value.outcome).toBe("ESTABLISHED");
    expect(cli.value.capabilities[0].source).toBe("gitguardian-api");
    console.info(
      OBSERVATION,
      JSON.stringify({
        case: "same-active-task-positive",
        status: proved.status,
        hook: proved.ordered,
        hook_operations: proved.journal,
        configured_workspace: 42,
        effects: proved.counters,
        metadata_unchanged: true,
        source: "gitguardian-api",
      })
    );
    f.env.FIXTURE_API_WRONG = "1";
    const wrong = f.run();
    expect(wrong.counters).toEqual(zero);
    expect(wrong.stderr).toContain("identity-mismatch");
  });
  it("keeps a non-four-vendor native route distinct from PASS and DENIED", () => {
    const f = fixture(false);
    writeFileSync(
      path.join(f.root, CONFIG),
      JSON.stringify({
        sentry: { org: "fixture", project: "project" },
        secrets: {
          provider: "bitwarden",
          namespace: "fixture",
          bootstrap: { sources: ["env"], key: "FIXTURE_BOOTSTRAP" },
        },
      })
    );
    f.refresh([
      {
        id: "sentry-project",
        kind: "capability",
        credential_names: [SENTRY_TOKEN],
        access_layer: "sentry",
        operation: "list-issues",
        resource: "fixture/project",
      },
    ]);
    const hook = f.run();
    const cli = decision(f);
    expect(cli.status).toBe(3);
    expect(cli.value.outcome).toBe("NATIVE_OWNER_REQUIRED");
    expect(cli.value.allowed).toBeNull();
    expect(cli.value.owner).toBe("lisa-sentry-access");
    expect(hook.status).toBe(2);
    expect(hook.nativeHandoff).toBe(false);
    expect(hook.counters).toEqual(zero);
    expect(hook.ordered).toEqual([BWS_LIST]);
    expect(cli.value.provider_health).toContain(UNREACHABLE);
    console.info(
      OBSERVATION,
      JSON.stringify({
        case: "non-four-native-owner",
        status: hook.status,
        outcome: cli.value.outcome,
        owner: cli.value.owner,
        hook: hook.ordered,
        effects: hook.counters,
        evidence: "transport-handoff-not-native-agent-execution",
      })
    );
  });
  it("preserves explicit mandatory config assertions despite native fallback candidates", () => {
    const f = fixture(false);
    writeFileSync(
      path.join(f.root, CONFIG),
      JSON.stringify({
        sentry: { org: "fixture", project: "project" },
        secrets: { provider: "env", require: [SENTRY_TOKEN] },
      })
    );
    f.refresh([
      {
        id: "sentry-project",
        kind: "capability",
        credential_names: [SENTRY_TOKEN],
        access_layer: "sentry",
        operation: "list-issues",
        resource: "fixture/project",
      },
    ]);
    expect(f.run().counters).toEqual(zero);
    expect(decision(f).value.outcome).toBe("DENIED");
  });
});
