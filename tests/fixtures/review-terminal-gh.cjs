/** Raw read-only GitHub responses with the caller's real jq projection. */
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const folder = process.argv[2];
const jqBinary = process.argv[3];
const args = process.argv.slice(4);
const responses = JSON.parse(
  fs.readFileSync(path.join(folder, "responses.json"), "utf8")
);
const key = `${args[0]}:${(args[1] ?? "").split("?")[0]}`;
if (!Object.hasOwn(responses, key) || responses[key] === null) {
  fs.appendFileSync(
    path.join(folder, "calls.jsonl"),
    `${JSON.stringify({ args, refused: true })}\n`
  );
  process.exit(1);
}
const raw = responses[key];
const at = args.indexOf("--jq");
const query = at < 0 ? null : args[at + 1];
const result =
  query === null
    ? { status: 0, stdout: `${JSON.stringify(raw)}\n`, stderr: "" }
    : spawnSync(jqBinary, ["-r", query], {
        input: JSON.stringify(raw),
        encoding: "utf8",
      });
fs.appendFileSync(
  path.join(folder, "calls.jsonl"),
  `${JSON.stringify({
    args,
    raw,
    query,
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  })}\n`
);
process.stdout.write(result.stdout ?? "");
process.stderr.write(result.stderr ?? "");
process.exitCode = result.status ?? 1;
