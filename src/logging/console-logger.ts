import pc from 'picocolors';
import type { ILogger } from './logger.interface.js';

/**
 * Console logger with colored output
 */
export class ConsoleLogger implements ILogger {
  info(message: string): void {
    console.log(`${pc.blue('[INFO]')} ${message}`);
  }

  success(message: string): void {
    console.log(`${pc.green('[OK]')} ${message}`);
  }

  warn(message: string): void {
    console.log(`${pc.yellow('[WARN]')} ${message}`);
  }

  error(message: string): void {
    console.log(`${pc.red('[ERROR]')} ${message}`);
  }

  dry(message: string): void {
    console.log(`${pc.blue('[DRY-RUN]')} ${message}`);
  }
}
