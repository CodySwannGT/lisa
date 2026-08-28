// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/** Shared bounded provider transport and authority checks. */
import { CONDITION_MARKER } from "./reconcile-nightly-e2e-tracking.mjs";

/** Throw a bounded diagnostic without response or credential data. */
export function refuse(destination, operation, status = "provider error") {
  throw new Error(
    `Nightly E2E ${destination} ${operation} refused: ${status}`.slice(0, 4096)
  );
}

/** Read a required environment value without echoing it. */
export function required(input, destination, name) {
  const value = input.env[name];
  if (!value?.trim()) refuse(destination, "configuration", `missing ${name}`);
  return value;
}

/** Require an exact post-write authority snapshot. */
export async function readback(destination, list, id, present) {
  const records = await list("readback");
  const exact = records.filter(record => record.id === id);
  if (
    present &&
    records.length === 1 &&
    exact.length === 1 &&
    exact[0].marker === CONDITION_MARKER
  ) {
    return exact[0];
  }
  if (!present && exact.length === 0 && records.length === 0) return null;
  refuse(destination, "readback", "tracker authority mismatch");
}

/** Default fetch transport used by the executable installed script. */
export async function fetchJson(request) {
  let response;
  try {
    response = await fetch(request.url, request.options);
  } catch {
    throw new Error("provider transport error");
  }
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  if (response.status === 204) return null;
  try {
    return await response.json();
  } catch {
    throw new Error("provider malformed response");
  }
}
