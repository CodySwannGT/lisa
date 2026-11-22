/** Deterministic rendezvous at a real syscall, never a guessed overlap sleep. */
import {
  existsSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  watch,
} from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  nativeFixture,
  selfResult,
  fetchResult,
} from "./task-native-events.js";
import { installNotionApi } from "./task-notion-api.js";
import {
  holdNativeLock,
  installContentionWorkers,
  startNativeHook,
} from "./task-native-contention-process.js";
import type {
  NativeFixture,
  NativeEvent,
} from "./task-native-contention-process.js";
/** Snapshot temporary hashes without raw private scope or provider values.
 * @param f - Owned fixture.
 * @returns Exact epoch and state byte hashes.
 */
export function nativeStateHashes(f: NativeFixture) {
  const directory = path.join(f.root, "lisa-verification-gate");
  return Object.fromEntries(
    readdirSync(directory)
      .filter(n => !n.endsWith(".lock"))
      .map(n => [
        n,
        createHash("sha256")
          .update(readFileSync(path.join(directory, n)))
          .digest("hex"),
      ])
  );
}
/** Install the real primary and initialize stable actual epoch through an ordinary hook.
 * @returns Fixture, readable instrumentation and complete primary environment.
 */
export function contentionFixture() {
  const f = nativeFixture();
  const env = { ...f.env, NOTION_API_TOKEN: "synthetic-contention-token" };
  installNotionApi(f);
  for (const agent of ["A", "B"])
    writeFileSync(path.join(f.root, `effects-${agent}.json`), '{"calls":0}');
  return { ...f, primary: env, instrumentation: installContentionWorkers(f) };
}
/** Establish one real native observation for agent B using the existing driver.
 * @param f - Owned fixture.
 * @returns Original identical action for the one-use consumer.
 */
export function readyAgent(f: NativeFixture) {
  const action = { ...f.action(), agent_id: "B" },
    self = { ...f.self(), agent_id: "B" },
    fetch = { ...f.fetch(), agent_id: "B" };
  if (f.runEvent(action).status !== 2 || f.runEvent(self).status !== 0)
    throw Error("Native pending/self admission failed");
  f.after(self, selfResult());
  if (f.runEvent(fetch).status !== 0)
    throw Error("Native fetch admission failed");
  f.after(fetch, fetchResult());
  return action;
}
/** Initialize the stable epoch by genuinely established ordinary work.
 * @param f - Owned configured primary fixture.
 * @returns Stable real action and successful setup evidence.
 */
async function initialize(f: ReturnType<typeof contentionFixture>) {
  const event = { ...f.action(), agent_id: "A" };
  const initial = await startNativeHook(f, event, f.primary).terminal;
  if (initial.status !== 0)
    throw Error("Real scoped primary initialization failed");
  writeFileSync(path.join(f.root, "effects-A.json"), '{"calls":0}');
  return {
    event,
    initial,
    agentB: readyAgent(f),
    before: nativeStateHashes(f),
  };
}
/** Run one contender with a rendezvous established before its actual syscall.
 * @param f - Owned fixture.
 * @param event - Ordinary action.
 * @param holder - Actual exclusive state callback.
 * @param exhaust - Keep the owner until finite refusal.
 * @returns Fixed owner result and passive EEXIST observation.
 */
async function contend(
  f: ReturnType<typeof contentionFixture>,
  event: NativeEvent,
  holder: Awaited<ReturnType<typeof holdNativeLock>>,
  exhaust: boolean
) {
  const lock = path.join(
    f.root,
    "lisa-verification-gate",
    `readiness-${holder.key}.json.lock`
  );
  const marker = path.join(f.root, "contender-eexist");
  const watcher = watch(f.root, () => {
    if (!exhaust && existsSync(marker)) void holder.release();
  });
  const hook = startNativeHook(f, event, {
    ...f.primary,
    NODE_OPTIONS: `--require ${f.instrumentation.observer}`,
    FIXTURE_OBSERVED_LOCK: lock,
    FIXTURE_CONTENDED: marker,
  });
  try {
    const result = await hook.terminal;
    const heldAfter = existsSync(lock);
    const contended = existsSync(marker) ? readFileSync(marker, "utf8") : null;
    if (exhaust) await holder.release();
    return { result, heldAfter, contended };
  } finally {
    watcher.close();
    hook.stop();
    await hook.terminal;
  }
}
/** Hold A, prove B usable, then release only after actual contender EEXIST.
 * @param f - Owned configured primary fixture.
 * @param exhaust - Keep legitimate owner until contender reaches its finite refusal.
 * @returns Real hook/callback/epoch/effect observations.
 */
export async function contendedOrdinary(
  f: ReturnType<typeof contentionFixture>,
  exhaust = false
) {
  const initialized = await initialize(f);
  const holder = await holdNativeLock(
    f,
    initialized.event,
    f.primary,
    f.instrumentation.worker
  );
  try {
    const independent = await startNativeHook(f, initialized.agentB, f.env)
      .terminal;
    const afterB = nativeStateHashes(f);
    const result = await contend(f, initialized.event, holder, exhaust);
    const holderExit = await holder.release();
    return {
      initial: initialized.initial,
      independent,
      ...result,
      before: initialized.before,
      afterB,
      after: nativeStateHashes(f),
      request: initialized.event,
      key: holder.key,
      holderExit,
      inputs: Object.fromEntries(
        [
          ".lisa.config.json",
          ".lisa/work-item-context.md",
          "native-lock-holder.mjs",
          "native-lock-observer.cjs",
        ].map(name => [
          name,
          createHash("sha256")
            .update(readFileSync(path.join(f.root, name)))
            .digest("hex"),
        ])
      ),
      source_journal: readFileSync(path.join(f.root, "calls.jsonl"), "utf8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map(l => JSON.parse(l)),
    };
  } finally {
    await holder.release();
  }
}
