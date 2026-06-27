/**
 * This file is managed by Lisa.
 * Do not edit directly — changes will be overwritten on the next `lisa` run.
 */

/**
 * ESLint rule: no-allocation-in-update
 *
 * Flags heap allocations directly inside a Scene's `update(time, delta)` method.
 * `update` runs every frame, so allocations there create GC pressure that
 * stutters the frame budget. Hoist scratch objects/arrays to fields created
 * once in create(), and avoid per-frame array-iteration chains.
 *
 * Detected (lexically in the update method body, not in nested functions):
 * - object literals  ({ ... })
 * - array literals   ([ ... ])
 * - array-iteration method calls (.map/.filter/.reduce/.flatMap/.flat/.concat/.slice)
 * - new Array / Object / Map / Set / WeakMap / WeakSet / typed arrays
 * @module eslint-plugin-phaser/rules/no-allocation-in-update
 */

const ARRAY_ALLOC_METHODS = new Set([
  "map",
  "filter",
  "reduce",
  "reduceRight",
  "flatMap",
  "flat",
  "concat",
  "slice",
]);

const COLLECTION_CTORS = new Set([
  "Array",
  "Object",
  "Map",
  "Set",
  "WeakMap",
  "WeakSet",
  "Float32Array",
  "Float64Array",
  "Int32Array",
  "Uint8Array",
  "Uint16Array",
  "Uint32Array",
]);

/**
 * Resolve a property/method key node to its string name.
 * @param {object} key - An Identifier or Literal key node
 * @returns {string|null} The key name, or null if not resolvable
 */
function keyName(key) {
  if (!key) return null;
  if (key.type === "Identifier") return key.name;
  if (key.type === "Literal") return String(key.value);
  return null;
}

/**
 * Whether a class extends a Phaser Scene (superclass name ends in "Scene", e.g.
 * Phaser.Scene, Scene, BaseScene). Keeps this per-frame rule from firing on
 * unrelated classes that merely happen to define an update() method.
 * @param {object} classNode - A ClassDeclaration/ClassExpression node
 * @returns {boolean} True if the class extends a Scene-like superclass
 */
function extendsScene(classNode) {
  const sc = classNode.superClass;
  if (!sc) return false;
  if (sc.type === "Identifier") return /Scene$/.test(sc.name);
  if (sc.type === "MemberExpression" && sc.property.type === "Identifier") {
    return /Scene$/.test(sc.property.name);
  }
  return false;
}

/**
 * Whether the nearest enclosing class extends a Phaser Scene.
 * @param {object} node - Any node
 * @returns {boolean} True if an enclosing class extends a Scene
 */
function enclosingSceneClass(node) {
  const up = n => {
    if (!n) return false;
    if (n.type === "ClassDeclaration" || n.type === "ClassExpression") {
      return extendsScene(n);
    }
    return up(n.parent);
  };
  return up(node.parent);
}

/**
 * Determine whether a function node is the update() method of a Phaser Scene.
 * @param {object} node - A function-like node
 * @returns {boolean} True if it is a Scene update() method/field
 */
function isUpdateFunction(node) {
  const parent = node.parent;
  if (!parent) return false;
  if (
    (parent.type === "MethodDefinition" ||
      parent.type === "PropertyDefinition") &&
    parent.value === node &&
    keyName(parent.key) === "update"
  ) {
    return enclosingSceneClass(node);
  }
  return false;
}

module.exports = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow heap allocations (object/array literals, array-iteration chains, new collections) inside a Scene update() method",
      category: "Best Practices",
      recommended: true,
    },
    fixable: null,
    schema: [],
    messages: {
      objectLiteral:
        "Object literal allocated in update() (runs every frame). Hoist a reusable scratch object to a field set in create().",
      arrayLiteral:
        "Array literal allocated in update() (runs every frame). Hoist a reusable array, or iterate an existing one in place.",
      arrayMethod:
        "Array-iteration method '{{name}}' allocates in update() (runs every frame). Use a plain for-loop over the existing array.",
      newCollection:
        "new {{name}} allocated in update() (runs every frame). Create the collection once in create() and clear/reuse it.",
    },
  },

  create(context) {
    const fnStack = [];
    const inUpdateBody = () =>
      fnStack.length > 0 && fnStack[fnStack.length - 1];
    const enter = node => fnStack.push(isUpdateFunction(node));
    const exit = () => fnStack.pop();

    return {
      FunctionDeclaration: enter,
      "FunctionDeclaration:exit": exit,
      FunctionExpression: enter,
      "FunctionExpression:exit": exit,
      ArrowFunctionExpression: enter,
      "ArrowFunctionExpression:exit": exit,

      ObjectExpression(node) {
        if (inUpdateBody())
          context.report({ node, messageId: "objectLiteral" });
      },

      ArrayExpression(node) {
        if (inUpdateBody()) context.report({ node, messageId: "arrayLiteral" });
      },

      CallExpression(node) {
        if (!inUpdateBody()) return;
        if (
          node.callee.type === "MemberExpression" &&
          node.callee.property.type === "Identifier" &&
          ARRAY_ALLOC_METHODS.has(node.callee.property.name)
        ) {
          context.report({
            node,
            messageId: "arrayMethod",
            data: { name: node.callee.property.name },
          });
        }
      },

      NewExpression(node) {
        if (!inUpdateBody()) return;
        if (
          node.callee.type === "Identifier" &&
          COLLECTION_CTORS.has(node.callee.name)
        ) {
          context.report({
            node,
            messageId: "newCollection",
            data: { name: node.callee.name },
          });
        }
      },
    };
  },
};
