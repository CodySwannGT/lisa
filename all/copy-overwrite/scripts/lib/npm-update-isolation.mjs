// This file is managed by Lisa. Durable changes belong upstream.
/** Public worker facade preserves the managed command import surface without initialization. @module npm-updater */
export { workerArguments } from "./npm-update-worker-policy.mjs";
export { assertWorkerInspection } from "./npm-update-worker-inspection.mjs";
export {
  executeWorker,
  recoverWorkers,
  binaryDigest,
} from "./npm-update-worker-lifecycle.mjs";
