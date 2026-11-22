/** Isolated callback fixture: inspect tool command data; never execute it. */
import { pathToFileURL } from "node:url";
const [, , pluginPath, command = "", tool = "bash", workdir = process.cwd()] =
  process.argv;
if (!pluginPath)
  throw new Error("The callback fixture requires an explicit plugin path.");
const imported = await import(pathToFileURL(pluginPath).href);
const plugin = await imported.LisaBlockHostNameLeak();
try {
  await plugin["tool.execute.before"](
    { tool },
    {
      args: {
        command,
        workdir,
      },
    }
  );
  console.log(JSON.stringify({ verdict: "allow" }));
} catch (error) {
  console.log(
    JSON.stringify({ verdict: "deny", reason: String(error?.message ?? error) })
  );
}
