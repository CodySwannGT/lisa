/** Narrow postlaunch controls: exact operations, safe public names and genuine routes. */
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { taskFixture, HEADER } from "../../helpers/task-readiness-fixture.js";
import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";
import type { TaskOperation } from "../../helpers/task-readiness-tools.js";
const roots: string[] = [];
const PUBLIC_KEY = "PROCUREMENT_AUDIT_READER_ACCESS_KEY";
const PRIVATE_ID = "procurement-weekly-access-audit";
const CONTEXT = ".lisa/work-item-context.md";
/** Create an isolated preclaim task.
 * @returns Owned fixture.
 */
function fixture() {
  const f = taskFixture(false);
  roots.push(f.root);
  return f;
}
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
/** Exercise the real readiness CLI rather than a diagnosis helper.
 * @param f - Owned task.
 * @returns Actual transport and parsed safe decision.
 */
function decision(f: ReturnType<typeof fixture>) {
  const result = boundedSpawnSync({
    label: "postlaunch actual readiness CLI",
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
  return { ...result, value: JSON.parse(String(result.stdout)) };
}
describe("postlaunch source-operation and diagnosis boundaries", () => {
  it.each(["bws", "doppler"])(
    "distinguishes %s version, exact secret operation and rejected argv",
    provider => {
      const f = fixture();
      const args =
        provider === "bws"
          ? ["--color", "no", "secret", "list", "--output", "json"]
          : ["secrets", "download", "--no-file", "--format", "json"];
      const run = (argv: string[]) =>
        boundedSpawnSync({
          label: "exact synthetic provider dispatch",
          command: path.join(f.env.PATH, provider),
          args: argv,
          cwd: f.root,
          env: f.env,
        });
      const version = run(["--version"]);
      expect(version.status).toBe(0);
      expect(String(version.stdout)).toMatch(
        provider === "bws" ? /bws 2\.1\.0/u : /v3\.75\.1/u
      );
      const secret = run(args);
      expect(secret.status).toBe(1);
      const marker = `synthetic-private-${Date.now()}`;
      const unexpected = run(["--unexpected", marker]);
      expect(unexpected.status).toBe(64);
      expect(
        String(unexpected.stdout).includes(marker) ||
          String(unexpected.stderr).includes(marker)
      ).toBe(false);
      const rows: TaskOperation[] = readFileSync(
        path.join(f.root, "calls.jsonl"),
        "utf8"
      )
        .trim()
        .split("\n")
        .map(line => JSON.parse(line));
      expect(rows.map(row => row.operation)).toEqual([
        "version",
        provider === "bws" ? "secret-list" : "secret-download",
        "unexpected",
      ]);
      expect(rows[0]?.argv).toEqual(["--version"]);
      expect(rows[1]?.argv).toEqual(args);
      expect(rows[2]?.accepted).toBe(false);
      expect(rows[2]?.argv).toBeNull();
      console.info(
        "QUALIFICATION_OBSERVATION",
        JSON.stringify({
          case: "argv-dispatch",
          provider,
          version_exit: version.status,
          version_output: String(version.stdout).trim(),
          secret_exit: secret.status,
          unexpected_exit: unexpected.status,
          operations: rows,
        })
      );
    }
  );
  it("identifies a non-fixture public key and safe requirement index through actual CLI and hook sinks", () => {
    const f = fixture();
    f.refresh([
      { id: PRIVATE_ID, kind: "credential", credential_names: [PUBLIC_KEY] },
    ]);
    const cli = decision(f);
    const hook = f.run();
    expect(cli.status).toBe(2);
    expect(cli.value.credential).toBe(PUBLIC_KEY);
    expect(cli.value.requirement_index).toBe(1);
    expect(cli.value.requirement).toBe("requirement-1");
    expect(cli.value.provider).toBe("bitwarden");
    expect(cli.value.code).toBe("provider-unreachable");
    expect(hook.stderr).toContain(PUBLIC_KEY);
    expect(hook.stderr).toContain("requirement-1");
    const evidence = JSON.stringify({
      result: cli.value,
      stdout: hook.stdout,
      stderr: hook.stderr,
    });
    expect(evidence.includes(PRIVATE_ID)).toBe(false);
    const output = path.join(f.root, "safe-public-diagnosis.json");
    writeFileSync(output, evidence);
    expect(readFileSync(output, "utf8")).toContain(PUBLIC_KEY);
    expect(hook.counters).toEqual({
      claim: 0,
      branch: 0,
      code: 0,
      external: 0,
    });
    console.info(
      "QUALIFICATION_OBSERVATION",
      JSON.stringify({
        case: "non-fixture-public-name",
        credential: cli.value.credential,
        requirement_index: cli.value.requirement_index,
        provider: cli.value.provider,
        code: cli.value.code,
        operation: hook.journal,
        effects: hook.counters,
        raw_requirement_id_absent: true,
      })
    );
  });
  it("rejects unsafe credential text without reflecting it or granting continuation", () => {
    const f = fixture();
    const marker = `synthetic-private-${Date.now()}`;
    const header = {
      ...f.manifest,
      required_access: [
        {
          id: PRIVATE_ID,
          kind: "credential",
          credential_names: [`INVALID\n${marker}`],
        },
      ],
    };
    writeFileSync(
      path.join(f.root, CONTEXT),
      `${HEADER + JSON.stringify(header)}\n-->\n${f.body}`
    );
    const cli = decision(f),
      hook = f.run();
    expect(cli.value.code).toBe("requirements-stale");
    expect(
      [cli.stdout, cli.stderr, hook.stdout, hook.stderr].every(
        value => !String(value).includes(marker)
      )
    ).toBe(true);
    expect(hook.counters).toEqual({
      claim: 0,
      branch: 0,
      code: 0,
      external: 0,
    });
  });
  it("does not invent a remaining native route for an unregistered vendor", () => {
    const f = fixture();
    f.refresh([
      {
        id: PRIVATE_ID,
        kind: "capability",
        credential_names: ["GITGUARDIAN_API_KEY"],
        access_layer: "unregistered-vendor",
        operation: "resource-read",
        resource: "fixture-resource",
      },
    ]);
    const cli = decision(f),
      hook = f.run();
    expect(cli.status).toBe(2);
    expect(cli.value.outcome).toBe("DENIED");
    expect(cli.value.code).toBe("adapter-unsupported");
    expect(cli.value.owner).toBeUndefined();
    expect(hook.nativeHandoff).toBe(false);
    expect(hook.counters).toEqual({
      claim: 0,
      branch: 0,
      code: 0,
      external: 0,
    });
  });
});
