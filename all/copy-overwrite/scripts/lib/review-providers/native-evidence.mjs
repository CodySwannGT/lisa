// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.
// Managed by Lisa. Positive evidence must identify a real native submitted record.

/** Native IDs identify check runs without inventing a creation-timestamp field. */
export function nativeId(row) {
  return Number.isSafeInteger(row?.id) && row.id > 0;
}

/** Validate the immutable native record ID and its native ordering timestamp. */
export function nativeRecord(row, dateField = "created_at") {
  const date = row?.[dateField];
  return (
    nativeId(row) &&
    typeof date === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/u.test(date) &&
    Number.isFinite(Date.parse(date))
  );
}

/** A submitted review also needs a stable positive native actor identity. */
export function submittedReview(row) {
  return (
    nativeRecord(row, "submitted_at") &&
    Number.isSafeInteger(row.user?.id) &&
    row.user.id > 0
  );
}
