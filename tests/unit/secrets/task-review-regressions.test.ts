/** Real entrypoint reproductions of the combined review findings. */
import {
  chmodSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { taskFixture } from "../../helpers/task-readiness-fixture.js";
import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";
import { readConfig } from "../../../plugins/src/base/skills/lisa-secrets-access/scripts/surfaces.mjs";
const roots: string[] = [];
const zero = { claim: 0, branch: 0, code: 0, external: 0 };
const context = ".lisa/work-item-context.md";
const CLOUD = "fixture-cloud";
/** Register an isolated actual-hook project.
 * @returns Actual hook fixture.
 */
function fixture() {
  const f = taskFixture(false);
  roots.push(f.root);
  return f;
}
/** Invoke the existing canonical owner with structured stdin, without shell syntax.
 * @param f - Owned fixture.
 * @param mode - Fixed canonical CLI mode.
 * @param input - Structured metadata transaction.
 * @param ref - Canonical work item.
 * @returns Real command outcome.
 */
function cli(
  f: ReturnType<typeof fixture>,
  mode = "--task",
  input?: object,
  ref = "fixture/project#1"
) {
  return boundedSpawnSync({
    label: "review actual readiness owner",
    command: process.execPath,
    args: [
      path.join(
        f.plugin,
        "skills/lisa-secrets-access/scripts/preflight-secrets.mjs"
      ),
      mode,
      "--ref",
      ref,
    ],
    cwd: f.root,
    env: f.env,
    ...(input ? { input: JSON.stringify(input) } : {}),
  });
}
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
describe("combined review real entrypoints", () => {
  it("withholds an unenumerated ordinary Write before any context or binding", () => {
    const f = fixture();
    rmSync(path.join(f.root, context));
    const r = f.run();
    expect(r.setupFailure).toBe(false);
    console.info(
      "QUALIFICATION_OBSERVATION",
      JSON.stringify({
        case: "fresh-unenumerated-write",
        exit: r.status,
        effects: r.counters,
        journal: r.journal,
      })
    );
    expect(r.status).toBe(2);
    expect(r.counters).toEqual(zero);
    expect(f.run("PreToolUse", "Read").status).toBe(0);
  });
  it("creates the first ignored0600 full context through the canonical resolver transport", () => {
    const f = fixture();
    rmSync(path.join(f.root, context));
    f.env.TASK_API_KEY = "synthetic";
    rmSync(path.join(f.root, ".gitignore"));
    const body =
      "# Entire synthetic vendor body\n\nComment: retain every byte.\n";
    const owner = path.join(
      f.plugin,
      "skills/lisa-secrets-access/scripts/preflight-secrets.mjs"
    );
    const admission = boundedSpawnSync({
      label: "fresh resolver canonical writer admission",
      command: "/bin/bash",
      args: [path.join(f.plugin, "hooks/secrets-preflight.sh"), "--task-hook"],
      cwd: f.root,
      env: f.env,
      input: JSON.stringify({
        hook_event_name: "PreToolUse",
        cwd: f.root,
        tool_name: "Bash",
        tool_input: {
          command: `node ${owner} --prepare --ref fixture/project#1`,
        },
      }),
    });
    expect(admission.status).toBe(0);
    const r = cli(f, "--prepare", {
      requirements_complete: true,
      required_access: [
        { id: "input", kind: "credential", credential_names: ["TASK_API_KEY"] },
      ],
      context_body: body,
    });
    expect(r.status).toBe(0);
    const bytes = readFileSync(path.join(f.root, context), "utf8");
    expect(bytes.slice(bytes.indexOf("\n-->\n") + 5)).toBe(body);
    expect(statSync(path.join(f.root, context)).mode & 0o777).toBe(0o600);
    expect(f.run().counters).toEqual({
      claim: 1,
      branch: 1,
      code: 1,
      external: 1,
    });
  });
  it.each(["broken", "inaccessible"])(
    "refuses a present %s local symlink beside a readable base",
    mode => {
      const f = fixture(),
        dir = path.join(f.root, "private-layer"),
        target = path.join(dir, "local.json"),
        local = path.join(f.root, ".lisa.config.local.json");
      mkdirSync(dir);
      if (mode === "inaccessible") writeFileSync(target, "{}");
      symlinkSync(target, local);
      if (mode === "inaccessible") {
        expect(process.getuid?.()).not.toBe(0);
        chmodSync(dir, 0);
        try {
          statSync(local);
          throw Error("Unexpected accessible target");
        } catch (error) {
          expect(error).toHaveProperty("code", "EACCES");
        }
      }
      try {
        expect(() => readConfig(f.root, {})).toThrow("config-unreadable");
      } finally {
        chmodSync(dir, 0o700);
      }
    }
  );
  it.each(["jira", "confluence"])(
    "reaches the documented owner for routed %s without an independent token assertion",
    route => {
      const f = fixture();
      writeFileSync(
        path.join(f.root, ".lisa.config.json"),
        JSON.stringify({
          ...(route === "jira"
            ? { tracker: "jira", jira: { project: "FIX" } }
            : { source: "confluence" }),
          atlassian: {
            cloudId: CLOUD,
            site: "fixture.atlassian.net",
          },
        })
      );
      const resource = route === "jira" ? "FIX" : CLOUD;
      const requirement = {
        id: "routed-access",
        kind: "capability",
        credential_names: ["ATLASSIAN_API_TOKEN"],
        access_layer: "atlassian",
        operation: route === "jira" ? "issue-type-metadata" : "list-spaces",
        resource,
      };
      const identity =
        route === "jira"
          ? { ref: "FIX-1", tracker: "jira" }
          : { ref: "fixture/project#1", tracker: "github" };
      f.refresh([requirement], identity);
      const r = cli(f, "--task", undefined, identity.ref);
      console.info(
        "QUALIFICATION_OBSERVATION",
        JSON.stringify({ case: `real-routed-${route}`, exit: r.status })
      );
      expect(r.status).toBe(3);
    }
  );
  it("does not demand a Jira project for an injected Confluence-only scope", () => {
    const f = fixture();
    f.env.ATLASSIAN_API_TOKEN = "synthetic-injected";
    writeFileSync(
      path.join(f.root, ".lisa.config.json"),
      JSON.stringify({
        source: "confluence",
        atlassian: { cloudId: CLOUD, site: "fixture.atlassian.net" },
      })
    );
    f.refresh([
      {
        id: "spaces",
        kind: "capability",
        credential_names: ["ATLASSIAN_API_TOKEN"],
        access_layer: "atlassian",
        operation: "list-spaces",
        resource: CLOUD,
      },
    ]);
    expect(cli(f).status).toBe(3);
  });
});
