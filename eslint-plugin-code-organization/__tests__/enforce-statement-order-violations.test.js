/**
 * This file is managed by Lisa.
 * Do not edit directly — changes will be overwritten on the next `lisa` run.
 */

/**
 * Tests for enforce-statement-order: basic and non-React violations.
 */
const {
  DEFINITIONS,
  RETURN_STATEMENT,
  SIDE_EFFECTS,
  rule,
  ruleTester,
} = require("./statement-order-tester");

ruleTester.run("enforce-statement-order", rule, {
  valid: [],

  invalid: [
    // ===== BASIC VIOLATIONS =====

    // The order is checked against the highest one seen, not the previous
    // statement: a definition after the return does not reset the order, so a
    // side effect after that definition is still out of place.
    {
      code: `
        function example() {
          const x = 1;
          return x;
          const y = 2;
          doSomething(y);
        }
      `,
      errors: [
        {
          messageId: "wrongOrder",
          data: {
            current: DEFINITIONS,
            previous: RETURN_STATEMENT,
          },
        },
        {
          messageId: "wrongOrder",
          data: {
            current: SIDE_EFFECTS,
            previous: RETURN_STATEMENT,
          },
        },
      ],
    },

    // Definition after side effect
    {
      code: `
        function example() {
          doSomething();
          const x = 1;
          return x;
        }
      `,
      errors: [
        {
          messageId: "wrongOrder",
          data: {
            current: DEFINITIONS,
            previous: SIDE_EFFECTS,
          },
        },
      ],
    },

    // Side effect after return
    {
      code: `
        function example() {
          const x = 1;
          return x;
          doSomething();
        }
      `,
      errors: [
        {
          messageId: "wrongOrder",
          data: {
            current: SIDE_EFFECTS,
            previous: RETURN_STATEMENT,
          },
        },
      ],
    },

    // Definition after return
    {
      code: `
        function example() {
          return 1;
          const x = 2;
        }
      `,
      errors: [
        {
          messageId: "wrongOrder",
          data: {
            current: DEFINITIONS,
            previous: RETURN_STATEMENT,
          },
        },
      ],
    },

    // Multiple violations
    {
      code: `
        function example() {
          doSomething();
          const x = 1;
          return x;
          const y = 2;
        }
      `,
      errors: [
        {
          messageId: "wrongOrder",
          data: {
            current: DEFINITIONS,
            previous: SIDE_EFFECTS,
          },
        },
        {
          messageId: "wrongOrder",
          data: {
            current: DEFINITIONS,
            previous: RETURN_STATEMENT,
          },
        },
      ],
    },

    // ===== NON-REACT VIOLATIONS =====

    // Plain function call before definition
    {
      code: `
        function process() {
          initialize();
          const config = {};
          return config;
        }
      `,
      errors: [
        {
          messageId: "wrongOrder",
          data: {
            current: DEFINITIONS,
            previous: SIDE_EFFECTS,
          },
        },
      ],
    },

    // Logger call before definition
    {
      code: `
        function getData() {
          logger.info("fetching");
          const data = fetch();
          return data;
        }
      `,
      errors: [
        {
          messageId: "wrongOrder",
          data: {
            current: DEFINITIONS,
            previous: SIDE_EFFECTS,
          },
        },
      ],
    },

    // Awaited side effect before definition
    {
      code: `
        async function loadData() {
          await fetchData();
          const data = [];
          return data;
        }
      `,
      errors: [
        {
          messageId: "wrongOrder",
          data: {
            current: DEFINITIONS,
            previous: SIDE_EFFECTS,
          },
        },
      ],
    },

    // Console.log before definition
    {
      code: `
        function debug() {
          console.log("starting");
          const value = compute();
          return value;
        }
      `,
      errors: [
        {
          messageId: "wrongOrder",
          data: {
            current: DEFINITIONS,
            previous: SIDE_EFFECTS,
          },
        },
      ],
    },
  ],
});
