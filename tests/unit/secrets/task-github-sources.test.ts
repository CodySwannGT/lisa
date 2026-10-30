/** Provider/file values prove scoped GitHub access only in child memory. */
import { readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { githubFixture } from "../../helpers/task-github-fixture.js";
const roots: string[] = [];
const SECRET_LIST = "bws:secret:list";
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
describe("GitHub supported source scoped proof", () => {
  it.each(["provider", "materialized"])(
    "uses %s after native auth is unavailable and denies mismatches",
    source => {
      const f = githubFixture(source);
      roots.push(f.root);
      const r = process.env.LISA_GH_OLD_PLUGIN
        ? f.runPlugin(process.env.LISA_GH_OLD_PLUGIN)
        : f.run();
      expect(r.setupFailure).toBe(false);
      console.info(
        "QUALIFICATION_OBSERVATION",
        JSON.stringify({
          case: `github-${source}`,
          source_baseline: process.env.LISA_GH_OLD_PLUGIN
            ? "bddc75b5"
            : "candidate",
          exit: r.status,
          journal: r.journal,
          effects: r.counters,
        })
      );
      expect(r.status).toBe(0);
      expect(r.counters).toEqual({ claim: 1, branch: 1, code: 1, external: 1 });
      expect(r.ordered.filter(v => v === SECRET_LIST)).toHaveLength(
        source === "provider" ? 1 : 0
      );
      for (const flag of ["FIXTURE_GH_WRONG", "FIXTURE_ACTOR_INVALID"]) {
        f.env[flag] = "1";
        const wrong = f.run();
        expect(wrong.status).toBe(2);
        expect(wrong.stderr).toContain("identity-mismatch");
        expect(wrong.counters).toEqual({
          claim: 0,
          branch: 0,
          code: 0,
          external: 0,
        });
        delete f.env[flag];
      }
      const sinks = [
        r.stdout,
        r.stderr,
        readFileSync(path.join(f.root, "calls.jsonl"), "utf8"),
      ].join();
      expect(sinks).not.toContain(f.secret);
    }
  );
  it("preserves native success without vault lookup and refuses wrong native identity without fallback", () => {
    const f = githubFixture("provider");
    roots.push(f.root);
    f.env.FIXTURE_NATIVE_AVAILABLE = "1";
    const r = f.run();
    expect(r.status).toBe(0);
    expect(r.ordered).not.toContain(SECRET_LIST);
    f.env.FIXTURE_ACTOR_INVALID = "1";
    const wrong = f.run();
    expect(wrong.status).toBe(2);
    expect(wrong.ordered).not.toContain(SECRET_LIST);
  });
});
