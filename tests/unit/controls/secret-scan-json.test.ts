/**
 * Finding credential-shaped values in a whole document, and saying where
 * each one is without ever saying what it is.
 *
 * Every credential-shaped value in this suite is made up when the test runs.
 * None is written in this file (CodySwannGT/lisa#4999).
 */
import { describe, expect, it } from "vitest";

import {
  VALUE_NOT_REPEATED,
  credentialProblemIn,
  redactJsonCredentials,
  scanJsonForCredentials,
  secretFindingLine,
  withoutCredentials,
} from "../../../src/controls/secret-scan-json.js";
import { fakeCredential } from "../../helpers/audit-probes.js";
import { fakeGithubToken } from "../../helpers/fake-credentials.js";

const TOKEN = fakeGithubToken();
const RANDOM = fakeCredential();
const FILE = ".lisa/controls/example.json";
const GITHUB = "GITHUB_TOKEN";
const SECRET = "SECRET";

/**
 * A finding of a value, as the scan reports one.
 * @param path - Where it is
 * @param kind - What it is shaped like
 * @returns The finding
 */
function at(path: string, kind: string) {
  return { path, kind, inName: false };
}

describe("a document that holds something shaped like a credential", () => {
  it("names the place by its keys and positions", () => {
    const document = {
      findings: [{ what: "fine" }, { what: `It uses ${TOKEN}.` }],
      probes: [{ request: "GET x" }],
    };

    expect(scanJsonForCredentials(document)).toEqual([
      at("findings[1].what", GITHUB),
    ]);
  });

  it("names every place, in the order of the document", () => {
    const document = {
      a: TOKEN,
      b: { c: [`password=${RANDOM}`, "fine", TOKEN] },
    };

    expect(scanJsonForCredentials(document)).toEqual([
      at("a", GITHUB),
      at("b.c[0]", SECRET),
      at("b.c[2]", GITHUB),
    ]);
  });

  it("puts a given path in front, for a document that is part of a file", () => {
    expect(scanJsonForCredentials({ lint: { owner: TOKEN } }, "gates")).toEqual(
      [at("gates.lint.owner", GITHUB)]
    );
  });

  it("writes a key that is not a plain word in quotes", () => {
    expect(scanJsonForCredentials({ "AC1.7": { "has space": TOKEN } })).toEqual(
      [at('["AC1.7"]["has space"]', GITHUB)]
    );
  });

  it("takes a random-looking value for a secret when its key says so", () => {
    const document = {
      parameters: {
        api_token: { value: RANDOM },
        threshold: { value: RANDOM },
        secrets: ["DEPLOY_TOKEN", RANDOM],
      },
    };

    expect(scanJsonForCredentials(document)).toEqual([
      at("parameters.api_token.value", SECRET),
      at("parameters.secrets[1]", SECRET),
    ]);
  });

  it("takes the value after a flag for a secret, as two items of a list", () => {
    expect(
      scanJsonForCredentials({ command: ["deploy", "--token", RANDOM] })
    ).toEqual([at("command[2]", SECRET)]);
  });

  it("reports a key that is itself shaped like a credential without writing it", () => {
    const findings = scanJsonForCredentials({
      gates: { [TOKEN]: { owner: "Platform team", note: TOKEN } },
    });

    expect(findings).toEqual([
      { path: "gates", kind: GITHUB, inName: true },
      at('gates["(name not shown)"].note', GITHUB),
    ]);
    expect(JSON.stringify(findings)).not.toContain(TOKEN);
  });

  it("looks at nothing but text", () => {
    expect(scanJsonForCredentials({ a: 1, b: true, c: null, d: [2] })).toEqual(
      []
    );
    expect(scanJsonForCredentials(null)).toEqual([]);
  });
});

describe("the line that says where a value is", () => {
  it("names the file, the place and the shape, and never the value", () => {
    const [finding] = scanJsonForCredentials({ entries: [{ owner: TOKEN }] });
    const line = secretFindingLine(FILE, finding ?? at("", ""));

    expect(line).toBe(
      `${FILE} holds something shaped like a credential at entries[0].owner: a GitHub token. Take the value out and write the name it goes by instead. ${VALUE_NOT_REPEATED}`
    );
    expect(line).not.toContain(TOKEN);
  });

  it("says a name is the problem when a key is shaped like a credential", () => {
    const [finding] = scanJsonForCredentials({ [TOKEN]: 1 });
    const line = secretFindingLine(FILE, finding ?? at("", ""));

    expect(line).toBe(
      `${FILE} holds a name that is itself shaped like a credential, among the names at the top level: a GitHub token. Give it a name that is not a secret. ${VALUE_NOT_REPEATED}`
    );
    expect(line).not.toContain(TOKEN);
  });

  it("names the top level for a document that is one piece of text", () => {
    expect(secretFindingLine(FILE, at("", GITHUB))).toContain(
      "at the top level:"
    );
  });
});

describe("taking values out of a document", () => {
  it("leaves a placeholder in each place and changes nothing else", () => {
    const document = {
      id: "code-style@api/commit/violation/SI7",
      command: ["deploy", "--token", RANDOM],
      output_excerpt: `cloning with ${TOKEN}\nFound 1 error.\n`,
      exit_status: 1,
      parameters: { api_token: { value: RANDOM } },
    };
    const redacted = redactJsonCredentials(document);

    expect(redacted).toEqual({
      id: "code-style@api/commit/violation/SI7",
      command: ["deploy", "--token", "[REDACTED:SECRET]"],
      output_excerpt: "cloning with [REDACTED:GITHUB_TOKEN]\nFound 1 error.\n",
      exit_status: 1,
      parameters: { api_token: { value: "[REDACTED:SECRET]" } },
    });
    expect(scanJsonForCredentials(redacted)).toEqual([]);
  });
});

describe("the last check before a file is written", () => {
  it("lets a file with nothing shaped like a credential through", () => {
    expect(credentialProblemIn(FILE, '{"a":"fine"}\n')).toBeNull();
    expect(
      credentialProblemIn("notes.md", "# Fine\n\nNothing here.\n")
    ).toBeNull();
  });

  it("names the file and the places of a JSON file, never the value", () => {
    const text = JSON.stringify({ a: TOKEN, b: [TOKEN], c: TOKEN, d: TOKEN });
    const problem = credentialProblemIn(FILE, text) ?? "";

    expect(problem).toBe(
      `${FILE} was not written, because it would hold something shaped like a credential at a, b[0], c and 1 more: a GitHub token. ${VALUE_NOT_REPEATED} Take the value out of what this file is written from and write the name it goes by instead, then run this again.`
    );
    expect(problem).not.toContain(TOKEN);
  });

  it("names the line of a file that is not JSON", () => {
    const problem = credentialProblemIn(
      "notes.md",
      `# Notes\n\nUse ${TOKEN}.\n`
    );

    expect(problem).toContain("notes.md was not written");
    expect(problem).toContain("at line 3:");
    expect(problem).not.toContain(TOKEN);
  });
});

describe("lines about to be printed", () => {
  it("lose any value they quote", () => {
    expect(
      withoutCredentials([`The folder "${TOKEN}" does not exist.`, "Fine."])
    ).toEqual([
      'The folder "[REDACTED:GITHUB_TOKEN]" does not exist.',
      "Fine.",
    ]);
  });
});
