/** Synthetic vendor-command process for ordinary lifecycle tests only. */
import { spawn } from "node:child_process";
import { appendFileSync, renameSync, writeFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";

const [mode, receipt, startupDelay = "0"] = process.argv.slice(2);
appendFileSync("calls.jsonl", `${JSON.stringify(process.argv.slice(2))}\n`);
if (mode === "success") {
  process.stdin.resume();
  process.stdin.on("end", () => process.stdout.write("input-closed\n"));
} else if (mode === "failure") {
  process.exitCode = 7;
} else if (mode === "wait") {
  await delay(Number(startupDelay));
  const child = spawn(process.execPath, [process.argv[1], "child"], {
    stdio: ["ignore", "inherit", "inherit", "ipc"],
  });
  child.once("message", () => {
    writeFileSync(
      `${receipt}.pending`,
      JSON.stringify({ parent: process.pid, child: child.pid })
    );
    renameSync(`${receipt}.pending`, receipt);
  });
  setInterval(() => {}, 1000);
} else if (mode === "child") {
  setInterval(() => {}, 1000);
  process.send("ready");
}
