/**
 * This file is managed by Lisa.
 * Do not edit directly — changes will be overwritten on the next `lisa` run.
 */

/**
 * ESLint rule: require-shutdown-cleanup
 *
 * A Phaser Scene is reused across restarts, and listeners registered on objects
 * that OUTLIVE the scene (this.input, this.scale, this.game.events, window,
 * document) are NOT auto-removed on shutdown — they leak and double-fire after a
 * restart. (Listeners on this.events are auto-cleaned, so they're exempt.)
 *
 * This rule flags a class that registers such a persistent external listener but
 * provides no cleanup path. Cleanup is satisfied by EITHER:
 * - a `shutdown()` method on the class, OR
 * - a `this.events.once('shutdown', ...)` / `Phaser.Scenes.Events.SHUTDOWN`
 *   handler registered in the class.
 * @module eslint-plugin-phaser/rules/require-shutdown-cleanup
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
 * Whether a call registers a listener on an emitter that outlives the scene.
 * @param {object} node - A CallExpression node
 * @returns {boolean} True for a persistent external listener registration
 */
function isLeakyListener(node) {
  if (node.callee.type !== "MemberExpression") return false;
  const method =
    node.callee.property.type === "Identifier"
      ? node.callee.property.name
      : null;
  // window/document/globalThis.addEventListener — external, outlives the scene.
  if (method === "addEventListener") {
    const obj = node.callee.object;
    return (
      obj.type === "Identifier" &&
      (obj.name === "window" ||
        obj.name === "document" ||
        obj.name === "globalThis")
    );
  }
  if (method !== "on") return false;
  const { root, props } = memberInfo(node.callee);
  if (root.type !== "ThisExpression") return false;
  // this.input(.keyboard|.gamepad|.mouse)?.on(...) and this.scale.on(...)
  if (props[0] === "input" || props[0] === "scale") return true;
  // this.game.events.on(...) — the global game emitter.
  if (props[0] === "game" && props[1] === "events") return true;
  return false;
}

/**
 * Whether a call registers a scene 'shutdown' handler (in-place cleanup).
 * @param {object} node - A CallExpression node
 * @returns {boolean} True for this.events.on/once('shutdown'|SHUTDOWN, ...)
 */
function isShutdownHandler(node) {
  if (node.callee.type !== "MemberExpression") return false;
  const method =
    node.callee.property.type === "Identifier"
      ? node.callee.property.name
      : null;
  if (method !== "on" && method !== "once") return false;
  const { root, props } = memberInfo(node.callee);
  if (root.type !== "ThisExpression" || props[0] !== "events") return false;
  const arg = node.arguments[0];
  if (!arg) return false;
  if (arg.type === "Literal" && arg.value === "shutdown") return true;
  // Phaser.Scenes.Events.SHUTDOWN
  if (arg.type === "MemberExpression" && arg.property.type === "Identifier") {
    return arg.property.name === "SHUTDOWN";
  }
  return false;
}

/**
 * Whether a class body declares a `shutdown` method or field.
 * @param {object} classNode - A ClassDeclaration/ClassExpression node
 * @returns {boolean} True if a `shutdown` member exists
 */
function hasShutdownMember(classNode) {
  return classNode.body.body.some(
    el =>
      (el.type === "MethodDefinition" || el.type === "PropertyDefinition") &&
      keyName(el.key) === "shutdown"
  );
}

module.exports = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Require a shutdown cleanup path when a Scene registers persistent external listeners",
      category: "Best Practices",
      recommended: true,
    },
    fixable: null,
    schema: [],
    messages: {
      requireShutdown:
        "This Scene registers a persistent external listener (this.input/scale/game.events or window/document) but has no cleanup. Add a shutdown() method, or this.events.once('shutdown', () => ...), and .off() every listener there — they are not auto-removed and will leak across scene restarts.",
    },
  },

  create(context) {
    const classStack = [];

    /**
     * Push class scope state on entry.
     * @param {object} node - The class node being entered
     * @returns {void}
     */
    const enterClass = node =>
      classStack.push({
        node,
        leaky: [],
        hasShutdown: hasShutdownMember(node),
      });

    /**
     * Report uncleaned listeners on class exit.
     * @returns {void}
     */
    const exitClass = () => {
      const frame = classStack.pop();
      if (!frame.hasShutdown && frame.leaky.length > 0) {
        for (const leakyNode of frame.leaky) {
          context.report({ node: leakyNode, messageId: "requireShutdown" });
        }
      }
    };

    return {
      ClassDeclaration: enterClass,
      ClassExpression: enterClass,
      "ClassDeclaration:exit": exitClass,
      "ClassExpression:exit": exitClass,
      CallExpression(node) {
        if (classStack.length === 0) return;
        const frame = classStack[classStack.length - 1];
        if (isShutdownHandler(node)) {
          frame.hasShutdown = true;
          return;
        }
        if (isLeakyListener(node)) {
          frame.leaky.push(node);
        }
      },
    };
  },
};
