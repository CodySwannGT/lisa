/**
 * Raw, read-only GitHub responses for the third-party review evidence CLI.
 *
 * No network and no write route exists here. Every call is journaled with
 * whether its route was one the scenario supplied; an unsupported call exits 72
 * and invalidates the run rather than manufacturing a failure the prover never
 * produced. A route whose answer is `{"__refuse__": "<message>"}` is a
 * deliberate, journaled API refusal — the shape a token without the needed
 * scope gets — and still counts as a supported call.
 */
const fs = require("node:fs");
const path = require("node:path");

const folder = process.argv[2];
const args = process.argv.slice(3);
const responses = JSON.parse(
  fs.readFileSync(path.join(folder, "responses.json"), "utf8")
);
const route = args.length === 2 && args[0] === "api" ? args[1] : null;
const allowed = route !== null && Object.hasOwn(responses, route);
const answer = allowed ? responses[route] : undefined;
const refused =
  answer !== null &&
  typeof answer === "object" &&
  !Array.isArray(answer) &&
  Object.hasOwn(answer, "__refuse__");
fs.appendFileSync(
  path.join(folder, "calls.jsonl"),
  `${JSON.stringify({ argv: args, allowed, refused })}\n`
);
if (!allowed) {
  process.stderr.write(
    `Unsupported controlled GitHub read; no network fallback: ${JSON.stringify(args)}\n`
  );
  process.exit(72);
}
if (refused) {
  process.stderr.write(`${String(answer.__refuse__)}\n`);
  process.exit(1);
}
process.stdout.write(`${JSON.stringify(answer)}\n`);
