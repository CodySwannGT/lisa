/** Injected/provider credentials count only after the real scoped API read. */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { taskFixture } from "../../helpers/task-readiness-fixture.js";
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
/** Select only an owned synthetic source before exercising the real API probe.
 * @param mode - Credential substrate under test.
 * @returns Isolated configured project.
 */
function sourceFixture(mode: string) {
  const f = taskFixture(false);
  roots.push(f.root);
  if (mode === "materialized") {
    f.env.LISA_SECRETS_SURFACE = "container";
    const directory = path.join(f.env.XDG_CONFIG_HOME, "fixture");
    mkdirSync(directory, { recursive: true });
    writeFileSync(
      path.join(directory, "secrets.env"),
      "export GITGUARDIAN_API_KEY='synthetic-injected'\n",
      { mode: 0o600 }
    );
  } else if (mode !== "doppler")
    f.env.GITGUARDIAN_API_KEY = "synthetic-injected";
  if (mode === "doppler") {
    writeFileSync(
      path.join(f.root, ".lisa.config.local.json"),
      JSON.stringify({ secrets: { provider: "doppler" } })
    );
    f.env.FIXTURE_PROVIDER_FAIL = "0";
  } else rmSync(path.join(f.env.PATH, "bws"));
  if (mode === "no-provider")
    writeFileSync(
      path.join(f.root, ".lisa.config.json"),
      JSON.stringify({ gitguardian: { workspaceId: 42 } })
    );
  f.refresh();
  return f;
}
describe("same capability through supported credential substrates", () => {
  it.each(["environment", "materialized", "doppler", "no-provider"])(
    "proves scoped access through %s before one fixture continuation",
    mode => {
      const f = sourceFixture(mode);
      const proved = f.run();
      expect(proved.status).toBe(0);
      expect(proved.nativeHandoff).toBe(false);
      expect(proved.ordered).toEqual(
        mode === "doppler"
          ? ["doppler:secrets:download", "gitguardian:token-self"]
          : ["gitguardian:token-self"]
      );
      expect(proved.counters).toEqual({
        claim: 1,
        branch: 1,
        code: 1,
        external: 1,
      });
      f.env.FIXTURE_API_WRONG = "1";
      const wrong = f.run();
      expect(wrong.status).toBe(2);
      expect(wrong.stderr).toContain("identity-mismatch");
      expect(wrong.counters).toEqual({
        claim: 0,
        branch: 0,
        code: 0,
        external: 0,
      });
      if (mode === "materialized") {
        f.env.LISA_SECRETS_SURFACE = "local";
        f.refresh();
        const unsupported = f.run();
        expect(unsupported.status).toBe(2);
        expect(unsupported.stderr).toContain("tool-missing");
        expect(unsupported.ordered).toEqual([]);
        expect(unsupported.counters).toEqual({
          claim: 0,
          branch: 0,
          code: 0,
          external: 0,
        });
      }
      console.info(
        "QUALIFICATION_OBSERVATION",
        JSON.stringify({
          case: `scoped-${mode}`,
          proof: "gitguardian-token-self",
          actual_hook: proved.ordered,
          positive_effects: proved.counters,
          wrong_identity_effects: wrong.counters,
        })
      );
    }
  );
});
