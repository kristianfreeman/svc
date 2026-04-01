import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { runImportCommand } from "./import.ts";

async function createFixtureProject(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "svc-import-test-"));
  await fs.mkdir(path.join(dir, "namespaces"), { recursive: true });
  await fs.writeFile(
    path.join(dir, "config.yaml"),
    `schemaVersion: "1"\nmanagedBy: svc\nownershipPrefixes: []\ndefaults:\n  domain: gui\nnamespaces: {}\n`,
    "utf8"
  );
  return dir;
}

describe("runImportCommand", () => {
  test("imports filtered launch agent labels into namespace file", async () => {
    const cwd = await createFixtureProject();
    const launchAgentsDir = path.join(cwd, "fake-home", "Library", "LaunchAgents");
    await fs.mkdir(launchAgentsDir, { recursive: true });
    await fs.writeFile(path.join(launchAgentsDir, "a.plist"), "plist", "utf8");
    await fs.writeFile(path.join(launchAgentsDir, "b.plist"), "plist", "utf8");

    const output = await runImportCommand(
      {
        cwd,
        namespace: "kristian",
        prefix: ["com.example."]
      },
      {
        homeDir: path.join(cwd, "fake-home"),
        userName: "kristian",
        async readPlistJson(filePath) {
          if (filePath.endsWith("a.plist")) {
            return {
              Label: "com.example.live-log-server",
              Program: "/usr/bin/env",
              ProgramArguments: ["/usr/bin/env", "true"],
              EnvironmentVariables: { PATH: "/usr/bin" },
              KeepAlive: { SuccessfulExit: false }
            };
          }
          return {
            Label: "com.apple.Finder",
            Program: "/usr/bin/open"
          };
        }
      }
    );

    const parsed = JSON.parse(output) as { labels: string[]; wrote: string[] };
    expect(parsed.labels).toEqual(["com.example.live-log-server"]);
    expect(parsed.wrote).toEqual(["config.yaml", "namespaces/kristian.yaml"]);

    const namespaceYaml = await fs.readFile(path.join(cwd, "namespaces/kristian.yaml"), "utf8");
    expect(namespaceYaml).toContain("namespace: kristian");
    expect(namespaceYaml).toContain("label: com.example.live-log-server");

    const rootYaml = await fs.readFile(path.join(cwd, "config.yaml"), "utf8");
    expect(rootYaml).toContain("com.example.");
    expect(rootYaml).toContain("kristian:");
  });

  test("dry-run does not write files", async () => {
    const cwd = await createFixtureProject();
    const launchAgentsDir = path.join(cwd, "fake-home", "Library", "LaunchAgents");
    await fs.mkdir(launchAgentsDir, { recursive: true });
    await fs.writeFile(path.join(launchAgentsDir, "a.plist"), "plist", "utf8");

    const output = await runImportCommand(
      {
        cwd,
        namespace: "kristian",
        prefix: ["com.example."],
        dryRun: true
      },
      {
        homeDir: path.join(cwd, "fake-home"),
        userName: "kristian",
        async readPlistJson() {
          return {
            Label: "com.example.live-log-server",
            Program: "/usr/bin/env",
            ProgramArguments: ["/usr/bin/env", "true"]
          };
        }
      }
    );

    const parsed = JSON.parse(output) as { dryRun: boolean; wrote: string[] };
    expect(parsed.dryRun).toBe(true);
    expect(parsed.wrote).toEqual([]);

    await expect(fs.stat(path.join(cwd, "namespaces/kristian.yaml"))).rejects.toBeTruthy();
  });
});
