/** Official REST User shape; native connector workspace/user output is separate. */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { taskFixture } from "./task-readiness-fixture.js";
import { DATABASE, USER, WORKSPACE } from "./task-native-events.js";
/** Install a strict fixed curl boundary with public operation-only journals.
 * @param f - Owned isolated fixture.
 */
export function installNotionApi(f: ReturnType<typeof taskFixture>) {
  writeFileSync(
    path.join(f.env.PATH, "curl"),
    `#!${process.execPath}\nconst fs=require('node:fs'),a=process.argv.slice(2);if(JSON.stringify(a)!==JSON.stringify(['--config','-']))process.exit(64);const s=fs.readFileSync(0,'utf8');if(s.includes('https://api.gitguardian.com/v1/api_tokens/self')){if(!s.includes('Authorization: Token '+process.env.GITGUARDIAN_API_KEY))process.exit(22);fs.appendFileSync(${JSON.stringify(path.join(f.root, "calls.jsonl"))},JSON.stringify({tool:'curl',label:'gitguardian:token-self',argv:a})+'\\n');console.log(JSON.stringify({workspace_id:42,status:'active',scopes:['scan']}));process.exit(0);}const self=s.includes('https://api.notion.com/v1/users/me'),db=s.includes('https://api.notion.com/v1/databases/${DATABASE}');if((!self&&!db)||!s.includes('Notion-Version: 2022-06-28'))process.exit(64);fs.appendFileSync(${JSON.stringify(path.join(f.root, "calls.jsonl"))},JSON.stringify({tool:'curl',label:self?'notion:self':'notion:database',argv:a})+'\\n');if(process.env.FIXTURE_NOTION_UNAVAILABLE)process.exit(7);if(!s.includes('Authorization: Bearer '+process.env.NOTION_API_TOKEN)||!process.env.NOTION_API_TOKEN)process.exit(22);const bot={owner:{type:'workspace',workspace:true},workspace_id:process.env.FIXTURE_NOTION_WRONG?'44444444-4444-4444-8444-444444444444':'${WORKSPACE}',workspace_name:process.env.FIXTURE_NOTION_WRONG?'wrong':'fixture'};if(process.env.FIXTURE_NOTION_MISSING)delete bot.workspace_id;if(process.env.FIXTURE_NOTION_NATIVE_SHAPE){console.log(JSON.stringify({workspace:{id:'${WORKSPACE}'},user:{id:'${USER}',type:'bot'}}));process.exit(0);}console.log(JSON.stringify(self?{object:'user',id:process.env.FIXTURE_NOTION_USER_MATCH?'${WORKSPACE}':'${USER}',type:'bot',bot}:{object:'database',id:process.env.FIXTURE_DATABASE_WRONG?'other':'${DATABASE}'}));\n`,
    { mode: 0o755 }
  );
}
