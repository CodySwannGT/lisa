/** Bounded literal command/target resolution for the host-name guard; never a shell. */
import { execFileSync } from "node:child_process";
import { statSync } from "node:fs";
import path from "node:path";

const VALUE_FLAGS = new Set([
  "--repo",
  "-R",
  "--body",
  "-b",
  "--title",
  "-t",
  "--message",
  "-m",
  "--body-file",
  "--input",
  "-f",
  "-F",
  "--field",
  "--raw-field",
  "-X",
  "--method",
  "-H",
  "--header",
  "--hostname",
  "-q",
  "--jq",
  "--template",
  "-p",
  "--preview",
  "--base",
  "--head",
  "--assignee",
  "--label",
  "--milestone",
  "--project",
  "--reviewer",
]);
const FIELD_FLAGS = new Set(["-f", "-F", "--field", "--raw-field"]);
const METHODS = new Set(["POST", "PATCH", "PUT"]);
const SHORT_VALUES = /^(-[RbBtTmMfFXHqp])(.+)$/u;

/**
 * Read literal words and command separators, retaining expansion uncertainty.
 * @param {string} command Raw Bash command.
 * @returns {object[]} Literal words and separators.
 */
function words(command) {
  const result = [];
  let value = "",
    quote = "",
    literal = true,
    started = false;
  const flush = () => {
    if (started) result.push({ value, literal });
    value = "";
    literal = true;
    started = false;
  };
  for (let i = 0; i < command.length; i += 1) {
    const char = command[i];
    if (char === "\\" && quote !== "'") {
      const next = command[++i];
      if (next === undefined) literal = false;
      else if (next !== "\n") {
        if (quote === '"' && !/[$`"\\]/u.test(next)) value += "\\";
        value += next;
      }
      if (next !== "\n") started = true;
    } else if (quote !== "") {
      if (char === quote) quote = "";
      else {
        value += char;
        if (quote === '"' && /[$`]/u.test(char)) literal = false;
      }
      started = true;
    } else if (char === '"' || char === "'") {
      quote = char;
      started = true;
    } else if (/[;&|\n()<>]/u.test(char)) {
      flush();
      const operator =
        char === command[i + 1] && /[&|]/u.test(char)
          ? char + command[++i]
          : char;
      result.push({ operator });
    } else if (/\s/u.test(char)) flush();
    else {
      value += char;
      started = true;
      if (/[$`*?[\]~]/u.test(char)) literal = false;
    }
  }
  if (quote !== "") literal = false;
  flush();
  return result;
}

/**
 * Split option values without treating body text as a second option/endpoint.
 * @param {object[]} input Active gh arguments only.
 * @returns {object} Parsed flags, positional words and normalized tokens.
 */
function argumentsOf(input) {
  const flags = new Map(),
    positional = [],
    tokens = [];
  // Any expansion can add/replace routing arguments after shell word splitting.
  // Never evaluate it or certify a target from the remaining literal words.
  let certain = input.every(word => word.literal);
  for (let i = 0; i < input.length; i += 1) {
    const word = input[i];
    if (word.value === "--") {
      positional.push(...input.slice(i + 1));
      tokens.push(...input.slice(i).map(item => item.value));
      break;
    }
    const equals = word.value.indexOf("=");
    const directFlag = equals > 0 ? word.value.slice(0, equals) : word.value;
    const attached = VALUE_FLAGS.has(directFlag)
      ? null
      : SHORT_VALUES.exec(word.value);
    const flag =
      attached?.[1] ??
      (equals > 0 && word.value.startsWith("-") ? directFlag : word.value);
    tokens.push(flag);
    if (VALUE_FLAGS.has(flag)) {
      const value = attached
        ? { ...word, value: attached[2] }
        : equals > 0
          ? { ...word, value: word.value.slice(equals + 1) }
          : input[++i];
      if (value === undefined) {
        certain = false;
        continue;
      }
      // Alias spellings share one Cobra option; the last occurrence wins.
      flags.set(
        flag === "-R" ? "--repo" : flag === "-X" ? "--method" : flag,
        value
      );
      tokens.push(value.value);
    } else if (!word.value.startsWith("-")) positional.push(word);
    else if (!word.literal) certain = false;
  }
  const noun = positional[0]?.value,
    verb = positional[1]?.value;
  const method = flags.get("--method");
  const writes =
    noun === "api"
      ? method
        ? !method.literal || METHODS.has(method.value.toUpperCase())
        : [...FIELD_FLAGS].some(flag => flags.has(flag)) ||
          Boolean(flags.get("--input")?.value)
      : ["issue", "pr"].includes(noun) &&
        ["create", "comment", "edit"].includes(verb);
  return {
    flags,
    positional,
    tokens: ["gh", ...tokens],
    noun,
    writes,
    certain,
  };
}

/**
 * Normalize only repository shapes gh/git actually accept; unresolved syntax is unknown.
 * @param {string} spec Repository argument, URL or Git remote.
 * @returns {string|undefined} Lowercased owner/repository, or unknown.
 */
export function repositoryFromSpec(spec) {
  if (typeof spec !== "string" || /[\s${}`*?#[\]]/u.test(spec))
    return undefined;
  const normalized = spec
    .trim()
    .replace(/\.git\/?$/u, "")
    .replace(/\/$/u, "");
  const matched =
    /^(?:(?:https?:\/\/|ssh:\/\/git@)[^/]+\/|git@[^:]+:|[^/:]+\/)?([\w.-]+)\/([\w.-]+)$/u.exec(
      normalized
    );
  return matched ? `${matched[1]}/${matched[2]}`.toLowerCase() : undefined;
}

/**
 * Resolve literal cd and leading environment assignments across simple command lists.
 * Pipelines, conditionals and other shell syntax never earn a target exemption.
 * @param {string} command Raw Bash command.
 * @param {string} initialCwd The actual hook process cwd, separate from detector root.
 * @param {object} env The actual inherited environment.
 * @returns {object[]} Active gh calls with their bounded command contexts.
 */
export function ghCommands(command, initialCwd, env = process.env) {
  const calls = [];
  const inherited = { ...env };
  let cwd = initialCwd,
    segment = [],
    uncertain = false;
  const consume = () => {
    if (segment.length === 0) return;
    const local = { ...inherited };
    let index = segment[0].value === "env" ? 1 : 0;
    while (/^[A-Za-z_][A-Za-z_0-9]*=/u.test(segment[index]?.value ?? "")) {
      const item = segment[index++],
        split = item.value.indexOf("=");
      local[item.value.slice(0, split)] = item.literal
        ? item.value.slice(split + 1)
        : undefined;
      if (!item.literal) uncertain = true;
    }
    const executable = segment[index]?.value;
    if (executable === "cd") {
      const args = segment.slice(index + 1).filter(item => item.value !== "--");
      const directory =
        args.length === 1 && args[0].literal && !args[0].value.startsWith("-")
          ? args[0].value
          : undefined;
      try {
        const resolved =
          directory === undefined ||
          (!path.isAbsolute(directory) &&
            !/^\.\.?(?:\/|$)/u.test(directory) &&
            (uncertain || local.CDPATH))
            ? undefined
            : path.isAbsolute(directory)
              ? directory
              : cwd === undefined
                ? undefined
                : path.resolve(cwd, directory);
        cwd =
          resolved !== undefined && statSync(resolved).isDirectory()
            ? resolved
            : undefined;
      } catch {
        cwd = undefined;
      }
    } else if (executable === "export") {
      for (const item of segment.slice(index + 1)) {
        const split = item.value.indexOf("=");
        if (split < 1 || !item.literal) {
          uncertain = true;
          continue;
        }
        inherited[item.value.slice(0, split)] = item.value.slice(split + 1);
      }
    } else if (executable !== undefined && path.basename(executable) === "gh") {
      calls.push({
        ...argumentsOf(segment.slice(index + 1)),
        cwd,
        env: local,
        certainContext: !uncertain,
      });
    } else {
      // A function/source/pushd or unsupported launcher may change the shell
      // context. Do not grant later writes an exemption based on the old cwd.
      uncertain = true;
      cwd = undefined;
      const nested = segment.findIndex(item => item.value === "gh");
      if (nested !== -1)
        calls.push({
          ...argumentsOf(segment.slice(nested + 1)),
          cwd,
          env: local,
          certainContext: false,
        });
    }
    segment = [];
  };
  for (const word of words(command)) {
    if (word.operator === undefined) segment.push(word);
    else {
      consume();
      if (!["&&", ";", "\n"].includes(word.operator)) {
        uncertain = true;
        cwd = undefined;
      }
    }
  }
  consume();
  return calls;
}

/**
 * Read gh's local selected default, falling back only to one unambiguous remote.
 * All reads share a five-second ceiling and execute no shell or network query.
 * @param {object} context One gh command context.
 * @returns {string|undefined} Verified repository, or unknown.
 */
function localRepository(context) {
  if (!context.certainContext) return undefined;
  if (context.env.GH_REPO) return repositoryFromSpec(context.env.GH_REPO);
  if (context.cwd === undefined) return undefined;
  const deadline = Date.now() + 5000;
  const read = (command, args) => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error("Repository lookup deadline expired");
    return execFileSync(command, args, {
      cwd: context.cwd,
      env: { ...context.env, GH_PROMPT_DISABLED: "1" },
      timeout: remaining,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  };
  try {
    const selected = read("gh", ["repo", "set-default", "--view"]);
    if (selected !== "") return repositoryFromSpec(selected);
    const remotes = read("git", ["remote"]).split("\n").filter(Boolean);
    if (remotes.length !== 1) return undefined;
    return repositoryFromSpec(read("git", ["remote", "get-url", remotes[0]]));
  } catch {
    // probe-direction: fail-closed — failed lookup grants no host exemption;
    // the caller retains its inspection path for an undetermined target.
    return undefined;
  }
}

/**
 * Resolve only active command arguments; prose cannot masquerade as routing.
 * @param {object} context One parsed gh call.
 * @returns {string|undefined} Verified owner/repository, or unknown.
 */
export function commandRepository(context) {
  if (!context.certain || !context.certainContext) return undefined;
  if (context.noun !== "api") {
    // gh 2.88.1 issue comment/edit and PR finder resolve a URL selector before
    // BaseRepo (--repo/GH_REPO/local default). Body option values are not here.
    const selectors = context.positional.slice(2);
    const batch =
      context.noun === "issue" && context.positional[1]?.value === "edit";
    if (
      (batch && selectors.length > 1) ||
      (["comment", "edit"].includes(context.positional[1]?.value) &&
        selectors.some(item => /^https?:\/\//u.test(item.value)))
    ) {
      if (!batch && selectors.length !== 1) return undefined;
      let repository, identity;
      for (const item of selectors) {
        // ParseIssuesFromArgs lets numeric selectors inherit the common URL repo.
        if (batch && /^#?[+-]?\d+$/u.test(item.value)) {
          const number = BigInt(item.value.replace(/^#/u, ""));
          if (BigInt.asIntN(64, number) !== number) return undefined;
          continue;
        }
        const selected =
          /^https?:\/\/[^/]+\/([\w.-]+)\/([\w.-]+)\/(issues|pull)\/\d+(?:[/?#].*)?$/u.exec(
            item.value
          );
        if (!selected || (context.noun === "pr" && selected[3] !== "pull"))
          return undefined;
        try {
          const host = new URL(item.value).hostname
            .replace(/^www\./u, "")
            .toLowerCase();
          const repo = batch
            ? `${selected[1]}/${selected[2]}`.toLowerCase()
            : repositoryFromSpec(`${selected[1]}/${selected[2]}`);
          const current = `${host}/${repo}`;
          if (
            !host ||
            !repo ||
            (identity !== undefined && identity !== current)
          )
            return undefined;
          identity = current;
          repository = repo;
        } catch {
          // probe-direction: fail-closed — invalid URL grants no host exemption;
          // the caller retains its inspection path for an undetermined target.
          return undefined;
        }
      }
      if (repository !== undefined) return repository;
    }
    const explicit = context.flags.get("--repo") ?? context.flags.get("-R");
    return explicit
      ? explicit.literal
        ? repositoryFromSpec(explicit.value)
        : undefined
      : localRepository(context);
  }
  const endpoint = context.positional[1];
  if (!endpoint?.literal) return undefined;
  let value = endpoint.value;
  if (/\{(?:owner|repo)\}/u.test(value)) {
    const repository = localRepository(context);
    if (repository === undefined) return undefined;
    const [owner, repo] = repository.split("/");
    value = value.replaceAll("{owner}", owner).replaceAll("{repo}", repo);
  }
  const found =
    /^(?:https?:\/\/[^/]+\/)?\/?repos\/([\w.-]+)\/([\w.-]+)(?:\/|$)/u.exec(
      value
    );
  return found ? repositoryFromSpec(`${found[1]}/${found[2]}`) : undefined;
}
