// Independent hand-written MODEL of GitHub Actions expression semantics for the
// subset used by the quality-rails service images (CodySwannGT/lisa#4671):
// property access on `inputs`, single-quoted string literals, `||` (returns the
// first truthy operand's VALUE, else the last operand; '' / null / 0 / false
// are falsy) and format() with {N} placeholders ({{ / }} escapes).
// This is a model of the evaluator, not GitHub's own service.
// Usage: node 04-model-evaluator.cjs [workflow-path]
const fs = require("fs");
const yaml = require(require.resolve("js-yaml", { paths: [process.cwd()] }));

function tokenize(src) {
  const toks = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (src.startsWith("||", i)) { toks.push({ t: "or" }); i += 2; continue; }
    if (c === "(" || c === ")" || c === "," || c === ".") { toks.push({ t: c }); i++; continue; }
    if (c === "'") {
      let s = ""; i++;
      while (i < src.length) {
        if (src[i] === "'" && src[i + 1] === "'") { s += "'"; i += 2; continue; }
        if (src[i] === "'") break;
        s += src[i++];
      }
      if (src[i] !== "'") throw new Error("unterminated string");
      i++; toks.push({ t: "str", v: s }); continue;
    }
    const m = /^[A-Za-z_][A-Za-z0-9_-]*/.exec(src.slice(i));
    if (m) { toks.push({ t: "id", v: m[0] }); i += m[0].length; continue; }
    throw new Error(`unexpected char ${c} in ${src}`);
  }
  return toks;
}

const truthy = (v) => !(v === "" || v === null || v === undefined || v === false || v === 0);

function formatFn(fmt, args) {
  return String(fmt).replace(/\{\{|\}\}|\{(\d+)\}/g, (m, n) => {
    if (m === "{{") return "{";
    if (m === "}}") return "}";
    if (Number(n) >= args.length) throw new Error("format index out of range");
    const a = args[Number(n)];
    return a === null || a === undefined ? "" : String(a);
  });
}

function evaluate(src, ctx) {
  const toks = tokenize(src);
  let p = 0;
  const peek = () => toks[p];
  const eat = (t) => { if (!toks[p] || toks[p].t !== t) throw new Error(`expected ${t}`); return toks[p++]; };
  function primary() {
    const tk = peek();
    if (tk.t === "str") { p++; return tk.v; }
    if (tk.t === "id") {
      p++;
      if (peek() && peek().t === "(") {
        eat("(");
        const args = [];
        if (peek().t !== ")") { args.push(orExpr()); while (peek().t === ",") { p++; args.push(orExpr()); } }
        eat(")");
        if (tk.v.toLowerCase() !== "format") throw new Error(`unsupported function ${tk.v}`);
        return formatFn(args[0], args.slice(1));
      }
      let v = ctx[tk.v];
      while (peek() && peek().t === ".") { p++; const k = eat("id").v; v = v == null ? null : v[k]; }
      return v === undefined ? null : v;
    }
    if (tk.t === "(") { p++; const v = orExpr(); eat(")"); return v; }
    throw new Error(`unexpected token ${tk.t}`);
  }
  function orExpr() {
    let v = primary();
    while (peek() && peek().t === "or") { p++; const r = primary(); v = truthy(v) ? v : r; }
    return v;
  }
  const v = orExpr();
  if (p !== toks.length) throw new Error("trailing tokens");
  return v;
}

const interpolate = (s, ctx) =>
  s.replace(/\$\{\{\s*(.*?)\s*\}\}/g, (_, e) => { const v = evaluate(e, ctx); return v === null ? "" : String(v); });

const file = process.argv[2] || ".github/workflows/quality-rails.yml";
const doc = yaml.load(fs.readFileSync(file, "utf8"));
const digest = "pgvector/pgvector@sha256:" + "0123456789abcdef".repeat(4);
const cases = [
  ["AC-1", "", "", "postgres:16", "mysql:8.0"],
  ["AC-1-null (input absent entirely)", null, null, "postgres:16", "mysql:8.0"],
  ["AC-2", "", "17", "postgres:17", "mysql:17"],
  ["AC-3", digest, "", digest, "mysql:8.0"],
  ["AC-3b +version", digest, "17", digest, "mysql:17"],
  ["AC-4", digest, "8.4", digest, "mysql:8.4"],
];
let fail = 0;
for (const [id, image, version, wantPg, wantMy] of cases) {
  console.log(`${id}: database_image=${JSON.stringify(image)} database_version=${JSON.stringify(version)}`);
  const ctx = { inputs: { database_image: image, database_version: version } };
  for (const [job, def] of Object.entries(doc.jobs)) {
    for (const [svc, s] of Object.entries(def.services || {})) {
      if (svc !== "postgres" && svc !== "mysql") continue;
      const want = svc === "postgres" ? wantPg : wantMy;
      const got = interpolate(s.image, ctx);
      const ok = got === want;
      if (!ok) fail++;
      console.log(`  ${job.padEnd(20)} ${svc.padEnd(8)} -> ${got}  expected=${want} ok=${ok}`);
    }
  }
}
// Self-test of the model's semantics against documented GitHub behaviour.
const selfTests = [
  ["'' || 'b'", "b"], ["'a' || 'b'", "a"], ["'' || ''", ""],
  ["format('postgres:{0}', '16')", "postgres:16"], ["format('{{x}}{0}', 'y')", "{x}y"],
];
for (const [e, want] of selfTests) {
  const got = evaluate(e, {});
  if (got !== want) { fail++; console.log(`SELFTEST FAIL ${e} -> ${JSON.stringify(got)}`); }
}
console.log(fail === 0 ? "RESULT: PASS" : `RESULT: FAIL (${fail} mismatches)`);
process.exit(fail === 0 ? 0 : 1);
