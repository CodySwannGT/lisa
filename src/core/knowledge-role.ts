/**
 * The required `knowledge` role: which backend holds this project's durable
 * knowledge.
 *
 * Flows use a knowledge backend for exactly two things — ask a question and
 * get an answer with sources, and record something learned. Everything else
 * (ingest connectors, lint, page types, categories) is the backend's own
 * business and lives in the backend's own configuration, the way `tracker`
 * names a vendor and the vendor section holds that vendor's settings.
 *
 * `llm-wiki` — the git-native wiki each repository owns at `wiki/` — is the
 * only backend today. The vocabulary is closed so a second backend is a new
 * value, not a new key.
 * @module core/knowledge-role
 */
import type { SyncedSetting } from "../sync/registry.js";

/** Every knowledge backend Lisa can serve, mapped to the plugin that implements it. */
export const KNOWLEDGE_BACKEND_PLUGINS: Readonly<Record<string, string>> =
  Object.freeze({ "llm-wiki": "lisa-wiki" });

/** The `knowledge` role's default backend, written by `lisa sync` when absent. */
export const DEFAULT_KNOWLEDGE_BACKEND = "llm-wiki";

/**
 * Validate a configured knowledge backend against the closed vocabulary.
 * @param value - Untrusted `knowledge` value from project config
 * @returns The validated backend name
 */
export function validateKnowledgeBackend(value: unknown): string {
  if (
    typeof value !== "string" ||
    !Object.hasOwn(KNOWLEDGE_BACKEND_PLUGINS, value)
  ) {
    const allowed = Object.keys(KNOWLEDGE_BACKEND_PLUGINS).join(", ");
    throw new Error(`Invalid knowledge: expected one of ${allowed}`);
  }
  return value;
}

/**
 * Resolve the plugin that implements a project's knowledge backend. An absent
 * value reads as the default, because the role is required and sync writes it;
 * an unrecognised value selects nothing and is reported by `lisa sync`.
 * @param value - Raw `knowledge` value from project config
 * @returns Plugin directory name, or undefined for an unrecognised backend
 */
export function knowledgePluginFor(value: unknown): string | undefined {
  const backend = value ?? DEFAULT_KNOWLEDGE_BACKEND;
  return typeof backend === "string" &&
    Object.hasOwn(KNOWLEDGE_BACKEND_PLUGINS, backend)
    ? KNOWLEDGE_BACKEND_PLUGINS[backend]
    : undefined;
}

/** The `lisa sync` registry entry that writes and validates the role. */
export const KNOWLEDGE_SYNCED_SETTING: SyncedSetting = {
  key: "knowledge",
  defaultValue: DEFAULT_KNOWLEDGE_BACKEND,
  validate: validateKnowledgeBackend,
  description: "Knowledge backend (required role; llm-wiki)",
};
