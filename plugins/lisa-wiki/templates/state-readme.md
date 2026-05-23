# state/ — ingestion cursors

JSON cursors that let ingestion resume incrementally — one file per source/connector at
`state/<system>/*.json`. A cursor is advanced **only after** its source notes + synthesis + index +
log + verification all pass (never before). Common envelope:

```json
{
  "connector": "git",
  "profile": "default",
  "lastSuccessfulRunAt": "1970-01-01T00:00:00Z",
  "cursor": {},
  "sourceNotes": [],
  "synthesisPages": [],
  "schemaVersion": "1.0.0"
}
```

The post-migration / post-setup verification report is written to
`state/migration/doctor-report.json` by `/doctor`.
