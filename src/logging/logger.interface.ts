/**
 * Log levels for Lisa operations
 */
export type LogLevel = 'info' | 'success' | 'warn' | 'error' | 'dry';

/**
 * Interface for logging implementations
 */
export interface ILogger {
  /** Log an informational message */
  info(message: string): void;

  /** Log a success message */
  success(message: string): void;

  /** Log a warning message */
  warn(message: string): void;

  /** Log an error message */
  error(message: string): void;

  /** Log a dry-run message */
  dry(message: string): void;
}
