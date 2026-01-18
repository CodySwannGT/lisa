/**
 * Base error class for all Lisa errors
 */
export class LisaError extends Error {
  /**
   * Base Lisa error with error code
   *
   * @param message - Error message description
   * @param code - Machine-readable error code
   */
  constructor(
    message: string,
    public readonly code: string
  ) {
    super(message);
    this.name = "LisaError";
  }
}

/**
 * Error thrown when destination directory is not found
 */
export class DestinationNotFoundError extends LisaError {
  /**
   * Thrown when destination directory path does not exist
   *
   * @param path - Path that was not found
   */
  constructor(public readonly path: string) {
    super(`Destination path does not exist: ${path}`, "DEST_NOT_FOUND");
    this.name = "DestinationNotFoundError";
  }
}

/**
 * Error thrown when destination is not a directory
 */
export class DestinationNotDirectoryError extends LisaError {
  /**
   * Thrown when destination path exists but is not a directory
   *
   * @param path - Path that is not a directory
   */
  constructor(public readonly path: string) {
    super(`Destination is not a directory: ${path}`, "DEST_NOT_DIR");
    this.name = "DestinationNotDirectoryError";
  }
}

/**
 * Error thrown when JSON parsing fails
 */
export class JsonParseError extends LisaError {
  /**
   * Thrown when JSON file parsing fails
   *
   * @param filePath - Path to the JSON file that failed to parse
   * @param originalError - Underlying parsing error
   */
  constructor(
    public readonly filePath: string,
    public readonly originalError: Error
  ) {
    super(`Failed to parse JSON file: ${filePath}`, "JSON_PARSE_ERROR");
    this.name = "JsonParseError";
  }
}

/**
 * Error thrown when JSON merge fails
 */
export class JsonMergeError extends LisaError {
  /**
   * Thrown when JSON merge operation fails
   *
   * @param filePath - Path to the JSON file that failed to merge
   * @param reason - Description of why the merge failed
   */
  constructor(
    public readonly filePath: string,
    public readonly reason: string
  ) {
    super(`Failed to merge JSON: ${filePath} - ${reason}`, "JSON_MERGE_ERROR");
    this.name = "JsonMergeError";
  }
}

/**
 * Error thrown when file operation fails
 */
export class FileOperationError extends LisaError {
  /**
   * Thrown when a file operation (read/write/copy) fails
   *
   * @param operation - Name of the operation that failed
   * @param filePath - Path to the file involved in the operation
   * @param originalError - Underlying file system error
   */
  constructor(
    public readonly operation: string,
    public readonly filePath: string,
    public readonly originalError: Error
  ) {
    super(
      `File operation '${operation}' failed for: ${filePath}`,
      "FILE_OP_ERROR"
    );
    this.name = "FileOperationError";
  }
}

/**
 * Error thrown when backup/restore fails
 */
export class BackupError extends LisaError {
  /**
   * Thrown when backup, restore, or cleanup operation fails
   *
   * @param operation - Type of backup operation that failed
   * @param reason - Description of why the operation failed
   */
  constructor(
    public readonly operation: "backup" | "restore" | "cleanup",
    public readonly reason: string
  ) {
    super(`Backup ${operation} failed: ${reason}`, "BACKUP_ERROR");
    this.name = "BackupError";
  }
}

/**
 * Error thrown when rollback fails
 */
export class RollbackError extends LisaError {
  /**
   * Thrown when transaction rollback fails
   *
   * @param reason - Description of why rollback failed
   */
  constructor(public readonly reason: string) {
    super(`Rollback failed: ${reason}`, "ROLLBACK_ERROR");
    this.name = "RollbackError";
  }
}

/**
 * Error thrown when a required dependency is missing
 */
export class DependencyMissingError extends LisaError {
  /**
   * Thrown when required dependencies are not available
   *
   * @param dependencies - List of missing dependency names
   */
  constructor(public readonly dependencies: readonly string[]) {
    super(
      `Missing required dependencies: ${dependencies.join(", ")}`,
      "DEP_MISSING"
    );
    this.name = "DependencyMissingError";
  }
}
