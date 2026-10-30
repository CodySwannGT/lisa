/** Strict supported-source + full-reader fixture; no workstation credentials inherited. */
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { githubFixture } from "./task-github-fixture.js";
import { installIntakeGh } from "./task-intake-gh.js";
const CALLS = "calls.jsonl";
/** Install exact provider dispatch and remove all header/ambient auth prerequisites.
 * @param source - Supported source under qualification.
 * @returns Owned fixture with accurate safe command journals.
 */
export function preheaderGithub(source: string) {
  const f = githubFixture(source, false);
  rmSync(path.join(f.root, ".lisa/work-item-context.md"));
  installIntakeGh(f, true);
  writeFileSync(path.join(f.root, CALLS), "");
  writeFileSync(
    path.join(f.env.PATH, "bws"),
    `#!${process.execPath}\nconst fs=require('node:fs'),a=process.argv.slice(2);if(JSON.stringify(a)!==JSON.stringify(['--color','no','secret','list','--output','json']))process.exit(64);fs.appendFileSync(${JSON.stringify(path.join(f.root, CALLS))},JSON.stringify({tool:'bws',label:'bws:secret:list',argv:a,accepted:true})+'\\n');if(process.env.FIXTURE_SOURCE_FAILURE){process.stderr.write(process.env.FIXTURE_SELECTED_GH);process.exit(1);}console.log(JSON.stringify(process.env.FIXTURE_RECORD_MISSING?[]:[{key:'GH_TOKEN',value:process.env.FIXTURE_SELECTED_GH,note:'synthetic',projectId:'allowed'}]));\n`,
    { mode: 0o755 }
  );
  return f;
}
/** Snapshot only operation metadata, never values or child errors.
 * @param f - Owned fixture.
 * @returns Exact argv/order and authentication-selection facts.
 */
export function preheaderJournal(f: ReturnType<typeof githubFixture>) {
  return readFileSync(path.join(f.root, CALLS), "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map(l => JSON.parse(l));
}
