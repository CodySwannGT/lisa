/** Observe token access and requests from the real Expo Jira parser. */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { boundedSpawnSync } from "../helpers/io-latency-budget.js";

const SOURCE = "plugins/src/expo/skills/jira-journey/scripts/parse-plan.py";
const COPIES = [
  SOURCE,
  "plugins/lisa-expo/skills/jira-journey/scripts/parse-plan.py",
  "plugins/lisa-expo/.codex-plugin/skills/jira-journey/scripts/parse-plan.py",
  "plugins/lisa-expo-agy/skills/jira-journey/scripts/parse-plan.py",
  "plugins/lisa-expo-cursor/skills/jira-journey/scripts/parse-plan.py",
  "plugins/lisa-expo-copilot/skills/jira-journey/scripts/parse-plan.py",
];
const ORIGIN = "https://jira.invalid";
const INVALID = [
  ORIGIN.replace("https:", "http:"),
  "https://operator@jira.invalid",
  `${ORIGIN}/base`,
  `${ORIGIN}?`,
  `${ORIGIN}#`,
  `${ORIGIN}:0`,
  `${ORIGIN}:65536`,
  `${ORIGIN} trailing`,
  "https://ji\tra.invalid",
  "https://jira..invalid",
  "https://jira.invalid.",
  "https://%6aira.invalid",
  "https://jirā.invalid",
];
const roots: string[] = [];
const RECORDER = `import contextlib, io, json, os, runpy, sys, urllib.request
events = []
class ObservedEnvironment(dict):
    def __getitem__(self, key):
        if key == "JIRA_API_TOKEN": events.append({"kind": "token-read"})
        return super().__getitem__(key)
    def get(self, key, default=None):
        return self[key] if key in self else default
os.environ = ObservedEnvironment(os.environ)
def record_request(req, *args, **kwargs):
    events.append({"kind": "request", "url": req.full_url,
                   "authorization": req.get_header("Authorization")})
    heading = {"type": "heading", "attrs": {"level": 2},
               "content": [{"type": "text", "text": "Validation Journey"}]}
    return io.BytesIO(json.dumps({"fields": {"description": {
        "type": "doc", "content": [heading]}}}).encode())
urllib.request.urlopen = record_request
parser = sys.argv[1]
sys.argv = [parser, "TEST-1"]
code = 0
try:
    with contextlib.redirect_stdout(io.StringIO()):
        runpy.run_path(parser, run_name="__main__")
except SystemExit as error:
    code = error.code
except Exception:
    code = 70
print(json.dumps({"code": code, "events": events}))
`;

afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

/**
 * Prepare conflicting home, checkout, and environment origins.
 * @param server - Home-config server value.
 * @returns Isolated home and working directory.
 */
function prepareFixture(server: string) {
  const root = mkdtempSync(path.join(tmpdir(), "lisa-expo-origin-"));
  const homeConfig = path.join(root, ".config", ".jira");
  const projectConfig = path.join(root, ".lisa", "jira-cli");
  roots.push(root);
  mkdirSync(homeConfig, { recursive: true });
  mkdirSync(projectConfig, { recursive: true });
  writeFileSync(
    path.join(homeConfig, ".config.yml"),
    `server: ${server}\nlogin: operator@jira.invalid\n`
  );
  writeFileSync(
    path.join(projectConfig, ".config.yml"),
    "server: https://checkout.invalid\nlogin: checkout@jira.invalid\n"
  );
  return root;
}

/**
 * Drive the real parser with a recorded token read and intercepted network.
 * @param parser - Source or generated script under test.
 * @param server - Home-config server value.
 * @returns Recorded exit code and credential/request events.
 */
function runParser(parser: string, server: string) {
  const root = prepareFixture(server);
  const result = boundedSpawnSync({
    label: "Expo Jira parser with recorded credential access",
    command: "python3",
    args: ["-c", RECORDER, path.resolve(parser)],
    cwd: root,
    env: {
      HOME: root,
      PATH: process.env.PATH,
      CLAUDE_PROJECT_DIR: root,
      JIRA_SERVER: "https://environment.invalid",
      JIRA_API_TOKEN: "fixture-token",
    },
  });
  expect(result.status, result.stderr).toBe(0);
  return JSON.parse(result.stdout) as {
    code: number;
    events: { kind: string; url?: string; authorization?: string }[];
  };
}

describe.each(COPIES)("Expo credential destination: %s", parser => {
  it.each(INVALID)("rejects %s before reading the token", server => {
    const result = runParser(parser, server);
    expect(result.code).toBe(1);
    expect(result.events).toEqual([]);
  });

  it.each([
    [ORIGIN, ORIGIN],
    ["HTTPS://JIRA.INVALID:443/", ORIGIN],
    ["https://jira.invalid:8443/", "https://jira.invalid:8443"],
    ["https://192.0.2.1/", "https://192.0.2.1"],
    ["https://[2001:db8::1]:443/", "https://[2001:db8::1]"],
  ])("uses the canonical home origin for %s", (server, canonical) => {
    const result = runParser(parser, server);
    const requests = result.events.filter(event => event.kind === "request");
    expect(result.code).toBe(0);
    expect(result.events.some(event => event.kind === "token-read")).toBe(true);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe(
      `${canonical}/rest/api/3/issue/TEST-1?fields=description`
    );
    expect(requests[0]?.authorization).toMatch(/^Basic /);
  });
});
