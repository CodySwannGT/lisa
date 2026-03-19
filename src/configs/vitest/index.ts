/**
 * Vitest configuration factory functions for Lisa-supported stacks.
 *
 * Re-exports config factories and utilities from each stack module,
 * allowing downstream projects to import from a single entry point.
 *
 * Note: Expo remains on Jest. TypeScript, NestJS, and CDK
 * are available as Vitest configs.
 *
 * @module configs/vitest
 */
export * from "./base.js";
export * from "./typescript.js";
export * from "./nestjs.js";
export * from "./cdk.js";
