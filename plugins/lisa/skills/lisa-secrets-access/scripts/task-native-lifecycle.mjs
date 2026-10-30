/** Root/session lifecycle epochs in the existing temporary gate; never an access grant. */
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  lstatSync,
  realpathSync,
  readFileSync,
  writeFileSync,
  renameSync,
  rmSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { fingerprint } from "./task-native-contract.mjs";
import { AccessFailure } from "./config-layers.mjs";
const fail = () => {
  throw new AccessFailure("native-response-unrepresented");
};
export const lifecycleEvents = new Set([
  "SessionStart",
  "UserPromptSubmit",
  "SessionEnd",
]);
export function gateDirectory() {
  const path = join(tmpdir(), "lisa-verification-gate");
  mkdirSync(path, { recursive: true, mode: 0o700 });
  const stat = lstatSync(path);
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    stat.mode & 0o022 ||
    (process.getuid && stat.uid !== process.getuid())
  )
    fail();
  return path;
}
/** Local subject discovery deliberately does not parse config or call a provider. */
function rootFor(event, fallback) {
  const cwd = realpathSync(resolve(event.cwd ?? fallback ?? process.cwd()));
  try {
    return realpathSync(
      execFileSync("git", ["rev-parse", "--show-toplevel"], {
        cwd,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 5000,
      }).trim()
    );
  } catch (error) {
    if (error.status === 128) return cwd;
    fail();
  }
}
function family(event, root) {
  if (
    typeof event.session_id !== "string" ||
    !event.session_id ||
    event.session_id.length > 512
  )
    fail();
  return fingerprint({
    root: rootFor(event, root),
    session: event.session_id,
    adapter: fileURLToPath(import.meta.url),
    codex: Boolean(process.env.CODEX_THREAD_ID),
  });
}
function writeEpoch(path) {
  const epoch = randomBytes(32).toString("hex"),
    temporary = `${path}.${epoch}.tmp`;
  try {
    writeFileSync(temporary, epoch, { flag: "wx", mode: 0o600 });
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
  return epoch;
}
/** A lifecycle rotates every subagent in this root/session family without reading task data. */
export function resetNativeEvent(event) {
  if (!event?.session_id) return;
  writeEpoch(join(gateDirectory(), `readiness-epoch-${family(event)}.key`));
}
export function sessionEpoch(event, root) {
  const key = family(event, root),
    path = join(gateDirectory(), `readiness-epoch-${key}.key`);
  let epoch;
  try {
    const stat = lstatSync(path);
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      stat.mode & 0o077 ||
      (process.getuid && stat.uid !== process.getuid())
    )
      fail();
    epoch = readFileSync(path, "utf8");
    if (!/^[a-f0-9]{64}$/.test(epoch)) fail();
  } catch (error) {
    if (error.code !== "ENOENT") fail();
    epoch = writeEpoch(path);
  }
  return fingerprint({ key, epoch });
}
