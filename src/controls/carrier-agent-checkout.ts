/** Render checkout selection for the standalone edit-time carrier. @module */
import { INSTALL_CARRIERS_INVOCATION } from "./carrier-types.js";

/** The generated return for a checkout that could not be read or checked here. */
const RETURN_NULL = "    return null;";

/**
 * Resolve written files and look up the checkout that contains them.
 * @returns Standalone JavaScript helpers for the carrier
 */
function checkoutLookup(): readonly string[] {
  return [
    "// Git must answer about the written path, not an inherited checkout.",
    "function gitPath(from, args) {",
    "  const env = { ...process.env };",
    '  for (const key of ["GIT_DIR", "GIT_WORK_TREE", "GIT_COMMON_DIR"]) delete env[key];',
    '  const ran = spawnSync("git", ["-C", from, "rev-parse", ...args], {',
    '    encoding: "utf8", env, timeout: 3000,',
    "  });",
    "  if (ran.status !== 0) return null;",
    "  try {",
    '    return realpathSync(ran.stdout.replace(/\\r?\\n$/u, ""));',
    "  } catch {",
    RETURN_NULL,
    "  }",
    "}",
    "",
    "function writtenPath(cwd, file) {",
    "  const absolute = path.resolve(cwd, file);",
    "  try {",
    "    return realpathSync(absolute);",
    "  } catch {",
    "    return absolute;",
    "  }",
    "}",
    "",
    "// The input is a file path. Climb to an existing directory in case a tool",
    "// removed the file along with its parent directory.",
    "function existingParent(file) {",
    "  const folder = path.dirname(file);",
    "  return folder === file || existsSync(folder) ? folder : existingParent(folder);",
    "}",
    "",
  ];
}

/**
 * Read the checkout of a written path and hand off to its own carrier when needed.
 * @returns Standalone JavaScript lines for the generated carrier
 */
export function checkoutSelection(): readonly string[] {
  const install = JSON.stringify(`${INSTALL_CARRIERS_INVOCATION} --agents=`);
  return [
    ...checkoutLookup(),
    "function handOff(checkout, raw) {",
    '  const args = ["--path-format=absolute", "--git-common-dir"];',
    "  const common = gitPath(root, args);",
    "  if (common === null || gitPath(checkout, args) !== common) {",
    '    refuse("the written file is in another repository (" + checkout + "). Run its own edit-time hook there.");',
    "    return;",
    "  }",
    "  const peer = path.join(checkout, path.relative(root, program));",
    "  try {",
    "    if (!lstatSync(peer).isFile() || realpathSync(peer) !== peer) throw new Error();",
    "  } catch {",
    '    refuse("the checkout the written file is in (" + checkout + ") has no edit-time carrier. Run " +',
    `      ${install} + agent + " in that checkout.");`,
    "    return;",
    "  }",
    "  const outcome = spawnSync(process.execPath, [peer, agent], {",
    '    input: raw, stdio: ["pipe", "inherit", "inherit"],',
    '    timeout: (LIMIT_SECONDS + 5) * 1000, killSignal: "SIGKILL",',
    "  });",
    "  if (outcome.status === 0 || outcome.status === 2) {",
    "    process.exitCode = outcome.status;",
    "  } else {",
    '    refuse("the checkout\'s edit-time carrier did not finish (" + checkout + ").");',
    "  }",
    "}",
    "",
    "// Returns paths for this carrier, or null when another checkout answered.",
    "function pathsHere(event, raw) {",
    "  const files = event.paths.map(file => writtenPath(event.cwd, file));",
    "  const folders = new Set(files.map(existingParent));",
    "  const checkouts = new Set([...folders].flatMap(folder => {",
    '    const checkout = gitPath(folder, ["--show-toplevel"]);',
    "    return checkout === null ? [] : [checkout];",
    "  }));",
    "  if (checkouts.size > 1) {",
    '    refuse("one edit names files in more than one checkout. Write the files in each checkout separately so each can be checked.");',
    RETURN_NULL,
    "  }",
    "  const [checkout] = checkouts;",
    "  if (checkout === undefined) return event.paths;",
    "  if (checkout === root) return event.paths.map((file, index) =>",
    "    path.isAbsolute(file) ? files[index] : path.relative(root, files[index])",
    "  );",
    "  handOff(checkout, raw);",
    "  return null;",
    "}",
    "",
  ];
}
