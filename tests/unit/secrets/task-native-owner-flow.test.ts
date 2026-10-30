/** Component/flow qualification with synthetic authenticated boundaries, not native-agent execution. */
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { taskFixture } from "../../helpers/task-readiness-fixture.js";
import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";
import { notionOwnerContinuation } from "../../../plugins/src/base/skills/lisa-secrets-access/scripts/task-access.mjs";
import { credentialAvailability } from "../../../plugins/src/base/skills/lisa-secrets-access/scripts/task-readiness.mjs";
import { readConfig } from "../../../plugins/src/base/skills/lisa-secrets-access/scripts/surfaces.mjs";
const roots: string[] = [];
const FETCH_PROBE = "notion:fetch-configured-database";
const DATABASE = "database";
const PROVIDER_UNREACHABLE = "provider-unreachable";
const AFFECTED_ACTION = "fixture:affected-action";
const requirement = {
  id: "notion-database",
  kind: "capability",
  credential_names: ["NOTION_API_TOKEN"],
  access_layer: "notion",
  operation: "database-read",
  resource: "fixture-database",
};
/** Construct the documented Notion owner route and real hook handoff.
 * @param provider - Configure Bitwarden; false leaves the project without a provider.
 * @param explicit - Independently assert the token in secrets.require.
 * @returns Owned fixture, config, context and actual scoped-action recorder.
 */
function fixture(provider = true, explicit = false) {
  const f = taskFixture(false);
  roots.push(f.root);
  writeFileSync(
    path.join(f.root, ".lisa.config.json"),
    JSON.stringify({
      source: "notion",
      notion: {
        workspaceId: "fixture-workspace",
        prdDatabaseId: requirement.resource,
      },
      ...(provider || explicit
        ? {
            secrets: {
              ...(provider
                ? {
                    provider: "bitwarden",
                    namespace: "fixture",
                    bootstrap: { sources: ["env"], key: "FIXTURE_BOOTSTRAP" },
                  }
                : {}),
              ...(explicit ? { require: ["NOTION_API_TOKEN"] } : {}),
            },
          }
        : {}),
    })
  );
  f.refresh([requirement]);
  return {
    ...f,
    cfg: readConfig(f.root, f.env),
    effect: path.join(f.root, "native-owner-action.json"),
  };
}
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

describe.each([true, false])(
  "routed native-owner flow (provider=%s)",
  provider => {
    it.each(["matching", "wrong", "missing", "unavailable", "attestation"])(
      "qualifies %s connector responses after the primary is unavailable",
      async mode => {
        const f = fixture(provider);
        const before = readFileSync(
          path.join(f.root, ".lisa/work-item-context.md")
        );
        const hook = f.run();
        expect(hook.setupFailure).toBe(false);
        console.info(
          "QUALIFICATION_OBSERVATION",
          JSON.stringify({
            case: `routed-notion-${provider}-${mode}`,
            evidence: "actual-readiness-hook; component-flow continuation",
            source: f.cfg.routing.source,
            required_floor: f.cfg.requiredFloor,
            explicit_require: f.cfg.require,
            exit: hook.status,
            hook_operations: hook.journal,
            forbidden_effects: hook.counters,
          })
        );
        expect(hook.status).toBe(2);
        expect(hook.nativeHandoff).toBe(false);
        expect(hook.ordered).toEqual(provider ? ["bws:secret:list"] : []);
        expect(hook.counters).toEqual({
          claim: 0,
          branch: 0,
          code: 0,
          external: 0,
        });
        const decision = boundedSpawnSync({
          label: "isolated native-owner source decision",
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
        expect(decision.status).toBe(3);
        const sourceCode = JSON.parse(String(decision.stdout))
          .provider_health[0];
        expect(JSON.parse(String(decision.stdout)).code).toBe(
          "native-proof-needed"
        );
        expect(sourceCode).toBe(provider ? PROVIDER_UNREACHABLE : "reachable");
        const journal = [provider ? "provider:unreachable" : "env:absent"];
        const result = await notionOwnerContinuation(f.cfg, requirement, {
          credential: { available: false, provider_health: sourceCode },
          primaryProbe: async () => {
            throw Error("primary must not run without a credential");
          },
          connectorProbe: async () => {
            journal.push(FETCH_PROBE);
            if (mode === "unavailable") throw Error("synthetic unavailable");
            if (mode === "attestation")
              return { passed: true, status: "success" };
            if (mode === "missing") return { object: DATABASE };
            return {
              object: DATABASE,
              id: mode === "wrong" ? "other-database" : requirement.resource,
            };
          },
          continueAction: async () => {
            journal.push(AFFECTED_ACTION);
            writeFileSync(f.effect, '{"calls":1}');
          },
        });
        expect(existsSync(f.effect)).toBe(mode === "matching");
        expect(result.outcome).toBe(
          mode === "matching" ? "ESTABLISHED" : "DENIED"
        );
        expect(journal.filter(step => step === AFFECTED_ACTION)).toHaveLength(
          mode === "matching" ? 1 : 0
        );
        if (mode === "matching")
          expect(result).toHaveProperty("provider_health", sourceCode);
        expect(
          readFileSync(path.join(f.root, ".lisa/work-item-context.md"))
        ).toEqual(before);
        console.info(
          "QUALIFICATION_OBSERVATION",
          JSON.stringify({
            case: `routed-native-owner-${provider}-${mode}`,
            evidence: "component-flow",
            journal,
            outcome: result.outcome,
            provider_health: sourceCode,
            affected_effects: existsSync(f.effect) ? 1 : 0,
          })
        );
      }
    );
    it("retains an explicit independent secrets.require assertion before handoff", () => {
      const f = fixture(provider, true);
      const hook = f.run();
      expect(f.cfg.routing.source).toBe("notion");
      expect(f.cfg.requiredFloor).toEqual(["NOTION_API_TOKEN"]);
      expect(f.cfg.require).toEqual(["NOTION_API_TOKEN"]);
      expect(hook.status).toBe(2);
      expect(hook.nativeHandoff).toBe(false);
      const code = provider ? PROVIDER_UNREACHABLE : "credential-missing";
      expect(String(hook.stderr)).toContain(code);
      expect(hook.counters).toEqual({
        claim: 0,
        branch: 0,
        code: 0,
        external: 0,
      });
      expect(hook.ordered).toEqual(provider ? ["bws:secret:list"] : []);
      console.info(
        "QUALIFICATION_OBSERVATION",
        JSON.stringify({
          case: `routed-notion-explicit-${provider}`,
          evidence: "actual-readiness-hook",
          source: f.cfg.routing.source,
          explicit_require: f.cfg.require,
          exit: hook.status,
          code,
          hook_operations: hook.journal,
          forbidden_effects: hook.counters,
        })
      );
    });
    it("keeps the routing floor when no matching scoped capability is enumerated", () => {
      const f = fixture(provider);
      f.refresh([]);
      const hook = f.run();
      expect(hook.status).toBe(2);
      expect(hook.nativeHandoff).toBe(false);
      expect(hook.counters).toEqual({
        claim: 0,
        branch: 0,
        code: 0,
        external: 0,
      });
    });
    it("does not treat an unrelated capability using the same key as routing proof", () => {
      const f = fixture(provider);
      f.refresh([{ ...requirement, access_layer: "sentry" }]);
      const hook = f.run();
      expect(hook.status).toBe(2);
      expect(hook.nativeHandoff).toBe(false);
      expect(hook.counters).toEqual({
        claim: 0,
        branch: 0,
        code: 0,
        external: 0,
      });
    });
  }
);
describe("documented native-owner supported primary", () => {
  it.each(["matching", "wrong", "unavailable"])(
    "uses the supported primary first for %s, without bypassing wrong identity",
    async mode => {
      const f = fixture();
      f.env.NOTION_API_TOKEN = "synthetic-injected";
      const credential = credentialAvailability(f.cfg, "NOTION_API_TOKEN", {
        env: f.env,
      });
      const journal: string[] = [];
      const result = await notionOwnerContinuation(f.cfg, requirement, {
        credential,
        primaryProbe: async () => {
          journal.push("notion:users-me", "notion:database-read");
          if (mode === "unavailable") throw Error("synthetic unavailable");
          return {
            me: {
              object: "user",
              bot: {
                workspace_name:
                  mode === "wrong" ? "other" : "fixture-workspace",
              },
            },
            database: { object: DATABASE, id: requirement.resource },
          };
        },
        connectorProbe: async () => {
          journal.push(FETCH_PROBE);
          return { object: DATABASE, id: requirement.resource };
        },
        continueAction: async () => {
          journal.push(AFFECTED_ACTION);
          writeFileSync(f.effect, '{"calls":1}');
        },
      });
      expect(journal.slice(0, 2)).toEqual([
        "notion:users-me",
        "notion:database-read",
      ]);
      expect(journal.includes(FETCH_PROBE)).toBe(mode === "unavailable");
      expect(existsSync(f.effect)).toBe(mode !== "wrong");
      expect(result.outcome).toBe(mode === "wrong" ? "DENIED" : "ESTABLISHED");
      console.info(
        "QUALIFICATION_OBSERVATION",
        JSON.stringify({
          case: `routed-notion-primary-${mode}`,
          evidence: "component-flow",
          source: f.cfg.routing.source,
          journal,
          outcome: result.outcome,
          affected_effects: existsSync(f.effect) ? 1 : 0,
        })
      );
    }
  );
});
