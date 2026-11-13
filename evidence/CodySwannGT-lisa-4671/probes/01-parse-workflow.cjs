// Independent probe for CodySwannGT/lisa#4671: parse the workflow with js-yaml and
// print the database_image input declaration and every postgres/mysql service image.
// Usage: node 01-parse-workflow.cjs [workflow-path]
const fs = require("fs");
const yaml = require(require.resolve("js-yaml", { paths: [process.cwd()] }));
const file = process.argv[2] || ".github/workflows/quality-rails.yml";
const doc = yaml.load(fs.readFileSync(file, "utf8"));
const inputs = doc.on.workflow_call.inputs;
console.log("file:", file);
for (const k of ["database_type", "database_version", "database_image"]) {
  console.log(`input ${k}:`, JSON.stringify(inputs[k]));
}
const rows = [];
for (const [job, def] of Object.entries(doc.jobs)) {
  for (const [svc, s] of Object.entries(def.services || {})) {
    rows.push({ job, service: svc, image: s.image });
  }
}
console.log("service images:");
for (const r of rows) console.log(`  ${r.job} / ${r.service}: ${r.image}`);
const pg = rows.filter((r) => r.service === "postgres");
const my = rows.filter((r) => r.service === "mysql");
console.log(`postgres services: ${pg.length}, mysql services: ${my.length}`);
const expectPg =
  "${{ inputs.database_image || format('postgres:{0}', inputs.database_version || '16') }}";
let bad = 0;
for (const r of pg) {
  if (r.image !== expectPg) {
    bad++;
    console.log(`MISMATCH postgres ${r.job}: ${r.image}`);
  }
}
for (const r of my) {
  if (/database_image/.test(r.image)) {
    bad++;
    console.log(`MISMATCH mysql ${r.job} references database_image: ${r.image}`);
  }
}
const decl = inputs.database_image;
if (!decl || decl.type !== "string" || decl.required !== false || decl.default !== "") {
  bad++;
  console.log("MISMATCH database_image declaration");
}
for (const j of ["test-postgres", "test-postgres-shard", "mutation"]) {
  if (!pg.some((r) => r.job === j)) {
    bad++;
    console.log(`MISSING postgres service on job ${j}`);
  }
}
console.log(bad === 0 ? "RESULT: PASS" : `RESULT: FAIL (${bad} problems)`);
process.exit(bad === 0 ? 0 : 1);
