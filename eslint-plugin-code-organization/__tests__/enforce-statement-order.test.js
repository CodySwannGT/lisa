/* eslint-disable max-lines -- comprehensive test coverage requires extensive test cases */
/**
 * Tests for enforce-statement-order ESLint rule
 *
 * Enforces the order: definitions → side effects → return
 * 1. Definitions: const/let/var declarations, function declarations
 * 2. Side effects: Expression statements that are function calls
 * 3. Return statement
 */
const { RuleTester } = require("eslint");

const rule = require("../rules/enforce-statement-order");

/** Message data constants for test assertions */
const DEFINITIONS = "Definitions";
const SIDE_EFFECTS = "Side effects";
const RETURN_STATEMENT = "Return statement";

const ruleTester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2020,
    sourceType: "module",
    parserOptions: {
      ecmaFeatures: {
        jsx: true,
      },
    },
  },
});

ruleTester.run("enforce-statement-order", rule, {
  valid: [
    // ===== BASIC PATTERNS =====

    // Correct order: definitions → side effects → return
    {
      code: `
        function example() {
          const x = 1;
          doSomething();
          return x;
        }
      `,
    },

    // Definitions only (no side effects)
    {
      code: `
        function example() {
          const x = 1;
          const y = 2;
          return x + y;
        }
      `,
    },

    // Multiple side effects in correct position
    {
      code: `
        function example() {
          const x = 1;
          doSomething();
          doSomethingElse();
          logger.info("done");
          return x;
        }
      `,
    },

    // Function declaration followed by side effect
    {
      code: `
        function example() {
          const x = 1;
          function helper() {}
          doSomething();
          return x;
        }
      `,
    },

    // No return statement (void function)
    {
      code: `
        function example() {
          const x = 1;
          doSomething();
        }
      `,
    },

    // Only side effects (no definitions, no return)
    {
      code: `
        function example() {
          doSomething();
          doSomethingElse();
        }
      `,
    },

    // ===== REACT PATTERNS =====

    // React hook with correct order
    {
      code: `
        const useExample = () => {
          const [state, setState] = useState(null);
          const data = useMemo(() => [], []);
          const handleClick = useCallback(() => {}, []);

          useEffect(() => {}, []);

          return data;
        };
      `,
    },

    // React component with correct order
    {
      code: `
        const MyComponent = () => {
          const [state, setState] = useState(null);
          const data = useMemo(() => [], []);

          useEffect(() => {}, []);
          logRender();

          return <div>{data}</div>;
        };
      `,
    },

    // React component function declaration
    {
      code: `
        function MyComponent() {
          const [state, setState] = useState(null);
          const handleClick = useCallback(() => {}, []);

          useEffect(() => {}, []);

          return <div />;
        }
      `,
    },

    // Early return pattern after side effects is valid
    {
      code: `
        const MyComponent = () => {
          const [loading, setLoading] = useState(true);

          useEffect(() => {}, []);

          if (loading) return null;

          return <div />;
        };
      `,
    },

    // Early return with block statement after side effects
    {
      code: `
        const MyComponent = () => {
          const data = useMemo(() => [], []);

          useEffect(() => {}, []);

          if (!data) {
            return null;
          }

          return <div />;
        };
      `,
    },

    // ===== ARROW FUNCTIONS =====

    // Arrow function with correct order
    {
      code: `
        const process = () => {
          const config = getConfig();
          initialize();
          return config;
        };
      `,
    },

    // ===== EDGE CASES =====

    // Empty function
    {
      code: `
        function empty() {}
      `,
    },

    // Only return
    {
      code: `
        function getValue() {
          return 42;
        }
      `,
    },

    // Nested functions are checked independently
    {
      code: `
        function outer() {
          const x = 1;
          const inner = () => {
            const y = 2;
            doSomething();
            return y;
          };
          doSomething();
          return x;
        }
      `,
    },
  ],

  invalid: [
    // ===== BASIC VIOLATIONS =====

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

    // ===== REACT VIOLATIONS =====

    // Variable after useEffect
    {
      code: `
        const useExample = () => {
          useEffect(() => {}, []);
          const data = useMemo(() => [], []);
          return data;
        };
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

    // useCallback after useEffect
    {
      code: `
        const MyComponent = () => {
          const [state, setState] = useState(null);
          useEffect(() => {}, []);
          const handleClick = useCallback(() => {}, []);
          return <div />;
        };
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

    // Function declaration after side effect
    {
      code: `
        function MyComponent() {
          useEffect(() => {}, []);
          function handleClick() {}
          return <div />;
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

    // ===== ARROW FUNCTION VIOLATIONS =====

    // Arrow function with side effect before definition
    {
      code: `
        const process = () => {
          initialize();
          const config = getConfig();
          return config;
        };
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

console.log("All enforce-statement-order tests passed!");
/* eslint-enable max-lines -- comprehensive test coverage requires extensive test cases */
