/**
 * Find every way a file under tests/ could create a symbolic link itself
 * (CodySwannGT/lisa#5028).
 *
 * tests/unit/config/no-whole-node-modules-link.test.ts refuses each one
 * outside tests/support/borrowed-node-modules.mjs, the one module that creates
 * links and checks both ends of each on resolved paths. The scan reads the
 * syntax tree, so text inside strings and comments is not a call, and it
 * follows the spellings that reach the same function under another name:
 * - a direct call: `symlinkSync(`, `fs.symlink(`
 * - a renamed import or destructure: `import { symlinkSync as mk }`,
 *   `const { symlink: s } = fsp`
 * - a bracket access with a string key: `fs["symlinkSync"](`
 * - a process that runs `ln`: `execFileSync("ln", …)`,
 *   `boundedExecFileSync({ command: "/bin/ln", … })`, `execSync("ln -s …")`,
 *   `` Bun.$`ln -sf …` ``
 *
 * Shell scripts have no syntax tree here, so a shell line (comments dropped)
 * that runs `ln -s` is refused by its text.
 * @module tests/helpers/link-call-scan
 */
import ts from "typescript";

/** Names of the Node functions that create a link. */
const LINK_FUNCTIONS = new Set(["symlink", "symlinkSync"]);

/** Calls that start a process, by the called name. */
const PROCESS_STARTS = new Set([
  "boundedExecFileSync",
  "boundedSpawnSync",
  "exec",
  "execFile",
  "execFileSync",
  "execSync",
  "spawn",
  "spawnSync",
]);

/** A shell command that makes a symbolic link: `ln -s`, `ln -sf`, `ln -fs`. */
const LN_SYMBOLIC = /\bln\s+-\w*s/u;

/** Bracket keys and `ln` spellings are read from string-like literals only. */
type Literal = ts.StringLiteral | ts.NoSubstitutionTemplateLiteral;

/**
 * Whether a node is a string literal or a template with no substitutions.
 * @param node - Any node
 * @returns True for a literal whose text is known
 */
function isLiteral(node: ts.Node | undefined): node is Literal {
  return (
    node !== undefined &&
    (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
  );
}

/**
 * Whether a command names `ln`: `ln` itself or a path ending in `/ln`.
 * @param command - A command's text
 * @returns True for `ln`
 */
function isLn(command: string): boolean {
  return command === "ln" || command.endsWith("/ln");
}

/**
 * The local name a declaration binds to a link function, if it does.
 * @param node - Any node
 * @returns The local name, or undefined
 */
function boundLinkName(node: ts.Node): string | undefined {
  if (ts.isImportSpecifier(node)) {
    const imported = (node.propertyName ?? node.name).text;
    return LINK_FUNCTIONS.has(imported) ? node.name.text : undefined;
  }
  if (ts.isBindingElement(node) && ts.isIdentifier(node.name)) {
    const key = node.propertyName ?? node.name;
    const bound = ts.isIdentifier(key) || isLiteral(key) ? key.text : "";
    return LINK_FUNCTIONS.has(bound) ? node.name.text : undefined;
  }
  return undefined;
}

/**
 * Every node in a subtree, depth first.
 * @param node - The subtree's root
 * @returns The root and all its descendants
 */
function descendants(node: ts.Node): readonly ts.Node[] {
  return [node, ...node.getChildren().flatMap(descendants)];
}

/**
 * Every local name bound to a link function by an import or a destructure.
 * @param nodes - Every node of the file
 * @returns The local names, plus the functions' own names
 */
function linkBindings(nodes: readonly ts.Node[]): ReadonlySet<string> {
  const bound = nodes.map(boundLinkName).filter(name => name !== undefined);
  return new Set([...LINK_FUNCTIONS, ...bound]);
}

/**
 * The name a call reaches: `f(`, `object.f(`, `object["f"](`.
 * @param callee - The call's callee
 * @returns The name, or an empty string when it cannot be read
 */
function calleeName(callee: ts.Expression): string {
  if (ts.isIdentifier(callee)) return callee.text;
  if (ts.isPropertyAccessExpression(callee)) return callee.name.text;
  if (
    ts.isElementAccessExpression(callee) &&
    isLiteral(callee.argumentExpression)
  ) {
    return callee.argumentExpression.text;
  }
  return "";
}

/**
 * Whether a callee is `Bun.spawn`, `Bun.spawnSync` or `Bun.$`.
 * @param callee - A callee or a template tag
 * @returns True for one of Bun's process starts
 */
function isBunStart(callee: ts.Expression): boolean {
  return (
    ts.isPropertyAccessExpression(callee) &&
    ts.isIdentifier(callee.expression) &&
    callee.expression.text === "Bun" &&
    ["spawn", "spawnSync", "$"].includes(callee.name.text)
  );
}

/**
 * The `command` or `cmd` property of an options object.
 * @param options - An object literal
 * @returns The property's value, or undefined
 */
function commandProperty(
  options: ts.ObjectLiteralExpression
): ts.Expression | undefined {
  const property = options.properties.find(
    candidate =>
      ts.isPropertyAssignment(candidate) &&
      ts.isIdentifier(candidate.name) &&
      ["command", "cmd"].includes(candidate.name.text)
  );
  return property && ts.isPropertyAssignment(property)
    ? property.initializer
    : undefined;
}

/**
 * The command a process start names in its first argument: a string, the
 * first element of an argv array, or a `command`/`cmd` property.
 * @param first - The call's first argument
 * @returns The command's text, or undefined when it is not a literal
 */
function commandOf(first: ts.Expression | undefined): string | undefined {
  if (first === undefined) return undefined;
  if (isLiteral(first)) return first.text;
  if (ts.isArrayLiteralExpression(first)) {
    const head = first.elements[0];
    return isLiteral(head) ? head.text : undefined;
  }
  if (ts.isObjectLiteralExpression(first)) {
    return commandOf(commandProperty(first));
  }
  return undefined;
}

/**
 * Whether any literal text inside a node runs `ln -s` as a shell command.
 * @param node - A call's argument or a template
 * @returns True when some literal text matches
 */
function mentionsLnSymbolic(node: ts.Node): boolean {
  if (isLiteral(node) && LN_SYMBOLIC.test(node.text)) return true;
  if (
    (ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)) &&
    LN_SYMBOLIC.test(node.text)
  ) {
    return true;
  }
  return ts.forEachChild(node, mentionsLnSymbolic) ?? false;
}

/**
 * Whether a process start runs `ln`.
 * @param call - A call that starts a process
 * @returns True when its command is `ln` or its text runs `ln -s`
 */
function startsLn(call: ts.CallExpression): boolean {
  const command = commandOf(call.arguments[0]);
  if (command !== undefined && isLn(command)) return true;
  return call.arguments.some(mentionsLnSymbolic);
}

/**
 * Whether a call creates a link, given the file's link bindings.
 * @param call - Any call expression
 * @param bindings - Local names bound to a link function
 * @returns True for a link call or a process start that runs `ln`
 */
function isLinkCall(
  call: ts.CallExpression,
  bindings: ReadonlySet<string>
): boolean {
  const name = calleeName(call.expression);
  if (bindings.has(name) || LINK_FUNCTIONS.has(name)) return true;
  const starts = PROCESS_STARTS.has(name) || isBunStart(call.expression);
  return starts && startsLn(call);
}

/**
 * Link-creating calls in a JavaScript or TypeScript file.
 * @param file - File name, which picks the parser's script kind
 * @param source - File text
 * @returns Each call's text, whitespace collapsed
 */
export function scriptLinks(file: string, source: string): readonly string[] {
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const nodes = descendants(tree);
  const bindings = linkBindings(nodes);
  return nodes
    .filter(
      node =>
        (ts.isCallExpression(node) && isLinkCall(node, bindings)) ||
        (ts.isTaggedTemplateExpression(node) &&
          isBunStart(node.tag) &&
          mentionsLnSymbolic(node.template))
    )
    .map(node => node.getText(tree).replaceAll(/\s+/gu, " "));
}

/**
 * Shell lines that run `ln -s`, comments dropped.
 * @param source - Script text
 * @returns Each offending line, trimmed
 */
export function shellLinks(source: string): readonly string[] {
  return source
    .split("\n")
    .map(line => line.replace(/(^|\s)#.*$/u, "").trim())
    .filter(line => LN_SYMBOLIC.test(line));
}

/** File names the syntax-tree scan reads. */
export const SCRIPT_FILE = /\.(?:[cm]?[jt]s|[jt]sx)$/u;

/**
 * Whether a tracked file is a shell script: a `.sh`/`.bash` name, or a
 * shebang naming a shell.
 * @param file - Path, for the extension
 * @param source - File text, for the shebang
 * @returns True for a shell script
 */
export function isShellScript(file: string, source: string): boolean {
  if (/\.(?:sh|bash)$/u.test(file)) return true;
  return /^#!\S*(?:\/|\s)(?:ba|z|da)?sh\b/u.test(source);
}
