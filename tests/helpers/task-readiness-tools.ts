/** Exact synthetic command boundaries. Version checks are never secret reads. */
import { writeFileSync } from "node:fs";
import path from "node:path";

/**
 *
 */
export interface TaskOperation {
  tool: string;
  operation: string;
  label: string;
  argv: string[] | null;
  accepted: boolean;
}

const programs: Record<string, string> = {
  bws: 'if(same(["--version"])){known("version","bws:version");console.log("bws 2.1.0");return;}if(!same(["--color","no","secret","list","--output","json"])){reject();return;}known("secret-list","bws:secret:list");if(process.env.FIXTURE_PROVIDER_FAIL==="1"){process.stderr.write(process.env.FIXTURE_CANARY??"synthetic outage");process.exitCode=1;}else console.log(JSON.stringify(process.env.FIXTURE_RECORD_ABSENT?[]:[{key:"TASK_API_KEY",value:"synthetic-value",note:"synthetic fixture"},{key:"GITGUARDIAN_API_KEY",value:"synthetic-value",note:"synthetic fixture"}]));',
  doppler:
    'if(same(["--version"])){known("version","doppler:version");console.log("v3.75.1");return;}if(!same(["secrets","download","--no-file","--format","json"])){reject();return;}known("secret-download","doppler:secrets:download");if(process.env.FIXTURE_PROVIDER_FAIL==="1"){process.stderr.write(process.env.FIXTURE_CANARY??"synthetic outage");process.exitCode=1;}else console.log(JSON.stringify(process.env.FIXTURE_RECORD_ABSENT?{}:{TASK_API_KEY:"synthetic-value",GITGUARDIAN_API_KEY:"synthetic-value"}));',
  gh: 'if(same(["--version"])){known("version","gh:version");console.log("gh version 2.83.0 (2026-01-01)");return;}if(same(["auth","status"])){known("auth-status","gh:auth:status");console.log("github.com: authenticated synthetic fixture");return;}if(same(["api","user"])){known("authenticated-user","gh:api:user");console.log(JSON.stringify({login:"fixture-actor",id:process.env.FIXTURE_ACTOR_INVALID?0:17,type:"User"}));return;}if(same(["api","repos/fixture/project"])){known("repository-read","gh:api:repos/fixture/project");console.log(JSON.stringify({full_name:process.env.FIXTURE_GH_WRONG?"other/project":"fixture/project",owner:{login:"fixture",id:7,type:"Organization"},permissions:{pull:true,push:true}}));return;}reject();',
  curl: 'if(same(["--version"])){known("version","curl:version");console.log("curl 8.12.1 (synthetic fixture)");return;}if(!same(["--config","-"])){reject();return;}known("token-self","gitguardian:token-self");const input=fs.readFileSync(0,"utf8");if(process.env.FIXTURE_API_FAIL||!input.includes("Authorization: Token ")||!input.includes("https://api.gitguardian.com/v1/api_tokens/self")){process.stderr.write(process.env.FIXTURE_CANARY??"synthetic unavailable");process.exitCode=22;}else console.log(JSON.stringify({id:"00000000-0000-4000-8000-000000000001",name:"fixture",workspace_id:process.env.FIXTURE_API_WRONG?99:42,type:"service_account",status:"active",member_id:7,scopes:["scan"]}));',
};

/** Install fixed argv-aware boundaries; credentials remain on stdin/in memory.
 * @param bin - Owned executable directory.
 * @param calls - Operation journal, with safe approved argv only.
 * @param node - Qualified fixture runtime.
 */
export function installTaskTools(
  bin: string,
  calls: string,
  node: string
): void {
  for (const [name, body] of Object.entries(programs)) {
    const prefix = `#!${node}\nconst fs=require("node:fs");const a=process.argv.slice(2);const same=x=>JSON.stringify(a)===JSON.stringify(x);const log=x=>fs.appendFileSync(${JSON.stringify(calls)},JSON.stringify(x)+"\\n");const known=(operation,label)=>log({tool:${JSON.stringify(name)},operation,label,argv:a,accepted:true});const reject=()=>{log({tool:${JSON.stringify(name)},operation:"unexpected",label:${JSON.stringify(`${name}:unexpected`)},argv:null,argument_count:a.length,accepted:false});process.stderr.write("Unsupported synthetic fixture arguments");process.exitCode=64;};\n`;
    writeFileSync(path.join(bin, name), `${prefix}(()=>{${body}})();\n`, {
      mode: 0o755,
    });
  }
}
