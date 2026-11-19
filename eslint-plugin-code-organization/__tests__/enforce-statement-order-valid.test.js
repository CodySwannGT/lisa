/**
 * This file is managed by Lisa.
 * Do not edit directly — changes will be overwritten on the next `lisa` run.
 */

/**
 * Tests for enforce-statement-order: code in the expected order.
 */
const { rule, ruleTester } = require("./statement-order-tester");

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

    // Compatibility mode preserves the legacy variable/function-declaration scan
    {
      code: `
        class Processor {
          run() {
            initialize();
            const config = getConfig();
            return config;
          }
        }
      `,
      options: [{ checkAllFunctionBodies: false }],
    },

    // super() is a language-mandated prologue, not a side effect: definitions
    // after it must not be flagged (derived constructors cannot avoid this)
    {
      code: `
        class NetworkStage extends Stage {
          constructor(scope, id, props) {
            super(scope, id, props);
            const environment = props.environment;
            const natGatewayCount = environment === "production" ? 3 : 1;
            configureNetwork(environment, natGatewayCount);
          }
        }
      `,
    },

    // super() alone with only definitions after it
    {
      code: `
        class Widget extends Base {
          constructor(options) {
            super(options);
            const name = options.name;
            this.name = name;
          }
        }
      `,
    },
  ],

  invalid: [],
});
