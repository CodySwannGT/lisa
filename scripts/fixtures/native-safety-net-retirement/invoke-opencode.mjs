const mod = await import(process.argv[2]);
const hook = await mod[process.argv[3]]();
try {
  await hook["tool.execute.before"](
    { tool: "bash" },
    { args: { command: process.argv[4] } }
  );
  console.log(JSON.stringify({ decision: "allow" }));
} catch (error) {
  console.log(
    JSON.stringify({ decision: "deny", reason: String(error.message ?? error) })
  );
}
