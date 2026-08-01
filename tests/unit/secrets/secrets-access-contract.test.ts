/**
 * Contract tests for the `lisa-secrets-access` executable surface.
 *
 * The skill's rules are only worth having if they hold under the cases that
 * actually caused incidents: a value containing a quote, the same key visible
 * twice, a credential with no usage note, and a materialized copy shadowing (or
 * being shadowed by) an injected environment variable.
 *
 * Retrieval is deliberately separated from selection in the implementation, so
 * every rule below is exercised against synthetic rows — no test process is ever
 * granted access to a real secret.
 * @module tests/unit/secrets/secrets-access-contract
 */
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  parseEnv,
  quote,
  renderEnv,
  renderNotes,
} from "../../../plugins/src/base/skills/lisa-secrets-access/scripts/envfile.mjs";
import {
  LEASE_KEY,
  normalizeRows,
} from "../../../plugins/src/base/skills/lisa-secrets-access/scripts/providers.mjs";
import {
  loadNotes,
  noteFor,
} from "../../../plugins/src/base/skills/lisa-secrets-access/scripts/read-secret-note.mjs";
import {
  get,
  readMaterialized,
} from "../../../plugins/src/base/skills/lisa-secrets-access/scripts/resolve-secret.mjs";
import {
  SURFACES,
  assertNamespace,
  detectSurface,
  materializedPaths,
} from "../../../plugins/src/base/skills/lisa-secrets-access/scripts/surfaces.mjs";

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

/** Namespace used by the materialized-file fixtures. */
const NAMESPACE = "test-ns";

/** The one surface that materializes values to disk. */
const CODEX_CLOUD = "codex-cloud";

/** The two materialized filenames, kept in one place as the contract names them. */
const VALUES_FILE = "secrets.env";
const NOTES_FILE = "secret-notes.json";

const row = (key: string, value: string, extra: Partial<Row> = {}): Row => ({
  key,
  value,
  note: "",
  projectId: PROJECT,
  id: `id-${key}`,
  ...extra,
});

const cfgFor = (
  surface: string,
  overrides: Record<string, unknown> = {}
): Record<string, unknown> => ({
  provider: "env",
  bootstrap: { sources: ["env"], key: null },
  require: null,
  rotating: [],
  namespace: NAMESPACE,
  narrow: { projectIds: [], excludeKeys: [] },
  surface,
  capabilities: SURFACES[surface as keyof typeof SURFACES],
  ...overrides,
});

describe("envfile format", () => {
  it("round-trips a value containing a single quote", () => {
    // The failure this guards: a writer and parser that drift apart corrupt
    // exactly the values hardest to notice, and do it silently.
    const selected = new Map([["K", { value: "tricky'value", note: "" }]]);
    expect(parseEnv(renderEnv(selected)).get("K")).toBe("tricky'value");
  });

  it("round-trips values containing shell metacharacters", () => {
    const nasty = `$(rm -rf /) \`x\` "dq" \\ ; | & newline-free`;
    const selected = new Map([["K", { value: nasty, note: "" }]]);
    expect(parseEnv(renderEnv(selected)).get("K")).toBe(nasty);
  });

  it("quotes with POSIX single quotes so no expansion can occur", () => {
    expect(quote("a'b")).toBe(`'a'\\''b'`);
  });

  it("writes values sorted and prefixed with a do-not-read warning", () => {
    const selected = new Map([
      ["B_KEY", { value: "2", note: "" }],
      ["A_KEY", { value: "1", note: "" }],
    ]);
    const lines = renderEnv(selected).trim().split("\n");
    expect(lines[0]).toMatch(/^#/);
    expect(lines.at(-2)).toContain("A_KEY");
    expect(lines.at(-1)).toContain("B_KEY");
  });

  it("skips lines it does not recognise rather than guessing", () => {
    const parsed = parseEnv("export GOOD='x'\ngarbage\nexport BAD=unquoted\n");
    expect([...parsed.keys()]).toEqual(["GOOD"]);
  });

  it("renders notes with every value omitted", () => {
    const selected = new Map([["K", { value: "super-secret", note: "usage" }]]);
    const rendered = renderNotes(selected);
    expect(rendered).not.toContain("super-secret");
    expect(JSON.parse(rendered)).toEqual({
      schemaVersion: 1,
      secrets: { K: "usage" },
    });
  });
});

describe("exposure boundary", () => {
  it("exports every valid key the provider grants by default", () => {
    const selected = normalizeRows([row("A_KEY", "1"), row("B_KEY", "2")]);
    expect([...selected.keys()]).toEqual(["A_KEY", "B_KEY"]);
  });

  it("narrows by project without ever widening", () => {
    const rows = [
      row("IN_SCOPE", "1", { projectId: PROJECT }),
      row("OUT_OF_SCOPE", "2", { projectId: "project-b" }),
    ];
    const selected = normalizeRows(rows, {
      projectIds: [PROJECT],
      excludeKeys: [],
    });
    expect([...selected.keys()]).toEqual(["IN_SCOPE"]);
  });

  it("honours an exact-name exclusion", () => {
    const rows = [row("KEEP", "1"), row("DROP", "2")];
    const selected = normalizeRows(rows, {
      projectIds: [],
      excludeKeys: ["DROP"],
    });
    expect([...selected.keys()]).toEqual(["KEEP"]);
  });

  it("fails closed on a duplicate exact-name key", () => {
    // Last-wins would make which credential gets used depend on provider
    // response order — neither stable nor visible at the call site.
    const rows = [row("SAME", "first"), row("SAME", "second")];
    expect(() => normalizeRows(rows)).toThrow(/duplicate secret key/i);
  });

  it("never exposes the rotation lease record as a credential", () => {
    const selected = normalizeRows([row(LEASE_KEY, "{}"), row("REAL", "1")]);
    expect([...selected.keys()]).toEqual(["REAL"]);
  });

  it("skips keys that are not valid shell variable names", () => {
    const selected = normalizeRows([
      row("attio-prod", "1"),
      row("OK_KEY", "2"),
    ]);
    expect([...selected.keys()]).toEqual(["OK_KEY"]);
  });

  it("rejects a non-string value rather than coercing it", () => {
    const rows = [{ key: "K", value: 42 as unknown as string }];
    expect(() => normalizeRows(rows)).toThrow(/not a string/i);
  });

  it("preserves the provider identifier needed to write a rotation back", () => {
    const selected = normalizeRows([row("K", "v", { id: "abc-123" })]);
    expect(selected.get("K")?.id).toBe("abc-123");
  });
});

describe("surfaces", () => {
  it("declares capabilities rather than branching on names", () => {
    expect(SURFACES.local.materialized).toBe(false);
    expect(SURFACES.local.mayWriteValues).toBe(false);
    expect(SURFACES[CODEX_CLOUD].materialized).toBe(true);
    expect(SURFACES[CODEX_CLOUD].mayWriteValues).toBe(true);
  });

  it("lets an explicit surface override detection", () => {
    const env = { LISA_SECRETS_SURFACE: CODEX_CLOUD, GITHUB_ACTIONS: "true" };
    expect(detectSurface(null, env)).toBe(CODEX_CLOUD);
  });

  it("detects a CI runner", () => {
    expect(detectSurface(null, { GITHUB_ACTIONS: "true" })).toBe(
      "github-actions"
    );
  });

  it("falls back to local", () => {
    expect(detectSurface(null, {})).toBe("local");
  });

  it("rejects an unknown surface by name", () => {
    expect(() => detectSurface(null, { LISA_SECRETS_SURFACE: "nope" })).toThrow(
      /unknown surface/i
    );
  });

  it.each(["../escape", "a/b", "", ".."])(
    "rejects namespace %j as unsafe",
    bad => {
      expect(() => assertNamespace(bad)).toThrow(/one safe path segment/i);
    }
  );

  it("places both files inside a single namespaced directory", () => {
    const ns = "ns";
    const root = "/cfg";
    const paths = materializedPaths(ns, { XDG_CONFIG_HOME: root });
    expect(paths.dir).toBe(path.join(root, ns));
    expect(paths.valuesFile).toBe(path.join(root, ns, VALUES_FILE));
    expect(paths.notesFile).toBe(path.join(root, ns, NOTES_FILE));
  });
});

describe("resolution ladder", () => {
  let configRoot: string;
  let previousConfigHome: string | undefined;

  beforeEach(() => {
    configRoot = mkdtempSync(path.join(tmpdir(), "lisa-secrets-"));
    previousConfigHome = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = configRoot;
    const dir = path.join(configRoot, NAMESPACE);
    const selected = new Map([
      ["FROM_FILE", { value: "file-value", note: "" }],
      ["SHADOWED", { value: "file-loses", note: "" }],
    ]);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, VALUES_FILE), renderEnv(selected));
    writeFileSync(path.join(dir, NOTES_FILE), renderNotes(selected));
  });

  afterEach(() => {
    if (previousConfigHome === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = previousConfigHome;
    delete process.env.SHADOWED;
    rmSync(configRoot, { recursive: true, force: true });
  });

  it("reads the materialized file on a surface that has one", () => {
    expect(get("FROM_FILE", cfgFor(CODEX_CLOUD))).toBe("file-value");
  });

  it("lets an injected environment variable win over the file", () => {
    // CI injects secrets directly; a stale materialized copy must never
    // outrank what the pipeline supplied for this run.
    process.env.SHADOWED = "env-wins";
    expect(get("SHADOWED", cfgFor(CODEX_CLOUD))).toBe("env-wins");
  });

  it("has no file rung on a surface that can read through live", () => {
    expect(readMaterialized(cfgFor("local")).size).toBe(0);
  });

  it("treats an undeclared name as a configuration error when require is set", () => {
    const cfg = cfgFor(CODEX_CLOUD, { require: ["ONLY_THIS"] });
    expect(() => get("FROM_FILE", cfg)).toThrow(
      /not declared in secrets.require/i
    );
  });
});

describe("usage notes", () => {
  let notesFile: string;
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "lisa-notes-"));
    notesFile = path.join(dir, NOTES_FILE);
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("reads a note without opening the values file", () => {
    const value = "tOpS3cr3t-must-never-appear";
    const selected = new Map([["K", { value, note: "purpose" }]]);
    writeFileSync(notesFile, renderNotes(selected));
    expect(readFileSync(notesFile, "utf8")).not.toContain(value);
    expect(noteFor("K", loadNotes(notesFile))).toBe("purpose");
  });

  it("treats a missing note as a stop condition for that credential", () => {
    // Carrying on with an inferred purpose is how a token scoped to one
    // repository gets used against another, silently.
    const selected = new Map([["K", { value: "v", note: "" }]]);
    writeFileSync(notesFile, renderNotes(selected));
    expect(() => noteFor("K", loadNotes(notesFile))).toThrow(/stop condition/i);
  });

  it("rejects a manifest version it does not understand", () => {
    writeFileSync(
      notesFile,
      JSON.stringify({ schemaVersion: 99, secrets: {} })
    );
    expect(() => loadNotes(notesFile)).toThrow(/malformed|unsupported/i);
  });

  it("refuses a key that is not an exact environment-variable name", () => {
    expect(() => noteFor("../etc", {})).toThrow(
      /exact environment-variable name/i
    );
  });

  it("explains how to fix an absent manifest", () => {
    expect(() => loadNotes(path.join(dir, "absent.json"))).toThrow(
      /bootstrap/i
    );
  });
});
