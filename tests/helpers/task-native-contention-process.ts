/** Owned fixture-only async hook and legitimate state-lock holder. */
import { spawn } from "node:child_process";
import { Worker } from "node:worker_threads";
import { once } from "node:events";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { nativeFixture } from "./task-native-events.js";
import {
  ioLatencyBudgetMs,
  BOUNDED_SPAWN_BASE_MS,
} from "./io-latency-budget.js";
/** The existing owned native-envelope fixture. */
export type NativeFixture = ReturnType<typeof nativeFixture>;
/** Native event data, never a success attestation. */
export type NativeEvent = ReturnType<NativeFixture["action"]> & {
  agent_id?: string;
};
/** Kill only the fixture process group created by this driver.
 * @param pid - Owned detached leader.
 */
function stopOwned(pid: number | undefined) {
  if (pid)
    try {
      process.kill(-pid, "SIGKILL");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
    }
}
/** Start the real registered hook; only its terminal exit controls the recorder.
 * @param f - Owned isolated fixture.
 * @param event - Actual native envelope.
 * @param env - Complete isolated child environment.
 * @returns Owned terminal promise and cancellation for exceptional cleanup.
 */
export function startNativeHook(
  f: NativeFixture,
  event: NativeEvent,
  env: Record<string, string>
) {
  const started = performance.now();
  const effects = path.join(f.root, `effects-${event.agent_id ?? "A"}.json`);
  const child = spawn(
    "/bin/bash",
    [path.join(f.plugin, "hooks/secrets-preflight.sh"), "--task-hook"],
    {
      cwd: f.root,
      env,
      stdio: ["pipe", "pipe", "pipe"],
      detached: true,
    }
  );
  const watchdog = setTimeout(
    () => stopOwned(child.pid),
    ioLatencyBudgetMs(BOUNDED_SPAWN_BASE_MS)
  );
  const terminal = Promise.all([
    once(child, "close"),
    child.stdout.toArray(),
    child.stderr.toArray(),
  ])
    .then(([outcome, stdout, stderr]) => {
      const [status, signal] = outcome as [
        number | null,
        NodeJS.Signals | null,
      ];
      const prior = JSON.parse(readFileSync(effects, "utf8")).calls;
      const result = {
        status,
        signal,
        elapsedMs: performance.now() - started,
        stdout: Buffer.concat(stdout).toString(),
        stderr: Buffer.concat(stderr).toString(),
        effects: prior + (status === 0 ? 1 : 0),
      };
      if (status === 0)
        writeFileSync(effects, JSON.stringify({ calls: result.effects }));
      return result;
    })
    .finally(() => {
      clearTimeout(watchdog);
      stopOwned(child.pid);
    });
  child.stdin.end(JSON.stringify(event));
  return { child, terminal, stop: () => stopOwned(child.pid) };
}
/** Write only instrumentation into the fixture; observer preserves the real EEXIST.
 * @param f - Owned fixture.
 * @returns Private worker and passive preload locations.
 */
export function installContentionWorkers(f: NativeFixture) {
  const worker = path.join(f.root, "native-lock-holder.mjs"),
    observer = path.join(f.root, "native-lock-observer.cjs");
  writeFileSync(
    worker,
    `import {workerData,parentPort} from 'node:worker_threads';import {pathToFileURL} from 'node:url';const {sessionKey,withNativeState}=await import(pathToFileURL(workerData.owner));const key=sessionKey(workerData.event,workerData.root);withNativeState(key,state=>{parentPort.postMessage({event:'LOCK_HELD',key,phase:state?.phase??null});const control=new Int32Array(workerData.control);if(Atomics.wait(control,0,0,workerData.budget)==='timed-out')throw Error('Owned holder rendezvous timed out');return {state,result:null};});parentPort.postMessage({event:'RELEASED'});`,
    { flag: "wx", mode: 0o600 }
  );
  writeFileSync(
    observer,
    `const fs=require('node:fs'),{syncBuiltinESMExports}=require('node:module');const original=fs.openSync;fs.openSync=function(p,flags){try{return Reflect.apply(original,this,arguments);}catch(error){if(p===process.env.FIXTURE_OBSERVED_LOCK&&flags==='wx'&&error.code==='EEXIST'){try{fs.writeFileSync(process.env.FIXTURE_CONTENDED,'EEXIST',{flag:'wx',mode:0o600});}catch{}}throw error;}};syncBuiltinESMExports();`,
    { flag: "wx", mode: 0o600 }
  );
  return { worker, observer };
}
/** Acquire using the actual state owner before signalling LOCK_HELD.
 * @param f - Owned fixture.
 * @param event - Stable real root/session/agent key.
 * @param env - Complete isolated worker environment.
 * @param workerPath - Private readable worker script.
 * @returns Legitimate holder, observed key and release/join operation.
 */
export async function holdNativeLock(
  f: NativeFixture,
  event: NativeEvent,
  env: Record<string, string>,
  workerPath: string
) {
  const control = new Int32Array(new SharedArrayBuffer(4));
  const worker = new Worker(workerPath, {
    env,
    workerData: {
      owner: path.join(
        f.plugin,
        "skills/lisa-secrets-access/scripts/task-native-state.mjs"
      ),
      event,
      root: f.root,
      control: control.buffer,
      budget: ioLatencyBudgetMs(BOUNDED_SPAWN_BASE_MS),
    },
  });
  const terminal = once(worker, "exit");
  const [held] = await once(worker, "message");
  if (held.event !== "LOCK_HELD")
    throw Error("Real lock acquisition not observed");
  return {
    worker,
    key: String(held.key),
    phase: held.phase,
    release: async () => {
      Atomics.store(control, 0, 1);
      Atomics.notify(control, 0);
      const [exit] = await terminal;
      if (exit !== 0) throw Error("Owned holder failed");
      return 0;
    },
  };
}
