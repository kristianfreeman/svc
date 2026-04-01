import { spawn } from "node:child_process";

export interface LogsCommandOptions {
  follow?: boolean;
}

export async function runLogsCommand(label: string, options: LogsCommandOptions): Promise<void> {
  const args = options.follow
    ? ["stream", "--style", "compact", "--predicate", `eventMessage CONTAINS[c] \"${label}\"`]
    : ["show", "--last", "1h", "--style", "compact", "--predicate", `eventMessage CONTAINS[c] \"${label}\"`];

  await new Promise<void>((resolve, reject) => {
    const child = spawn("log", args, { stdio: "inherit" });
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`log command exited with code ${code}`));
    });
  });
}
