/** Synthetic vendor-command process for ordinary lifecycle tests only. */
import { spawn } from "node:child_process";
import { appendFileSync, writeFileSync } from "node:fs";

const [mode, receipt] = process.argv.slice(2);
appendFileSync("calls.jsonl", `${JSON.stringify(process.argv.slice(2))}\n`);
if (mode === "success") {
  process.stdin.resume();
  process.stdin.on("end", () => process.stdout.write("input-closed\n"));
} else if (mode === "failure") {
  process.exitCode = 7;
} else if (mode === "wait") {
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
    stdio: "inherit",
  });
  writeFileSync(
    receipt,
    JSON.stringify({ parent: process.pid, child: child.pid })
  );
  setInterval(() => {}, 1000);
}
