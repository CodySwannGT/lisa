/** Diagnose the fixed attribution fixture's actual source/root route, not timing guesses. */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import {
  bash,
  cleanupScratchRoots,
  PLUGIN_HOOKS,
  REPO_ROOT,
  runFallback,
  scratchRoot,
} from "../../helpers/enforcement-fallback-fixtures.js";
afterEach(cleanupScratchRoots);
it("keeps dispatcher attribution fixtures out of workstation task credentials and live API routes", () => {
  const bin = scratchRoot(),
    journal = path.join(bin, "calls.jsonl");
  writeFileSync(journal, "");
  writeFileSync(
    path.join(bin, "gh"),
    `#!${process.execPath}\nconst fs=require("node:fs"),a=process.argv.slice(2);fs.appendFileSync(${JSON.stringify(journal)},JSON.stringify({tool:"gh",operation:a.join(":")})+"\\n");if(a.join(":")==="api:user")console.log(JSON.stringify({login:"CodySwannGT",id:292923}));else if(a.join(":")==="api:repos/CodySwannGT/lisa")console.log(JSON.stringify({full_name:"CodySwannGT/lisa",owner:{login:"CodySwannGT"},permissions:{pull:true}}));else process.exitCode=64;\n`,
    { mode: 0o755 }
  );
  const r = runFallback(bash("HUSKY=0 git commit -m x"), REPO_ROOT, bin, {
    PATH: `${bin}${path.delimiter}${process.env.PATH ?? ""}`,
  });
  const attempts = readFileSync(journal, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map(v => JSON.parse(v));
  console.info(
    "QUALIFICATION_OBSERVATION",
    JSON.stringify({
      case: "fixed-dispatcher-task-route",
      inherited_lisa_project_present: Boolean(process.env.LISA_PROJECT_DIR),
      inherited_lisa_project_is_own: process.env.LISA_PROJECT_DIR === REPO_ROOT,
      claude_project_is_own: true,
      payload_cwd_supplied: false,
      attempts,
      exit: r.status,
    })
  );
  expect(r.status).toBe(2);
  // Readiness ran on the fixture's own task data and permitted it, so the
  // refusal belongs to the hook-bypass guard alone. An empty journal does not
  // show that by itself: on a checkout with no claimed work item readiness
  // refuses before it probes anything, and the journal is empty for a reason
  // that has nothing to do with isolation. That is how the isolation was once
  // dropped from the helper without this case going red anywhere but on a
  // workstation with a claimed work item.
  const readiness = path.join(PLUGIN_HOOKS, "task-readiness-guard.sh");
  expect(existsSync(readiness)).toBe(true);
  expect(r.output).toContain(
    `Refused by ${path.join(PLUGIN_HOOKS, "block-no-verify.sh")}`
  );
  expect(r.output).not.toContain(`Refused by ${readiness}`);
  expect(attempts).toEqual([]);
});
