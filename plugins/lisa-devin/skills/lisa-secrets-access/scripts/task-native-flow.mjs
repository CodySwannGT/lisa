/** One pending action, fixed native probes, one atomic identical-action release. */
import {
  fingerprint,
  notionProbe,
  validateNotionSelf,
  validateNotionFetch,
} from "./task-native-contract.mjs";
import {
  sessionKey,
  withNativeState,
  generation,
} from "./task-native-state.mjs";
import { configDigest } from "./task-requirements.mjs";
import {
  atlassianSupported,
  atlassianProbe,
  validateAtlassian,
  isAtlassianProbe,
} from "./task-atlassian-native.mjs";
const supported = r =>
  (r?.access_layer === "notion" && r.operation === "database-read") ||
  atlassianSupported(r);
const code = error =>
  ["identity-mismatch", "native-response-unrepresented"].includes(error?.code)
    ? error.code
    : "native-response-unrepresented";
const denied = (c = "native-proof-needed") => ({ allowed: false, code: c });
const allowed = () => ({ allowed: true, code: "native-probe" });
const reset = state => {
  state.phase = "pending";
  state.flight = null;
  state.pending.forEach(row => {
    row.step = 0;
    row.connection = null;
  });
  return state;
};
const action = e =>
  fingerprint({
    tool: e.tool_name,
    input: e.tool_input,
    connector: e.mcp_server ?? null,
  });
const scope = (cfg, header, readiness) =>
  fingerprint({
    header,
    config: configDigest(cfg),
    sources: readiness.pending.map(p => [
      p.requirement_index,
      p.source_available === true,
      p.primary_available === true,
    ]),
  });
const call = event =>
  typeof event.tool_use_id === "string" && event.tool_use_id
    ? fingerprint(event.tool_use_id)
    : null;
const rows = (result, header) =>
  result.pending.map(p => ({
    index: p.requirement_index,
    scope: fingerprint(header.required_access[p.requirement_index - 1]),
    step: 0,
    connection: null,
  }));
const fresh = (key, scoped, event, pending, spent = []) => ({
  schema: 1,
  session: key,
  scope: scoped,
  action: action(event),
  generation: generation(),
  phase: "pending",
  pending,
  flight: null,
  spent,
  failure: null,
});

/** A different ordinary action starts a fresh generation, never reusing a proof. */
function ordinary(state, key, scoped, event, pending) {
  if (
    !state ||
    state.scope !== scoped ||
    state.action !== action(event) ||
    state.phase === "consumed"
  )
    return {
      state: fresh(key, scoped, event, pending, state?.spent),
      result: denied(),
    };
  if (!call(event))
    return {
      state: reset(state),
      result: denied("native-response-unrepresented"),
    };
  if (state.phase === "ready" && state.pending.every(p => p.step === 2)) {
    state.phase = "consumed";
    return { state, result: { allowed: true, code: "native-one-use" } };
  }
  if (state.flight) reset(state);
  return { state, result: denied(state.failure ?? "native-proof-needed") };
}

/** Only the next documented self/fetch call may run while ordinary work is withheld. */
function beforeProbe(state, cfg, header, event) {
  const row = state.pending.find(p => p.step !== 2);
  const requirement = header.required_access[row?.index - 1];
  if (!supported(requirement))
    return { state, result: denied("native-response-unrepresented") };
  const found =
      requirement.access_layer === "atlassian"
        ? atlassianProbe(event, requirement, cfg)
        : notionProbe(event, requirement),
    descriptor = found
      ? { ...found, connection: fingerprint(event.mcp_server) }
      : null,
    id = call(event);
  if (!descriptor || !id || state.spent.includes(id) || state.flight)
    return {
      state: reset(state),
      result: denied("native-response-unrepresented"),
    };
  if (
    (row.step === 0 && descriptor.kind !== "self") ||
    (row.step === 1 && descriptor.kind !== "fetch")
  )
    return { state, result: denied() };
  if (row.connection && row.connection !== descriptor.connection) {
    row.step = 0;
    row.connection = null;
    return { state, result: denied("identity-mismatch") };
  }
  state.failure = null;
  state.flight = {
    index: row.index,
    kind: descriptor.kind,
    call: id,
    input: action(event),
    connection: descriptor.connection,
  };
  return { state, result: allowed() };
}

/** Unsolicited, mismatched, failed or malformed after events cannot mint an observation. */
function afterProbe(state, cfg, header, event) {
  const flight = state.flight;
  if (
    !flight ||
    flight.call !== call(event) ||
    flight.input !== action(event)
  ) {
    state.flight = null;
    state.phase = "pending";
    state.pending.forEach(r => {
      r.step = 0;
      r.connection = null;
    });
    return { state, result: denied("native-response-unrepresented") };
  }
  const row = state.pending.find(p => p.index === flight.index),
    requirement = header.required_access[flight.index - 1];
  state.spent.push(flight.call);
  state.flight = null;
  try {
    if (event.hook_event_name !== "PostToolUse") throw Error();
    if (requirement.access_layer === "atlassian")
      validateAtlassian(flight.kind, event.tool_response, requirement, cfg);
    else if (flight.kind === "self")
      validateNotionSelf(event.tool_response, cfg);
    else validateNotionFetch(event.tool_response, requirement);
    row.step = flight.kind === "self" ? 1 : 2;
    row.connection = flight.connection;
    state.failure = null;
    state.phase = state.pending.every(p => p.step === 2) ? "ready" : "pending";
    return { state, result: allowed() };
  } catch (error) {
    row.step = 0;
    row.connection = null;
    state.phase = "pending";
    state.failure = code(error);
    return { state, result: denied(state.failure) };
  }
}

/** Run only from the registered native owner entrypoints, never a metadata attestation. */
export function nativeAction(cfg, header, readiness, event) {
  const key = sessionKey(event, cfg.projectRoot),
    scoped = scope(cfg, header, readiness);
  return withNativeState(key, existing => {
    if (!header || readiness.outcome !== "NATIVE_OWNER_REQUIRED")
      return { state: null, result: denied() };
    const pending = rows(readiness, header);
    const same =
      existing?.scope === scoped &&
      fingerprint(existing.pending.map(r => [r.index, r.scope])) ===
        fingerprint(pending.map(r => [r.index, r.scope]));
    const state = same ? existing : null;
    if (event.hook_event_name !== "PreToolUse")
      return state
        ? afterProbe(state, cfg, header, event)
        : { state: null, result: denied() };
    if (
      event.tool_name === "Skill" &&
      readiness.pending.some(p => p.owner === event.tool_input?.skill) &&
      Object.keys(event.tool_input).length === 1
    )
      return {
        state: state?.phase === "ready" ? reset(state) : state,
        result: allowed(),
      };
    if (
      [
        "mcp__claude_ai_Notion__notion-get-self",
        "mcp__claude_ai_Notion__notion-fetch",
      ].includes(event.tool_name) ||
      isAtlassianProbe(event)
    ) {
      if (state?.phase === "ready") reset(state);
      const next = state?.pending.find(p => p.step !== 2);
      if (
        readiness.pending.find(p => p.requirement_index === next?.index)
          ?.primary_available
      )
        return { state, result: denied("native-response-unrepresented") };
      return state
        ? beforeProbe(state, cfg, header, event)
        : { state: null, result: denied() };
    }
    if (readiness.pending.some(p => p.primary_available))
      return {
        state: fresh(key, scoped, event, pending, state?.spent),
        result: denied("native-response-unrepresented"),
      };
    return ordinary(state, key, scoped, event, pending);
  });
}

/** Orientation never extends a ready proof or preserves a concurrent in-flight probe. */
export function invalidateNative(event, cfg) {
  if (!event?.session_id) return;
  withNativeState(sessionKey(event, cfg.projectRoot), state => ({
    state: state?.phase === "ready" || state?.flight ? null : state,
    result: null,
  }));
}

/** A failure, primary resolution, or session end invalidates all prior observations. */
export function clearNative(event, cfg) {
  if (!event?.session_id) return;
  withNativeState(sessionKey(event, cfg.projectRoot), () => ({
    state: null,
    result: null,
  }));
}
