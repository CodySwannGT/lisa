/** Genuine fixed ChromeDriver serves separately declared qualification and diagnostic requests. */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, realpathSync } from "node:fs";
import { isAbsolute } from "node:path";
import { invokedAsScript } from "../../../all/copy-overwrite/scripts/lib/invoked-as-script.mjs";
import { sandboxStatus } from "./sandbox-status.mjs";

const REFUSAL = "native driver diagnostic refused";
const DRIVER_START = "driver-start";
const SESSION_DELETE = "session-delete";
export const DRIVER_PHASES = Object.freeze([
  DRIVER_START,
  "session-create",
  "navigate",
  "source",
  SESSION_DELETE,
  "driver-close",
]);
const STAGES = new Set(DRIVER_PHASES);

/**
 * Source-owned profiles must remain the same physical private directory.
 * @param {string} profile Original private profile.
 * @returns {object} Original native directory identity.
 */
function profileIdentity(profile) {
  if (typeof profile !== "string" || !isAbsolute(profile))
    throw new Error(REFUSAL);
  const st = lstatSync(profile);
  if (
    !st.isDirectory() ||
    st.isSymbolicLink() ||
    st.uid !== process.getuid() ||
    (st.mode & 0o777) !== 0o700 ||
    realpathSync(profile) !== profile
  )
    throw new Error(REFUSAL);
  return { dev: st.dev, ino: st.ino };
}

/**
 * The live child publishes its ephemeral port before this fixture makes requests.
 * @param {object} child Still-owned native driver handle.
 * @param {number} deadline Inner diagnostic deadline.
 * @returns {Promise<string>} Endpoint published by that live child.
 */
function driverEndpoint(child, deadline) {
  return new Promise((resolve, reject) => {
    const state = { text: "" };
    const finish = error => {
      clearTimeout(timer);
      child.stdout.off("data", collect);
      child.off("close", closed);
      child.off("error", failed);
      if (error) reject(error);
    };
    const closed = () => finish(new Error(REFUSAL));
    const failed = () => finish(new Error(REFUSAL));
    const collect = bytes => {
      state.text += bytes.toString();
      if (Buffer.byteLength(state.text) > 65536) return closed();
      const matches = [
        ...state.text.matchAll(
          /^ChromeDriver was started successfully on port ([1-9]\d{0,4})\.\r?$/gm
        ),
      ];
      if (!matches.length) return;
      const port = Number(matches[0][1]);
      if (
        matches.length !== 1 ||
        port > 65535 ||
        child.exitCode !== null ||
        child.signalCode !== null
      )
        return closed();
      finish();
      resolve(`http://127.0.0.1:${port}`);
    };
    const timer = setTimeout(closed, Math.max(1, deadline - Date.now()));
    child.stdout.on("data", collect);
    child.once("close", closed);
    child.once("error", failed);
  });
}

/**
 * Bounded loopback replies retain no vendor messages or private request paths.
 * @param {string} endpoint Endpoint published by the owned driver.
 * @param {string} method Fixed protocol method.
 * @param {string} path Current session's fixed protocol path.
 * @param {object | undefined} body Original request fields.
 * @param {number} deadline Inner diagnostic deadline.
 * @returns {Promise<object | string>} Actual bounded protocol value.
 */
async function request(endpoint, method, path, body, deadline) {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new Error(REFUSAL);
  const response = await fetch(endpoint + path, {
    method,
    redirect: "error",
    signal: AbortSignal.timeout(remaining),
    headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const chunks = [];
  const state = { size: 0 };
  for await (const bytes of response.body) {
    state.size += bytes.length;
    if (state.size > 1048576) throw new Error(REFUSAL);
    chunks.push(bytes);
  }
  const parsed = JSON.parse(Buffer.concat(chunks).toString());
  if (!response.ok || parsed.value?.error)
    throw Object.assign(new Error(REFUSAL), {
      nativeMessageSha256: createHash("sha256")
        .update(JSON.stringify(parsed.value ?? { status: response.status }))
        .digest("hex"),
    });
  return parsed.value;
}

/**
 * A still-owned child handle is waited, never recovered through an ambient identifier.
 * @param {object} child Still-owned native driver handle.
 * @param {Promise<void>} closed Native close completion.
 * @returns {Promise<void>} Native handle completion.
 */
async function closeDriver(child, closed) {
  if (child.exitCode === null && child.signalCode === null)
    child.kill("SIGTERM");
  await closed;
}

/**
 * Acquire a real session and the original sandbox page under the outer native bound.
 * The fixed eight-second inner operation leaves time for owned teardown.
 * @param {string} profile Fresh source-owned profile.
 * @param {object} tools Original qualified browser and driver paths.
 * @param {function(object):void} publish Closed diagnostic progress writer.
 * @param {string} purpose Source-owned diagnostic or qualification request.
 * @returns {Promise<object>} Closed native facts with the declared purpose.
 */
export async function probeDriver(
  profile,
  tools,
  publish = () => {},
  purpose = "diagnostic"
) {
  if (!["diagnostic", "qualification"].includes(purpose))
    throw new Error(REFUSAL);
  const identity = profileIdentity(profile);
  const deadline = Date.now() + 8000;
  const state = { stage: DRIVER_START, session: null, endpoint: null };
  const phase = stage => {
    state.stage = stage;
    publish({ phase: stage });
  };
  const report = {
    diagnosticOnly: purpose === "diagnostic",
    driverLaunchVerified: false,
    driverSessionVerified: false,
    nativeSandboxVerified: false,
    suidSandboxActive: false,
    layer1Sandbox: "unreported",
    sessionDeleted: false,
    driverClosed: false,
    failureStage: null,
    failureSha256: null,
  };
  const child = spawn(tools.driver, ["--port=0"], {
    stdio: ["ignore", "pipe", "inherit"],
    detached: false,
  });
  const closed = new Promise(resolve => child.once("close", resolve));
  phase(DRIVER_START);
  try {
    state.endpoint = await driverEndpoint(child, deadline);
    report.driverLaunchVerified = true;
    phase("session-create");
    const session = await request(
      state.endpoint,
      "POST",
      "/session",
      {
        capabilities: {
          alwaysMatch: {
            browserName: "chrome",
            "goog:chromeOptions": {
              binary: tools.chrome,
              detach: false,
              args: [
                "--headless=new",
                "--allow-chrome-scheme-url",
                "--no-first-run",
                "--no-default-browser-check",
                `--user-data-dir=${profile}`,
              ],
            },
          },
        },
      },
      deadline
    );
    if (
      typeof session?.sessionId !== "string" ||
      !/^[a-f0-9]{32}$/.test(session.sessionId)
    )
      throw new Error(REFUSAL);
    state.session = session.sessionId;
    report.driverSessionVerified = true;
    phase("navigate");
    await request(
      state.endpoint,
      "POST",
      `/session/${state.session}/url`,
      {
        url: "chrome://sandbox",
      },
      deadline
    );
    phase("source");
    const html = await request(
      state.endpoint,
      "GET",
      `/session/${state.session}/source`,
      undefined,
      deadline
    );
    Object.assign(report, sandboxStatus(html));
    if (!report.nativeSandboxVerified || !report.suidSandboxActive)
      throw new Error(REFUSAL);
  } catch (error) {
    report.failureStage = STAGES.has(state.stage) ? state.stage : DRIVER_START;
    report.failureSha256 =
      error?.nativeMessageSha256 ??
      createHash("sha256")
        .update(String(error?.message ?? error))
        .digest("hex");
    publish({
      refusalStage: report.failureStage,
      messageSha256: report.failureSha256,
    });
  } finally {
    try {
      if (state.session) {
        phase(SESSION_DELETE);
        await request(
          state.endpoint,
          "DELETE",
          `/session/${state.session}`,
          undefined,
          Date.now() + 500
        );
        report.sessionDeleted = true;
      }
    } catch (error) {
      report.failureStage ??= SESSION_DELETE;
      report.failureSha256 ??=
        error?.nativeMessageSha256 ??
        createHash("sha256")
          .update(String(error?.message ?? error))
          .digest("hex");
    } finally {
      phase("driver-close");
      await closeDriver(child, closed);
      report.driverClosed = true;
    }
  }
  if (JSON.stringify(profileIdentity(profile)) !== JSON.stringify(identity))
    throw new Error(REFUSAL);
  return report;
}

if (invokedAsScript(import.meta.url)) {
  try {
    const publish = value => process.stdout.write(`${JSON.stringify(value)}\n`);
    const report = await probeDriver(
      process.argv[2],
      {
        chrome: process.argv[3],
        driver: process.argv[4],
      },
      publish,
      process.argv[5]
    );
    publish({ result: report });
    if (report.failureStage) process.exitCode = 1;
  } catch {
    process.stderr.write(`${REFUSAL}\n`);
    process.exitCode = 1;
  }
}
