/** Diagnose the fixed attribution fixture's actual source/root route, not timing guesses. */
import { copyFileSync, cpSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import {
  bash,
  cleanupScratchRoots,
  REPO_ROOT,
  runFallback,
  scratchRoot,
} from "../../helpers/enforcement-fallback-fixtures.js";
afterEach(cleanupScratchRoots);
it("keeps dispatcher attribution fixtures out of workstation task credentials and live API routes", () => {
  // Resolve the real checkout guards without inheriting its active work item.
  const project = scratchRoot();
  cpSync(
    path.join(REPO_ROOT, "plugins/lisa"),
    path.join(project, "plugins/lisa"),
    {
      recursive: true,
    }
  );
  copyFileSync(
    path.join(REPO_ROOT, ".lisa.config.json"),
    path.join(project, ".lisa.config.json")
  );
  const bin = scratchRoot(),
    journal = path.join(bin, "calls.jsonl");
  writeFileSync(journal, "");
  writeFileSync(
    path.join(bin, "gh"),
    `#!${process.execPath}\nconst fs=require("node:fs"),a=process.argv.slice(2);fs.appendFileSync(${JSON.stringify(journal)},JSON.stringify({tool:"gh",operation:a.join(":")})+"\\n");if(a.join(":")==="api:user")console.log(JSON.stringify({login:"CodySwannGT",id:292923}));else if(a.join(":")==="api:repos/CodySwannGT/lisa")console.log(JSON.stringify({full_name:"CodySwannGT/lisa",owner:{login:"CodySwannGT"},permissions:{pull:true}}));else process.exitCode=64;\n`,
    { mode: 0o755 }
  );
  const r = runFallback(bash("HUSKY=0 git commit -m x"), project, bin, {
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
      claude_project_is_own: project === REPO_ROOT,
      payload_cwd_supplied: false,
      attempts,
      exit: r.status,
    })
  );
  expect(r.status).toBe(2);
  expect(attempts).toEqual([]);
});
