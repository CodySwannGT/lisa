/**
 * Contract tests for the rotation view of the provider.
 *
 * `excludeKeys` keeps a credential off a surface's disk. It was also applied to
 * the rotation path, which hid the provider record itself — so `rotating` and
 * `excludeKeys` became mutually exclusive for one name, and a credential you
 * cannot see is one you cannot write back to. These pin the narrow waiver that
 * resolves it, and the boundaries it must never cross.
 * @module tests/unit/secrets/rotation-view
 */
import { describe, expect, it } from "vitest";

import {
  normalizeRows,
  rotationNarrow,
} from "../../../plugins/src/base/skills/lisa-secrets-access/scripts/providers.mjs";

/** A synthetic provider row, shaped like what `fetchRaw` returns. */
type Row = {
  key: string;
  value: string;
  note?: string;
  projectId?: string | null;
  id?: string | null;
};

/** The project every synthetic row belongs to unless a test says otherwise. */
const PROJECT = "project-a";

const row = (key: string, value: string, extra: Partial<Row> = {}): Row => ({
  key,
  value,
  note: "",
  projectId: PROJECT,
  id: `id-${key}`,
  ...extra,
});

describe("rotation view", () => {
  // That mutual exclusion is backwards for a consumable credential: the kind you
  // least want materialized onto an untrusted surface is the kind that most
  // needs a proven write path.

  it("waives an exclusion for a declared rotating name", () => {
    const narrow = rotationNarrow({
      rotating: ["ROTATING_TOKEN"],
      narrow: { projectIds: [], excludeKeys: ["ROTATING_TOKEN"] },
    });
    expect(narrow.excludeKeys).toEqual([]);

    const rows = [row("ROTATING_TOKEN", "v", { id: "abc-123" })];
    expect(normalizeRows(rows, narrow).get("ROTATING_TOKEN")?.id).toBe(
      "abc-123"
    );
  });

  it("keeps the exclusion for a name that is not declared rotating", () => {
    const narrow = rotationNarrow({
      rotating: ["ROTATING_TOKEN"],
      narrow: { projectIds: [], excludeKeys: ["ROTATING_TOKEN", "PLAIN_KEY"] },
    });
    expect(narrow.excludeKeys).toEqual(["PLAIN_KEY"]);

    const rows = [row("PLAIN_KEY", "1"), row("ROTATING_TOKEN", "2")];
    expect([...normalizeRows(rows, narrow).keys()]).toEqual(["ROTATING_TOKEN"]);
  });

  it("never widens the provider's own project grant", () => {
    // The waiver is for the repo-declared exclusion list only. Project scoping
    // is the provider's boundary and must survive untouched.
    const narrow = rotationNarrow({
      rotating: ["ROTATING_TOKEN"],
      narrow: { projectIds: [PROJECT], excludeKeys: ["ROTATING_TOKEN"] },
    });
    expect(narrow.projectIds).toEqual([PROJECT]);

    const rows = [
      row("ROTATING_TOKEN", "1", { projectId: "project-b" }),
      row("IN_SCOPE", "2", { projectId: PROJECT }),
    ];
    expect([...normalizeRows(rows, narrow).keys()]).toEqual(["IN_SCOPE"]);
  });

  it("is a no-op when nothing is declared rotating", () => {
    const narrow = rotationNarrow({
      narrow: { projectIds: [], excludeKeys: ["DROP"] },
    });
    expect(narrow.excludeKeys).toEqual(["DROP"]);
  });
});
