/**
 * Provider-backed single-writer tests for AWS bootstrap publication.
 * @module tests/unit/secrets/aws-bootstrap-publication-lock
 */
import { describe, expect, it, vi } from "vitest";

import {
  acquirePublicationLock,
  releasePublicationLock,
} from "../../../plugins/src/base/skills/lisa-secrets-access/scripts/publish-aws-bootstrap.mjs";
import {
  COORDINATION_KEY_PREFIX,
  normalizeRows,
} from "../../../plugins/src/base/skills/lisa-secrets-access/scripts/providers.mjs";

const PROVIDER_ID = "provider-id";
const PROJECT_ID = "project-id";
const ACTIVE_AT = "2026-08-26T15:00:00.000Z";
const cfg = { provider: "bitwarden" };
const target = {
  id: PROVIDER_ID,
  projectId: PROJECT_ID,
  value: "provider-value",
};

/**
 * Build one provider-issued coordination row.
 * @param id Provider record id and holder suffix.
 * @param createdAt Provider-issued creation time.
 * @param targetId Target provider record id.
 * @returns Synthetic coordination row.
 */
function lockRow(id: string, createdAt: string, targetId = PROVIDER_ID) {
  return {
    id,
    key: `${COORDINATION_KEY_PREFIX}AWS_BOOTSTRAP_${targetId}_${id}`,
    value: "coordination-only",
    projectId: PROJECT_ID,
    creationDate: createdAt,
  };
}

/**
 * Model provider deletion with a list that changes immediately afterward.
 * @param initial Rows initially visible to the provider client.
 * @returns Injectable provider operations and their spies.
 */
function providerState(initial: Array<ReturnType<typeof lockRow>>) {
  const rows = [...initial];
  const removeCoordination = vi.fn((_cfg: object, id: string) => {
    const index = rows.findIndex(row => row.id === id);
    if (index >= 0) rows.splice(index, 1);
  });
  return {
    fetchRaw: vi.fn(() => [...rows]),
    removeCoordination,
  };
}

describe("AWS bootstrap provider locking", () => {
  it("selects the oldest active contender and refuses the overlap", () => {
    const existing = lockRow("holder-a", ACTIVE_AT);
    const contender = lockRow("holder-b", "2026-08-26T15:00:01.000Z");
    const state = providerState([existing, contender]);

    expect(() =>
      acquirePublicationLock(cfg, target, {
        createCoordination: vi.fn(() => contender),
        ...state,
        holderId: vi.fn(() => "holder-b"),
      })
    ).toThrow("another publisher holds the provider lock");
    expect(state.removeCoordination).toHaveBeenCalledWith(cfg, contender.id);
  });

  it("recovers an expired contender before taking the lock", () => {
    const expired = lockRow("expired", "2026-08-26T14:00:00.000Z");
    const contender = lockRow("current", ACTIVE_AT);
    const state = providerState([expired, contender]);

    const lock = acquirePublicationLock(cfg, target, {
      createCoordination: vi.fn(() => contender),
      ...state,
      holderId: vi.fn(() => "current"),
    });

    expect(lock.id).toBe(contender.id);
    expect(state.removeCoordination).toHaveBeenCalledWith(cfg, expired.id);
  });

  it("refuses a lock the provider does not make observable", () => {
    const contender = lockRow("invisible", ACTIVE_AT);
    const state = providerState([]);

    expect(() =>
      acquirePublicationLock(cfg, target, {
        createCoordination: vi.fn(() => contender),
        ...state,
        holderId: vi.fn(() => "invisible"),
      })
    ).toThrow("could not be observed");
    expect(state.removeCoordination).toHaveBeenCalledWith(cfg, contender.id);
  });

  it("cleans up its contender when an existing lock has invalid metadata", () => {
    const malformed = lockRow("malformed", "not-a-date");
    const contender = lockRow("current", ACTIVE_AT);
    const state = providerState([malformed, contender]);

    expect(() =>
      acquirePublicationLock(cfg, target, {
        createCoordination: vi.fn(() => contender),
        ...state,
        holderId: vi.fn(() => "current"),
      })
    ).toThrow("has no valid provider creation time");
    expect(state.removeCoordination).toHaveBeenCalledWith(cfg, contender.id);
  });

  it("verifies provider deletion when releasing the lock", () => {
    const lock = lockRow("holder", ACTIVE_AT);
    const state = providerState([lock]);

    releasePublicationLock(cfg, lock, {
      ...state,
    });

    expect(state.removeCoordination).toHaveBeenCalledWith(cfg, lock.id);
  });

  it("fails closed when provider deletion does not remove the lock", () => {
    const lock = lockRow("holder", ACTIVE_AT);

    expect(() =>
      releasePublicationLock(cfg, lock, {
        fetchRaw: vi.fn(() => [lock]),
        removeCoordination: vi.fn(),
      })
    ).toThrow("still present after deletion");
  });

  it("never exposes coordination rows as credentials", () => {
    const selected = normalizeRows([
      lockRow("holder", ACTIVE_AT),
      {
        id: "real-id",
        key: "REAL",
        value: "1",
        projectId: PROJECT_ID,
      },
    ]);

    expect([...selected.keys()]).toEqual(["REAL"]);
  });

  it("preserves project and creation metadata needed by the lock", () => {
    const selected = normalizeRows([
      {
        id: "real-id",
        key: "REAL",
        value: "1",
        projectId: PROJECT_ID,
        creationDate: ACTIVE_AT,
      },
    ]);

    expect(selected.get("REAL")).toMatchObject({
      creationDate: ACTIVE_AT,
      projectId: PROJECT_ID,
    });
  });
});
