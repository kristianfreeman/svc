import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { runValidateCommand } from "./validate.ts";

const execFileAsync = promisify(execFile);

export interface DoctorCommandOptions {
  all?: boolean;
  namespace?: string[];
  json?: boolean;
  cwd?: string;
}

export async function runDoctorCommand(options: DoctorCommandOptions): Promise<string> {
  const checks: Array<{ name: string; ok: boolean; detail: string }> = [];

  try {
    const result = await runValidateCommand({ all: options.all, namespace: options.namespace, cwd: options.cwd });
    checks.push({
      name: "config-validation",
      ok: true,
      detail: `validated ${result.namespaces} namespaces and ${result.services} services`
    });
  } catch (error) {
    checks.push({ name: "config-validation", ok: false, detail: (error as Error).message });
  }

  const launchctlVersion = await execFileAsync("launchctl", ["version"])
    .then((result) => result.stdout.trim() || "available")
    .catch((error) => `unavailable: ${(error as Error).message}`);

  checks.push({
    name: "launchctl",
    ok: !launchctlVersion.startsWith("unavailable:"),
    detail: launchctlVersion
  });

  if (options.json) {
    return JSON.stringify(
      {
        ok: checks.every((check) => check.ok),
        checks
      },
      null,
      2
    );
  }

  return checks
    .map((check) => `${check.ok ? "ok" : "fail"} ${check.name}: ${check.detail}`)
    .join("\n");
}
