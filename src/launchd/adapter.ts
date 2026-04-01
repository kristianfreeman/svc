import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { DesiredService, RuntimeJobSnapshot } from "../planner/types.ts";

const execFileAsync = promisify(execFile);

export interface LaunchdAdapter {
  getRuntimeJobs(labels: string[]): Promise<RuntimeJobSnapshot[]>;
  listRuntimeLabels(): Promise<string[]>;
  upsertService(service: DesiredService): Promise<void>;
  deleteService(label: string): Promise<void>;
  restartService(label: string): Promise<void>;
}

export function createLaunchdAdapter(): LaunchdAdapter {
  return {
    async getRuntimeJobs(labels) {
      const uid = currentUid();
      const jobs: RuntimeJobSnapshot[] = [];
      for (const label of labels) {
        const target = `gui/${uid}/${label}`;
        const present = await execFileAsync("launchctl", ["print", target])
          .then(() => true)
          .catch(() => false);
        jobs.push({ label, present });
      }
      return jobs;
    },

    async listRuntimeLabels() {
      const { stdout } = await execFileAsync("launchctl", ["list"]);
      const lines = stdout
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
      const labels = lines
        .map((line) => line.split(/\s+/).at(-1) ?? "")
        .filter((label) => label !== "Label");
      return Array.from(new Set(labels)).sort((a, b) => a.localeCompare(b));
    },

    async upsertService(service) {
      const plistPath = plistFilePath(service.label);
      await fs.mkdir(path.dirname(plistPath), { recursive: true });
      await fs.writeFile(plistPath, renderPlist(service), "utf8");

      const uid = currentUid();
      const target = `gui/${uid}/${service.label}`;
      await execFileAsync("launchctl", ["bootout", target]).catch(() => undefined);
      await execFileAsync("launchctl", ["bootstrap", `gui/${uid}`, plistPath]);
    },

    async deleteService(label) {
      const uid = currentUid();
      const target = `gui/${uid}/${label}`;
      await execFileAsync("launchctl", ["bootout", target]).catch(() => undefined);
      await fs.rm(plistFilePath(label), { force: true });
    },

    async restartService(label) {
      const uid = currentUid();
      await execFileAsync("launchctl", ["kickstart", "-k", `gui/${uid}/${label}`]);
    }
  };
}

function currentUid(): string {
  const getuid = process.getuid;
  if (typeof getuid === "function") {
    return String(getuid.call(process));
  }
  return process.env.UID ?? "0";
}

function plistFilePath(label: string): string {
  return path.join(os.homedir(), "Library", "LaunchAgents", `${label}.plist`);
}

function renderPlist(service: DesiredService): string {
  const env = (service.spec.environment ?? {}) as Record<string, string>;
  const envEntries = Object.entries(env)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `<key>${escapeXml(key)}</key><string>${escapeXml(value)}</string>`)
    .join("");
  const args = ((service.spec.programArguments ?? []) as string[])
    .map((arg) => `<string>${escapeXml(arg)}</string>`)
    .join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${escapeXml(service.label)}</string>
  ${service.spec.program ? `<key>Program</key><string>${escapeXml(String(service.spec.program))}</string>` : ""}
  ${args ? `<key>ProgramArguments</key><array>${args}</array>` : ""}
  <key>RunAtLoad</key><${service.spec.runAtLoad ? "true" : "false"}/>
  <key>KeepAlive</key><${service.spec.keepAlive ? "true" : "false"}/>
  ${service.spec.workingDirectory ? `<key>WorkingDirectory</key><string>${escapeXml(String(service.spec.workingDirectory))}</string>` : ""}
  ${service.spec.standardOutPath ? `<key>StandardOutPath</key><string>${escapeXml(String(service.spec.standardOutPath))}</string>` : ""}
  ${service.spec.standardErrorPath ? `<key>StandardErrorPath</key><string>${escapeXml(String(service.spec.standardErrorPath))}</string>` : ""}
  <key>EnvironmentVariables</key>
  <dict>${envEntries}</dict>
</dict>
</plist>
`;
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
