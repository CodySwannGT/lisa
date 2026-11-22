/**
 * This file is managed by Lisa.
 * Do not edit directly — changes will be overwritten on the next `lisa` run.
 */

/**
 * Tests for enforce-statement-order: React and arrow-function violations.
 */
const {
  DEFINITIONS,
  SIDE_EFFECTS,
  rule,
  ruleTester,
} = require("./statement-order-tester");

ruleTester.run("enforce-statement-order", rule, {
  valid: [],

  invalid: [
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

    // Class method with side effect before definition
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

    // super() neutrality must not mask real violations: a definition after a
    // genuine side effect inside a derived constructor is still flagged
    {
      code: `
        class NetworkStage extends Stage {
          constructor(scope, id, props) {
            super(scope, id, props);
            configureNetwork(props);
            const environment = props.environment;
            this.environment = environment;
          }
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

    // Object method with side effect before definition
    {
      code: `
        const processor = {
          run() {
            initialize();
            const config = getConfig();
            return config;
          },
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

    // Callback body with side effect before definition
    {
      code: `
        items.map(item => {
          track(item);
          const label = item.label;
          return label;
        });
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

    // Default-exported arrow function with side effect before definition
    {
      code: `
        export default () => {
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
