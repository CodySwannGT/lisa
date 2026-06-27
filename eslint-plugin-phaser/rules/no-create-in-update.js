/**
 * This file is managed by Lisa.
 * Do not edit directly — changes will be overwritten on the next `lisa` run.
 */

/**
 * ESLint rule: no-create-in-update
 *
 * Flags creation of GameObjects, tweens, timers, and Phaser objects inside a
 * Scene's `update(time, delta)` method. `update` runs every frame; creating
 * objects there churns the heap and stutters the frame budget. Create in
 * `create()` and reuse (pool) instead.
 *
 * Detected (when lexically in the update method body, not in nested functions):
 * - this.add.* / this.make.*               (GameObjectFactory / GameObjectCreator)
 * - this.physics.add.*                      (Arcade factory)
 * - this.tweens.add/addCounter/chain/create (Tween creation)
 * - this.time.addEvent/delayedCall/addLoop  (Timer creation)
 * - this.sound.add / this.anims.create / this.particles.add
 * - new Phaser.*                            (Phaser object allocation)
 * @module eslint-plugin-phaser/rules/no-create-in-update
 */

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
 * Decode a MemberExpression chain into its root node and ordered property names.
 * @param {object} node - A MemberExpression node
 * @returns {{root: object, props: (string|null)[]}} Root node and property names
 */
function memberInfo(node) {
  const props = [];
  /**
   * Walk up the member chain, collecting property names.
   * @param {object} cur - Current node in the chain
   * @returns {object} The non-member root node
   */
  const walk = cur => {
    if (cur && cur.type === "MemberExpression") {
      props.unshift(
        cur.property && cur.property.type === "Identifier"
          ? cur.property.name
          : null
      );
      return walk(cur.object);
    }
    return cur;
  };
  return { root: walk(node), props };
}

/**
 * Determine whether a function node IS a Phaser Scene update method.
 * @param {object} node - A function-like node
 * @returns {boolean} True if the node is an `update` method/field/declaration
 */
function isUpdateFunction(node) {
  if (
    node.type === "FunctionDeclaration" &&
    node.id &&
    node.id.name === "update"
  ) {
    return true;
  }
  const parent = node.parent;
  if (!parent) return false;
  if (
    (parent.type === "MethodDefinition" ||
      parent.type === "PropertyDefinition") &&
    parent.value === node &&
    keyName(parent.key) === "update"
  ) {
    return true;
  }
  return false;
}

/**
 * Patterns that create new objects, keyed by the leading `this.<segment>` chain.
 * @param {(string|null)[]} props - Ordered property names from `this`
 * @returns {boolean} True if the chain is a known creation call
 */
function isCreationChain(props) {
  const [a, b] = props;
  if (a === "add" || a === "make") return true;
  if (a === "physics" && b === "add") return true;
  if (
    a === "tweens" &&
    (b === "add" || b === "addCounter" || b === "chain" || b === "create")
  ) {
    return true;
  }
  if (
    a === "time" &&
    (b === "addEvent" || b === "delayedCall" || b === "addLoop")
  )
    return true;
  if (a === "sound" && b === "add") return true;
  if (a === "anims" && b === "create") return true;
  if (a === "particles" && b === "add") return true;
  return false;
}

module.exports = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow creating GameObjects, tweens, timers, or Phaser objects inside a Scene update() method",
      category: "Best Practices",
      recommended: true,
    },
    fixable: null,
    schema: [],
    messages: {
      createInUpdate:
        "Do not create objects in update() — it runs every frame. Create in create() and pool/reuse (Group.get / killAndHide).",
      newInUpdate:
        "Do not allocate Phaser objects (new Phaser.*) in update() — it runs every frame. Hoist a reusable scratch instance to create().",
    },
  },

  create(context) {
    const fnStack = [];
    const inUpdateBody = () =>
      fnStack.length > 0 && fnStack[fnStack.length - 1];

    /**
     * Push function scope state on entry.
     * @param {object} node - The function node being entered
     * @returns {void}
     */
    const enter = node => fnStack.push(isUpdateFunction(node));
    const exit = () => fnStack.pop();

    return {
      FunctionDeclaration: enter,
      "FunctionDeclaration:exit": exit,
      FunctionExpression: enter,
      "FunctionExpression:exit": exit,
      ArrowFunctionExpression: enter,
      "ArrowFunctionExpression:exit": exit,

      CallExpression(node) {
        if (!inUpdateBody()) return;
        if (node.callee.type !== "MemberExpression") return;
        const { root, props } = memberInfo(node.callee);
        if (root.type !== "ThisExpression") return;
        if (isCreationChain(props)) {
          context.report({ node, messageId: "createInUpdate" });
        }
      },

      NewExpression(node) {
        if (!inUpdateBody()) return;
        if (node.callee.type !== "MemberExpression") return;
        const { root } = memberInfo(node.callee);
        if (root.type === "Identifier" && root.name === "Phaser") {
          context.report({ node, messageId: "newInUpdate" });
        }
      },
    };
  },
};
