// Evaluate the npm-updater.yml concurrency group with GitHub's own expression engine (@actions/expressions).
import { readFileSync } from "node:fs";
const wt = process.argv[2];
const { Lexer, Parser, Evaluator, data } = await import(`${wt}/node_modules/@actions/expressions/dist/index.js`);
const yml = readFileSync(`${wt}/.github/workflows/npm-updater.yml`, "utf8");
const line = yml.split("\n").find(l => /^\s+group: lisa-npm-/.test(l)).replace(/^\s+group: /, "");
console.log("group template:", line);
/**
 * Evaluate one GitHub Actions expression body.
 * @param {string} expr - expression text between `${{` and `}}`
 * @param {object} ctx - expression context dictionary
 * @returns {string} the coerced string result
 */
function evalExpr(expr, ctx) {
  const lexer = new Lexer(expr);
  const tokens = lexer.lex();
  const parser = new Parser(tokens.tokens, ["github", "inputs"], []);
  const ast = parser.parse();
  return new Evaluator(ast, ctx).evaluate().coerceString();
}
/**
 * Render a concurrency-group template for one directory input.
 * @param {string} template - the workflow's group template
 * @param {string} directory - the `directory` input value
 * @returns {string} the rendered group name
 */
function render(template, directory) {
  const ctx = new data.Dictionary(
    { key: "github", value: new data.Dictionary({ key: "repository", value: new data.StringData("CodySwannGT/lisa") }) },
    { key: "inputs", value: new data.Dictionary({ key: "directory", value: new data.StringData(directory) }) }
  );
  return template.replace(/\$\{\{(.*?)\}\}/g, (_, e) => evalExpr(e.trim(), ctx));
}
for (const d of [".", "externals", "a/b"]) console.log(JSON.stringify(d).padEnd(12), "=>", render(line, d));
const root = render(line, ".");
console.log("root group equals lisa-npm-${{ github.repository }} rendering:", root === "lisa-npm-CodySwannGT/lisa");
// Bite control: the pre-fix template appended -. for the root.
const prior = "lisa-npm-${{ github.repository }}-${{ inputs.directory }}";
console.log("bite control (pre-fix template, root):", render(prior, "."), "equals historical:", render(prior, ".") === "lisa-npm-CodySwannGT/lisa");
