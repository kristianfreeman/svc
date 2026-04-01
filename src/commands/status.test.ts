import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { runStatusCommand } from "./status.ts";

const validScenario = path.resolve(process.cwd(), "src/config/fixtures/scenarios/valid/ops/launchd");

async function tempStatePath(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "svc-status-test-"));
  return path.join(dir, "state.json");
}

describe("runStatusCommand", () => {
  test("reports drifted when no managed state exists", async () => {
    const output = await runStatusCommand(
      { namespace: ["app"], cwd: validScenario, json: true },
      {
        adapter: {
          async getRuntimeJobs() {
            return [];
          },
          async listRuntimeLabels() {
            return [];
          },
          async upsertService() {},
          async deleteService() {},
          async restartService() {}
        },
        storePaths: { statePath: await tempStatePath() }
      }
    );

    const parsed = JSON.parse(output) as { summary: { drifted: number } };
    expect(parsed.summary.drifted).toBe(1);
  });

  test("does not report unmanaged labels unless requested", async () => {
    const output = await runStatusCommand(
      { namespace: ["app"], cwd: validScenario, json: true },
      {
        adapter: {
          async getRuntimeJobs() {
            return [];
          },
          async listRuntimeLabels() {
            return ["com.example.random"];
          },
          async upsertService() {},
          async deleteService() {},
          async restartService() {}
        },
        storePaths: { statePath: await tempStatePath() }
      }
    );

    const parsed = JSON.parse(output) as {
      summary: { unmanaged: number };
      services: Array<{ label: string; state: string }>;
    };
    expect(parsed.summary.unmanaged).toBe(0);
    expect(parsed.services.some((row) => row.label === "com.example.random" && row.state === "unmanaged")).toBe(false);
  });

  test("reports unmanaged runtime labels with inferred prefix when requested", async () => {
    const output = await runStatusCommand(
      { namespace: ["app"], cwd: validScenario, json: true, unmanaged: true },
      {
        adapter: {
          async getRuntimeJobs() {
            return [];
          },
          async listRuntimeLabels() {
            return ["com.example.random", "com.apple.Finder"];
          },
          async upsertService() {},
          async deleteService() {},
          async restartService() {}
        },
        storePaths: { statePath: await tempStatePath() }
      }
    );

    const parsed = JSON.parse(output) as {
      summary: { unmanaged: number };
      services: Array<{ label: string; state: string }>;
    };
    expect(parsed.summary.unmanaged).toBe(1);
    expect(parsed.services.some((row) => row.label === "com.example.random" && row.state === "unmanaged")).toBe(true);
    expect(parsed.services.some((row) => row.label === "com.apple.Finder" && row.state === "unmanaged")).toBe(false);
  });

  test("reports unmanaged runtime labels with explicit prefix", async () => {
    const output = await runStatusCommand(
      {
        namespace: ["app"],
        cwd: validScenario,
        json: true,
        unmanaged: true,
        unmanagedPrefix: ["com.apple."]
      },
      {
        adapter: {
          async getRuntimeJobs() {
            return [];
          },
          async listRuntimeLabels() {
            return ["com.example.random", "com.apple.Finder"];
          },
          async upsertService() {},
          async deleteService() {},
          async restartService() {}
        },
        storePaths: { statePath: await tempStatePath() }
      }
    );

    const parsed = JSON.parse(output) as {
      summary: { unmanaged: number };
      services: Array<{ label: string; state: string }>;
    };
    expect(parsed.summary.unmanaged).toBe(1);
    expect(parsed.services.some((row) => row.label === "com.apple.Finder" && row.state === "unmanaged")).toBe(true);
    expect(parsed.services.some((row) => row.label === "com.example.random" && row.state === "unmanaged")).toBe(false);
  });
});
