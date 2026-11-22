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
 * - a renamed import, a destructure or a plain alias, an alias of an alias
 *   included: `import { symlinkSync as mk }`, `const { symlink: s } = fsp`,
 *   `const s = fs.symlinkSync`
 * - a bracket access with a string key: `fs["symlinkSync"](`
 * - `.call`, `.apply` and `.bind` on any of those
 * - `cp`/`cpSync` asked to keep links verbatim: `{ verbatimSymlinks: true }`
 * - a process start, under its own name or any alias of it, that runs `ln`
 *   with a symbolic option: `execFileSync("ln", ["-s", …])`,
 *   `boundedExecFileSync({ command: "/bin/ln", … })`, `execSync("ln -f -s …")`,
 *   `` Bun.$`ln --symbolic …` ``
 *
 * Shell, Ruby, Python and PowerShell have no syntax tree here, so a line
 * (comments dropped) is refused by its text: `ln -s`, `File.symlink`,
 * `FileUtils.ln_s`, `FileUtils.symlink`, `os.symlink`, `symlink_to`, `New-Item -ItemType
 * SymbolicLink`, `mklink`. A tracked file in any other language is not
 * skipped: the guard fails on it until the scan can read it. Data files
 * (JSON, Markdown, YAML, SQL, text, lockfiles) make no links.
 * @module tests/helpers/link-call-scan
 */
import ts from "typescript";

/** Names of the Node functions that create a link. */
const LINK_FUNCTIONS = new Set(["symlink", "symlinkSync"]);

/** Copies that recreate links when asked to keep them verbatim. */
const COPY_FUNCTIONS = new Set(["cp", "cpSync"]);

/** Calls that start a process, by the called name. */
const PROCESS_STARTS = new Set([
  "boundedExecFileSync",
  "boundedSpawnSync",
  "exec",
  "execFile",
  "execFileSync",
  "execSync",
  "execa",
  "fork",
  "spawn",
  "spawnSync",
]);

/** Separators between shell words: whitespace, quotes, `;`, `&`, `|`. */
const SHELL_SEPARATORS = /[\s"'`;&|()]+/u;

/**
 * Whether an `ln` option makes the link symbolic: `-s`, `-sf`, `-fs`,
 * `--symbolic`. `--force` and a hard link's `-f` do not.
 * @param option - One option word
 * @returns True for a symbolic option
 */
function isSymbolicOption(option: string): boolean {
  if (option === "--symbolic") return true;
  return /^-[a-zA-Z]+$/u.test(option) && option.includes("s");
}

/**
 * Whether shell text runs `ln` with a symbolic option among the options that
 * follow it: `ln -s`, `ln -sf`, `ln -f -s`, `ln --force --symbolic`.
 * @param text - Shell text
 * @returns True when it makes a symbolic link
 */
function runsLnSymbolic(text: string): boolean {
  const words = text.split(SHELL_SEPARATORS);
  return words.some((word, index) => {
    if (!isLn(word)) return false;
    const after = words.slice(index + 1);
    const end = after.findIndex(option => !option.startsWith("-"));
    return after.slice(0, end < 0 ? after.length : end).some(isSymbolicOption);
  });
}

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

/** Methods that reach a function through another call shape. */
const INDIRECT_CALLS = new Set(["apply", "bind", "call"]);

/**
 * An expression without the parentheses and type-only wrappers around it:
 * `(f)`, `f as T`, `f!`, `f satisfies T`.
 * @param expression - Any expression
 * @returns The wrapped expression
 */
function unwrap(expression: ts.Expression): ts.Expression {
  if (
    ts.isParenthesizedExpression(expression) ||
    ts.isAsExpression(expression) ||
    ts.isNonNullExpression(expression) ||
    ts.isSatisfiesExpression(expression) ||
    ts.isTypeAssertionExpression(expression)
  ) {
    return unwrap(expression.expression);
  }
  return expression;
}

/**
 * The name a callee or value reaches: `f`, `object.f`, `object["f"]`, and
 * the function behind `f.call`, `f.apply` or `f.bind(…)`.
 * @param expression - A callee or an initializer
 * @returns Every name it may reach, nearest first
 */
function reachedNames(expression: ts.Expression): readonly string[] {
  const inner = unwrap(expression);
  if (ts.isIdentifier(inner)) return [inner.text];
  if (ts.isCallExpression(inner)) {
    // `f.bind(this)` evaluates to `f`.
    const callee = unwrap(inner.expression);
    return ts.isPropertyAccessExpression(callee) && callee.name.text === "bind"
      ? reachedNames(callee.expression)
      : [];
  }
  if (ts.isPropertyAccessExpression(inner)) {
    const through = INDIRECT_CALLS.has(inner.name.text)
      ? reachedNames(inner.expression)
      : [];
    return [inner.name.text, ...through];
  }
  if (
    ts.isElementAccessExpression(inner) &&
    isLiteral(inner.argumentExpression)
  ) {
    return [inner.argumentExpression.text];
  }
  return [];
}

/**
 * The local name a declaration binds, and the name it binds it to.
 * @param node - Any node
 * @returns `[local, reached names]`, or undefined for any other node
 */
function binding(
  node: ts.Node
): readonly [string, readonly string[]] | undefined {
  if (ts.isImportSpecifier(node)) {
    return [node.name.text, [(node.propertyName ?? node.name).text]];
  }
  if (ts.isBindingElement(node) && ts.isIdentifier(node.name)) {
    const key = node.propertyName ?? node.name;
    const bound = ts.isIdentifier(key) || isLiteral(key) ? [key.text] : [];
    return [node.name.text, bound];
  }
  if (
    ts.isVariableDeclaration(node) &&
    ts.isIdentifier(node.name) &&
    node.initializer
  ) {
    return [node.name.text, reachedNames(node.initializer)];
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
 * Every local name that reaches one of `targets`, through imports,
 * destructures and plain aliases, an alias of an alias included.
 * @param bindings - The file's declarations
 * @param targets - Function names
 * @returns The targets and every local alias of them
 */
function aliasesOf(
  bindings: readonly (readonly [string, readonly string[]])[],
  targets: ReadonlySet<string>
): ReadonlySet<string> {
  const grown = new Set([
    ...targets,
    ...bindings
      .filter(([, reached]) => reached.some(name => targets.has(name)))
      .map(([local]) => local),
  ]);
  return grown.size === targets.size ? targets : aliasesOf(bindings, grown);
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
  if (isLiteral(node) && runsLnSymbolic(node.text)) return true;
  if (
    (ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)) &&
    runsLnSymbolic(node.text)
  ) {
    return true;
  }
  return ts.forEachChild(node, mentionsLnSymbolic) ?? false;
}

/**
 * Whether a process start runs `ln`. For `.call`/`.apply` the first
 * argument is the receiver, so every argument is read.
 * @param call - A call that starts a process
 * @returns True when its command is `ln` or its text runs `ln -s`
 */
function startsLn(call: ts.CallExpression): boolean {
  const named = call.arguments.slice(0, 2).map(commandOf);
  if (named.some(command => command !== undefined && isLn(command))) {
    return true;
  }
  return call.arguments.some(mentionsLnSymbolic);
}

/**
 * Whether a copy's options ask it to recreate links as they are:
 * `{ verbatimSymlinks }` with any value but a literal `false`.
 * @param call - A call to `cp` or `cpSync`
 * @returns True when an options object sets `verbatimSymlinks`
 */
function keepsLinks(call: ts.CallExpression): boolean {
  return call.arguments.some(
    argument =>
      ts.isObjectLiteralExpression(argument) &&
      argument.properties.some(property => {
        const name = property.name;
        const named =
          name !== undefined &&
          (ts.isIdentifier(name) || isLiteral(name)) &&
          name.text === "verbatimSymlinks";
        return (
          named &&
          !(
            ts.isPropertyAssignment(property) &&
            property.initializer.kind === ts.SyntaxKind.FalseKeyword
          )
        );
      })
  );
}

/** What a file binds to a link function, a copy and a process start. */
interface Reach {
  readonly copies: ReadonlySet<string>;
  readonly links: ReadonlySet<string>;
  readonly starts: ReadonlySet<string>;
}

/**
 * Whether a call creates a link.
 * @param call - Any call expression
 * @param reach - The file's link and process-start names
 * @returns True for a link call or a process start that runs `ln`
 */
function isLinkCall(call: ts.CallExpression, reach: Reach): boolean {
  const names = reachedNames(call.expression);
  if (names.some(name => reach.links.has(name))) return true;
  if (names.some(name => reach.copies.has(name)) && keepsLinks(call)) {
    return true;
  }
  const starts =
    names.some(name => reach.starts.has(name)) || isBunStart(call.expression);
  return starts && startsLn(call);
}

/**
 * Link-creating calls in a JavaScript or TypeScript file.
 * @param file - File name, which picks the parser's script kind
 * @param source - File text
 * @returns Each call's text, whitespace collapsed
 */
export function scriptLinks(file: string, source: string): readonly string[] {
  const kind = /\.[cm]?[jt]sx?$/u.test(file) ? undefined : ts.ScriptKind.JS;
  const tree = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    kind
  );
  const nodes = descendants(tree);
  const bindings = nodes.map(binding).filter(entry => entry !== undefined);
  const reach: Reach = {
    links: aliasesOf(bindings, LINK_FUNCTIONS),
    copies: aliasesOf(bindings, COPY_FUNCTIONS),
    starts: aliasesOf(bindings, PROCESS_STARTS),
  };
  return nodes
    .filter(
      node =>
        (ts.isCallExpression(node) && isLinkCall(node, reach)) ||
        (ts.isTaggedTemplateExpression(node) &&
          isBunStart(node.tag) &&
          mentionsLnSymbolic(node.template))
    )
    .map(node => node.getText(tree).replaceAll(/\s+/gu, " "));
}

/** Line tests that make a link, per language read as text. */
const TEXT_LANGUAGES = {
  shell: [runsLnSymbolic],
  ruby: [
    runsLnSymbolic,
    (line: string) => /\bFile\.symlink\b/u.test(line),
    (line: string) => /\bln_sf?\b/u.test(line),
    (line: string) => /\bFileUtils\.symlink\b/u.test(line),
  ],
  python: [
    runsLnSymbolic,
    (line: string) => /\bos\.symlink\b/u.test(line),
    (line: string) => /\.symlink_to\b/u.test(line),
  ],
  powershell: [
    runsLnSymbolic,
    (line: string) =>
      /\bNew-Item\b/iu.test(line) &&
      /-ItemType\s+["']?SymbolicLink\b/iu.test(line),
    (line: string) => /\bmklink\b/iu.test(line),
  ],
} as const;

/** A language the scan reads as text. */
export type TextLanguage = keyof typeof TEXT_LANGUAGES;

/**
 * Lines that make a link in a script read as text, `#` comments dropped.
 * @param source - Script text
 * @param language - Which patterns apply
 * @returns Each offending line, trimmed
 */
export function textLinks(
  source: string,
  language: TextLanguage = "shell"
): readonly string[] {
  const tests: readonly ((line: string) => boolean)[] =
    TEXT_LANGUAGES[language];
  return source
    .split("\n")
    .map(line => line.replace(/(^|\s)#.*$/u, "").trim())
    .filter(line => tests.some(test => test(line)));
}

/** Extensions of files that hold data, not code. */
// A gzip archive is compressed bytes, not a language: it cannot call a link.
const DATA_FILE = /\.(?:json|jsonl|lock|md|sql|tgz|txt|ya?ml)$/u;

/** How the scan reads one file. */
export type Reading = "script" | TextLanguage | "data" | "unscannable";

/** Language by extension or bare file name, before any shebang. */
const BY_NAME: readonly (readonly [RegExp, Reading])[] = [
  [/\.(?:[cm]?[jt]s|[jt]sx)$/u, "script"],
  [/(?:\.(?:sh|bash|zsh)|(?:^|\/)Dockerfile)$/u, "shell"],
  [/(?:\.rb|(?:^|\/)(?:Gemfile|Rakefile))$/u, "ruby"],
  [/\.py$/u, "python"],
  [/\.psm?1$/u, "powershell"],
  [DATA_FILE, "data"],
];

/** Language by the interpreter a shebang names. */
const BY_SHEBANG: readonly (readonly [RegExp, Reading])[] = [
  [/\bnode$|\bbun$|\bdeno$/u, "script"],
  [/\b(?:ba|z|da)?sh$/u, "shell"],
  [/\bruby$/u, "ruby"],
  [/\bpython\d*(?:\.\d+)?$/u, "python"],
  [/\bpwsh$/u, "powershell"],
];

/**
 * How the scan reads a tracked file: by its name, else by its shebang. A
 * file with neither a known name nor a known shebang is unscannable, and the
 * guard fails on it rather than skipping it.
 * @param file - Path
 * @param source - File text
 * @returns The reading
 */
export function readingOf(file: string, source: string): Reading {
  const named = BY_NAME.find(([pattern]) => pattern.test(file));
  if (named) return named[1];
  const shebang = /^#!\s*(\S+)(?:\s+(\S+))?/u.exec(source);
  if (!shebang) return "unscannable";
  const interpreter =
    shebang[1]?.endsWith("/env") && shebang[2] ? shebang[2] : shebang[1];
  const known = BY_SHEBANG.find(([pattern]) => pattern.test(interpreter ?? ""));
  return known ? known[1] : "unscannable";
}

/**
 * Every link a tracked file under tests/ makes, or the reason it cannot be
 * read.
 * @param file - Path
 * @param source - File text
 * @returns Offending calls or lines; empty for a clean or data file
 */
export function fileLinks(file: string, source: string): readonly string[] {
  const reading = readingOf(file, source);
  if (reading === "script") return scriptLinks(file, source);
  if (reading === "data") return [];
  if (reading === "unscannable") {
    return ["cannot be scanned: no known language for its name or shebang"];
  }
  return textLinks(source, reading);
}
