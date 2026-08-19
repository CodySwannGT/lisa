/**
 * This file is managed by Lisa.
 * Do not edit directly — changes will be overwritten on the next `lisa` run.
 */

/**
 * Flags a hardcoded style value in an axis the project has declared *typed* —
 * an axis that has a published design-variable collection behind it.
 *
 * The policy this enforces is per-axis, not per-project: colour may have a
 * mature variable system while spacing has none, in the same library, on the
 * same day. Where a variable system exists the variable is the source of truth
 * and a literal is a copy of a number that will change without warning. Where
 * no variable system exists, measuring the design *is* the legitimate source
 * and this rule must stay silent — a control that fires on every project is
 * indistinguishable from no control at all, because it gets turned off.
 *
 * **Regime-awareness is by declaration, not by live query.** ESLint cannot ask
 * a design tool which collections are published, so the typed axes arrive as a
 * rule option (`typedAxes`), sourced from `design.tokens.axes` in
 * `.lisa.config.json`. The default is the empty list, which means the rule
 * reports nothing until a project states which axes it has a variable system
 * for. Silence-by-default is the deliberate choice: the failure mode of an
 * over-firing rule is a disabled rule.
 *
 * The judgment this rule deliberately does NOT make is "is this design
 * ambiguous" — that is an opinion, not a fact, and an agent asked for it blocks
 * on everything or nothing. This rule only answers the objective question: is
 * a value in a typed axis written as a literal?
 * @module eslint-plugin-ui-standards/rules/no-unbound-design-value
 */

/** Every axis the policy recognises. Fixed vocabulary — projects pick a subset. */
const AXES = [
  "color",
  "spacing",
  "typography",
  "radius",
  "elevation",
  "motion",
];

/**
 * Object-property names, in the JS style-object dialects (React Native
 * `StyleSheet`, inline `style` objects, theme objects), mapped to their axis.
 * Compared after camelCase/kebab-case normalization, so the same table serves
 * `borderRadius`, `border-radius`, and `BORDER_RADIUS`.
 */
const PROPERTY_AXES = new Map(
  Object.entries({
    // color
    color: "color",
    backgroundcolor: "color",
    background: "color",
    bordercolor: "color",
    bordertopcolor: "color",
    borderbottomcolor: "color",
    borderleftcolor: "color",
    borderrightcolor: "color",
    tintcolor: "color",
    shadowcolor: "color",
    placeholdertextcolor: "color",
    fill: "color",
    stroke: "color",
    // spacing
    padding: "spacing",
    paddingtop: "spacing",
    paddingbottom: "spacing",
    paddingleft: "spacing",
    paddingright: "spacing",
    paddinghorizontal: "spacing",
    paddingvertical: "spacing",
    margin: "spacing",
    margintop: "spacing",
    marginbottom: "spacing",
    marginleft: "spacing",
    marginright: "spacing",
    marginhorizontal: "spacing",
    marginvertical: "spacing",
    gap: "spacing",
    rowgap: "spacing",
    columngap: "spacing",
    // typography
    fontsize: "typography",
    fontweight: "typography",
    lineheight: "typography",
    letterspacing: "typography",
    fontfamily: "typography",
    // radius
    borderradius: "radius",
    bordertopleftradius: "radius",
    bordertoprightradius: "radius",
    borderbottomleftradius: "radius",
    borderbottomrightradius: "radius",
    // elevation
    elevation: "elevation",
    shadowopacity: "elevation",
    shadowradius: "elevation",
    boxshadow: "elevation",
    // motion
    animationduration: "motion",
    transitionduration: "motion",
    transitiondelay: "motion",
  })
);

/**
 * Literals that are unmistakably colours, wherever they appear. Colour is the
 * one axis whose values are self-identifying, so it is caught by shape as well
 * as by property name — a `#3A7BD5` handed to a prop this table never heard of
 * is still a colour copied out of a design file.
 *
 * Kept as two simple patterns rather than one alternation: the combined form
 * tripped the regex-complexity budget, and two named shapes read better anyway.
 */
const HEX_COLOR = /^#[0-9a-f]{3,8}$/iu;

/** The functional colour notations. */
const FUNCTIONAL_COLOR = /^(?:rgba?|hsla?)\([^)]*\)$/iu;

/**
 * One CSS declaration, already isolated to a single `property: value` slice.
 * Splitting first and matching an anchored pattern second keeps the matcher
 * linear — a single scanning regex over the whole body backtracks.
 */
const CSS_DECLARATION = /^([a-z][a-z-]*):(.+)$/iu;

/** A CSS value that is a variable reference rather than a bare literal. */
const CSS_VARIABLE_REFERENCE = /var\(|\$\{|\$[a-z_]/iu;

/** Tag callees that mean "the template body is CSS". */
const CSS_TAGS = new Set(["css", "styled", "createGlobalStyle", "keyframes"]);

/**
 * Normalize a property name so `borderRadius`, `border-radius`, and
 * `BORDER_RADIUS` all reach the same table entry.
 * @param {string} name - Raw property name.
 * @returns {string} Lowercased name with separators removed.
 */
function normalizeProperty(name) {
  return String(name).replaceAll(/[-_]/gu, "").toLowerCase();
}

/**
 * Resolve the static name of an object-property or JSX-attribute key.
 * @param {object} node - Property or JSXAttribute node.
 * @returns {string | null} The key's name, or null when it is computed.
 */
function keyNameOf(node) {
  const key = node?.key ?? node?.name;
  if (!key) return null;
  if (node?.computed === true) return null;
  if (key.type === "Identifier" || key.type === "JSXIdentifier")
    return key.name;
  if (key.type === "Literal" && typeof key.value === "string") return key.value;
  return null;
}

/**
 * Read a literal's value when the node is a plain literal (or a negated
 * numeric one, which is a `UnaryExpression` in the AST rather than a Literal).
 * @param {object} node - Value node.
 * @returns {{ value: string | number } | null} The literal value, or null.
 */
function literalValueOf(node) {
  if (node?.type === "Literal") {
    const { value } = node;
    return typeof value === "string" || typeof value === "number"
      ? { value }
      : null;
  }
  if (
    node?.type === "UnaryExpression" &&
    node.operator === "-" &&
    node.argument?.type === "Literal" &&
    typeof node.argument.value === "number"
  ) {
    return { value: -node.argument.value };
  }
  return null;
}

/**
 * Decide the axis a literal belongs to, or null when it belongs to none.
 * @param {string | null} property - Normalized property name, if any.
 * @param {string | number} value - The literal value.
 * @returns {string | null} Axis name, or null.
 */
function axisFor(property, value) {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (HEX_COLOR.test(trimmed) || FUNCTIONAL_COLOR.test(trimmed)) {
      return "color";
    }
  }
  return property === null ? null : (PROPERTY_AXES.get(property) ?? null);
}

/**
 * True when the file is a place design values are *defined* rather than
 * consumed — a theme or token module is exactly where the literals belong,
 * because that is the file the variables are mirrored into.
 * @param {string} filename - Absolute or relative file path.
 * @param {readonly string[]} tokenSourcePaths - Path fragments to exempt.
 * @returns {boolean} Whether the file defines tokens.
 */
function isTokenSource(filename, tokenSourcePaths) {
  const normalized = String(filename).replaceAll("\\", "/").toLowerCase();
  return tokenSourcePaths.some(fragment =>
    normalized.includes(String(fragment).toLowerCase())
  );
}

/**
 * Extract every axis-bearing CSS declaration from a tagged template body.
 *
 * Styled-component and `css` template bodies are opaque to a property-name
 * visitor — the declarations live inside a string, not in the AST — so they are
 * parsed here rather than left uncovered.
 * @param {string} text - The concatenated template body.
 * @returns {{ property: string, value: string, axis: string }[]} Findings.
 */
function cssDeclarations(text) {
  const found = [];
  for (const slice of text.split(/[;{}\n]/u)) {
    const match = CSS_DECLARATION.exec(slice.trim());
    if (match === null) continue;
    const property = normalizeProperty(match[1] ?? "");
    const value = (match[2] ?? "").trim();
    if (value.length === 0 || CSS_VARIABLE_REFERENCE.test(value)) continue;
    const axis = axisFor(property, value);
    if (axis !== null) found.push({ property, value, axis });
  }
  return found;
}

/**
 * True when the tagged template is CSS (`styled.div`, `styled(X)`, `css`).
 * @param {object} node - TaggedTemplateExpression node.
 * @returns {boolean} Whether the body should be read as CSS.
 */
function isCssTag(node) {
  const tag = node?.tag;
  if (tag?.type === "Identifier") return CSS_TAGS.has(tag.name);
  if (tag?.type === "MemberExpression" && tag.object?.type === "Identifier") {
    return CSS_TAGS.has(tag.object.name);
  }
  if (tag?.type === "CallExpression" && tag.callee?.type === "Identifier") {
    return CSS_TAGS.has(tag.callee.name);
  }
  return false;
}

module.exports = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow hardcoded style values in an axis that has a published design-variable collection",
      category: "Best Practices",
      recommended: false,
    },
    fixable: null,
    schema: [
      {
        type: "object",
        properties: {
          typedAxes: {
            type: "array",
            items: { type: "string", enum: AXES },
            uniqueItems: true,
          },
          ignoreValues: {
            type: "array",
            items: { type: ["string", "number"] },
          },
          tokenSourcePaths: {
            type: "array",
            items: { type: "string" },
          },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      unboundDesignValue:
        "This project publishes {{axis}} as design variables, so `{{property}}: {{value}}` is a copied number that changes without warning. Use the published {{axis}} variable, or ask for one to be published for this value.",
    },
  },

  create(context) {
    const options = context.options[0] ?? {};
    const typedAxes = new Set(options.typedAxes ?? []);
    // `0` and `1` are ignored by default: a zero is the absence of a value and
    // a one is almost always a hairline border, and neither is a number any
    // design system publishes as a token. Reporting them is the noise that
    // gets a rule switched off.
    const ignoreValues = new Set(options.ignoreValues ?? [0, 1]);
    const tokenSourcePaths = options.tokenSourcePaths ?? [
      "/theme/",
      "/themes/",
      "/tokens/",
      "/design-system/",
      "/design-tokens/",
    ];

    // Nothing is typed until the project says so. This is the regime gate: on a
    // project with no declared variable collections the rule visits nothing.
    if (typedAxes.size === 0) return {};

    const filename = context.filename ?? context.getFilename();
    if (isTokenSource(filename, tokenSourcePaths)) return {};

    /**
     * Report one finding when its axis is typed and its value is not exempt.
     * @param {object} node - Node to attach the report to.
     * @param {string} property - Human-readable property name.
     * @param {string | number} value - The literal value.
     * @param {string | null} axis - Resolved axis.
     * @returns {void}
     */
    const reportIfTyped = (node, property, value, axis) => {
      if (axis === null || !typedAxes.has(axis)) return;
      if (ignoreValues.has(value)) return;
      context.report({
        node,
        messageId: "unboundDesignValue",
        data: { axis, property, value: String(value) },
      });
    };

    /**
     * Shared handler for a keyed node carrying a single literal value.
     * @param {object} node - Property or JSXAttribute node.
     * @param {object} valueNode - The node holding the value.
     * @returns {void}
     */
    const checkKeyedLiteral = (node, valueNode) => {
      const rawKey = keyNameOf(node);
      const literal = literalValueOf(valueNode);
      if (literal === null) return;
      const property = rawKey === null ? null : normalizeProperty(rawKey);
      reportIfTyped(
        valueNode,
        rawKey ?? "value",
        literal.value,
        axisFor(property, literal.value)
      );
    };

    return {
      Property(node) {
        checkKeyedLiteral(node, node.value);
      },

      JSXAttribute(node) {
        const valueNode =
          node.value?.type === "JSXExpressionContainer"
            ? node.value.expression
            : node.value;
        checkKeyedLiteral(node, valueNode);
      },

      TaggedTemplateExpression(node) {
        if (!isCssTag(node)) return;
        const body = (node.quasi?.quasis ?? [])
          .map(quasi => quasi.value?.cooked ?? quasi.value?.raw ?? "")
          .join("\n${...}\n");
        for (const finding of cssDeclarations(body)) {
          reportIfTyped(node, finding.property, finding.value, finding.axis);
        }
      },
    };
  },
};
