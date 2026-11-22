/** Real owner + exact synthetic GitHub/provider commands; credentials never enter journals. */
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { taskFixture } from "./task-readiness-fixture.js";
export const githubRequirement = {
  id: "repository-access",
  kind: "capability",
  credential_names: ["GH_TOKEN"],
  access_layer: "github",
  operation: "repository-read",
  resource: "fixture/project",
};
/** Select only a supported source and make ambient native authentication unavailable.
 * @param source - Supported provider or materialized source.
 * @param conflictingAlias - Include an ambient competing alias for forwarding controls.
 * @returns Real owner fixture with a private synthetic canary.
 */
export function githubFixture(source: string, conflictingAlias = true) {
  const secret = `synthetic-private-${randomUUID()}`;
  const f = taskFixture(true, true, {
    FIXTURE_SELECTED_GH: secret,
    ...(conflictingAlias ? { GITHUB_TOKEN: "synthetic-conflict" } : {}),
    ...(source === "materialized" ? { LISA_SECRETS_SURFACE: "container" } : {}),
  });
  const prefix = `#!${process.execPath}\nconst fs=require("node:fs"),a=process.argv.slice(2);const log=x=>fs.appendFileSync(${JSON.stringify(path.join(f.root, "calls.jsonl"))},JSON.stringify(x)+"\\n");const same=x=>JSON.stringify(a)===JSON.stringify(x);`;
  writeFileSync(
    path.join(f.env.PATH, "gh"),
    `${prefix}if(!same(["api","user"])&&!same(["api","repos/fixture/project"])){process.exitCode=64;}else{const selected=process.env.GH_TOKEN===process.env.FIXTURE_SELECTED_GH&&!process.env.GITHUB_TOKEN;log({tool:"gh",operation:a[1]==="user"?"authenticated-user":"repository-read",label:"gh:api:"+a[1],argv:a,accepted:true,selected_source:selected});if(!selected&&!process.env.FIXTURE_NATIVE_AVAILABLE)process.exitCode=1;else console.log(JSON.stringify(a[1]==="user"?{login:"fixture-actor",id:process.env.FIXTURE_ACTOR_INVALID?0:17}:{full_name:process.env.FIXTURE_GH_WRONG?"other/project":"fixture/project",owner:{login:"fixture"},permissions:{pull:true}}));}\n`,
    { mode: 0o755 }
  );
  writeFileSync(
    path.join(f.env.PATH, "bws"),
    `${prefix}if(!same(["--color","no","secret","list","--output","json"])){process.exitCode=64;}else{log({tool:"bws",operation:"secret-list",label:"bws:secret:list",argv:a,accepted:true});console.log(JSON.stringify([{key:"GH_TOKEN",value:process.env.FIXTURE_SELECTED_GH,note:"synthetic fixture"}]));}\n`,
    { mode: 0o755 }
  );
  if (source === "materialized") {
    const dir = path.join(f.env.XDG_CONFIG_HOME, "fixture");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      path.join(dir, "secrets.env"),
      `export GH_TOKEN='${secret}'\n`,
      { mode: 0o600 }
    );
  }
  f.refresh([githubRequirement]);
  return { ...f, secret };
}
