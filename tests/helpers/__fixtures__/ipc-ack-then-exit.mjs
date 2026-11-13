// IPC companion fixture for the waitForMessage ack/exit ordering controls.
// "ack" mirrors the reaper's DISARMED path (lisa-test-run-reaper.ts): send the
// acknowledgement, then disconnect and exit from inside the send callback, so
// the parent may observe 'exit' before it dispatches the queued 'message'.
// "no-ack" exits with code 1 without sending anything.
const mode = process.argv[2];

if (mode === "ack") {
  process.send({ schema: 1, type: "DISARMED" }, () => {
    process.disconnect();
    process.exit(0);
  });
} else {
  process.exit(1);
}
