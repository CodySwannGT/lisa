/**
 * Type declarations for minimatch v3.
 *
 * minimatch v3 is a CommonJS module that exports the match function directly as
 * module.exports (CJS `export =` pattern). v4+ switched to named ESM exports, but
 * v3 is used intentionally so downstream projects hoist it top-level and satisfy
 * test-exclude's requirement for a callable require('minimatch') result.
 *
 * With `esModuleInterop: true`, TypeScript allows `import minimatch from 'minimatch'`
 * for modules that use `export =`.
 *
 * @module types/minimatch
 */

declare module "minimatch" {
  /**
   * Options for minimatch glob pattern matching
   */
  interface IOptions {
    /** Match dotfiles even when the pattern does not explicitly include a dot */
    readonly dot?: boolean;
    /** Disable extglob support */
    readonly noext?: boolean;
    /** Allow pattern to match the basename of the path if it contains no slashes */
    readonly matchBase?: boolean;
    /** Perform case-insensitive matching */
    readonly nocase?: boolean;
    /** Return the pattern itself when no matches are found */
    readonly nonull?: boolean;
    /** Disable globstar support */
    readonly noglobstar?: boolean;
  }

  /**
   * Test whether a string matches a minimatch pattern
   * @param p - Path string to test
   * @param pattern - Glob pattern to test against
   * @param options - Optional matching options
   * @returns True if the path matches the pattern
   */
  function minimatch(p: string, pattern: string, options?: IOptions): boolean;

  namespace minimatch {
    /**
     * Return a function that tests strings against a pattern
     * @param pattern - Glob pattern to compile into a filter predicate
     * @param options - Optional matching options
     * @returns Predicate function that tests a path string against the pattern
     */
    function filter(
      pattern: string,
      options?: IOptions
    ): (p: string) => boolean;

    /**
     * Match a list of strings against a pattern
     * @param list - Array of path strings to test
     * @param pattern - Glob pattern to match against
     * @param options - Optional matching options
     * @returns Subset of list entries that match the pattern
     */
    function match(
      list: string[],
      pattern: string,
      options?: IOptions
    ): string[];

    /**
     * Compile a pattern into a RegExp
     * @param pattern - Glob pattern to compile
     * @param options - Optional matching options
     * @returns Regular expression equivalent of the glob pattern
     */
    function makeRe(pattern: string, options?: IOptions): RegExp;
  }

  export = minimatch;
}
