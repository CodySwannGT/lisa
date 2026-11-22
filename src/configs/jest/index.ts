/**
 * Jest configuration factory functions.
 *
 * Expo is the only Lisa stack that runs Jest; every other stack runs Vitest
 * (`@codyswann/lisa/vitest/*`). The TypeScript, NestJS and CDK Jest factories
 * were removed because no stack used them: Lisa deletes those stacks'
 * jest.config.ts on apply (CodySwannGT/lisa#4927).
 * @module configs/jest
 */
export * from "./base.js";
export * from "./expo.js";
