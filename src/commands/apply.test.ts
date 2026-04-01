import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { runApplyCommand } from "./apply.ts";

const validScenario = path.resolve(process.cwd(), "src/config/fixtures/scenarios/valid");

function makeAdapter(runtimePresent = false) {
  const calls: string[] = [];
  return {
    calls,
    adapter: {
      async getRuntimeJobs(labels: string[]) {
        calls.push(`runtime:${labels.join(",")}`);
        return labels.map((label) => ({ label, present: runtimePresent }));
      },
      async listRuntimeLabels() {
        return [];
      },
      async upsertService(service: { label: string }) {
        calls.push(`upsert:${service.label}`);
      },
      async deleteService(label: string) {
        calls.push(`delete:${label}`);
      },
      async restartService(label: string) {
        calls.push(`restart:${label}`);
      }
    }
  };
}

async function tempStatePath(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "svc-test-"));
  return path.join(dir, "state.json");
}

describe("runApplyCommand", () => {
  test("dry-run does not execute adapter mutations", async () => {
    const { adapter, calls } = makeAdapter();
    const result = await runApplyCommand(
      { all: true, dryRun: true, cwd: validScenario },
      {
        adapter,
        storePaths: { statePath: await tempStatePath() }
      }
    );

    expect(result.executed).toHaveLength(0);
    expect(calls.some((call) => call.startsWith("upsert:"))).toBe(false);
  });

  test("applies create and persists managed state", async () => {
    const { adapter, calls } = makeAdapter();
    const statePath = await tempStatePath();

    const result = await runApplyCommand(
      { all: true, cwd: validScenario },
      {
        adapter,
        storePaths: { statePath },
      }
    );

    expect(result.plan.summary.create).toBe(2);
    expect(calls.filter((call) => call.startsWith("upsert:")).length).toBe(2);

    const persisted = JSON.parse(await fs.readFile(statePath, "utf8")) as { records: Array<{ label: string }> };
    expect(persisted.records.map((record) => record.label)).toEqual(["com.example.app", "com.example.worker"]);
  });

  test("prune never deletes unmanaged records", async () => {
    const { adapter, calls } = makeAdapter();
    const statePath = await tempStatePath();

    await fs.writeFile(
      statePath,
      JSON.stringify(
        {
          version: 1,
          records: [
            {
              label: "com.example.legacy",
              namespace: "app",
              managedBy: "svc",
              hash: "old",
              lastAppliedAt: "2026-04-01T00:00:00.000Z"
            },
            {
              label: "com.example.unmanaged",
              namespace: "app",
              managedBy: "manual",
              hash: "manual",
              lastAppliedAt: "2026-04-01T00:00:00.000Z"
            }
          ]
        },
        null,
        2
      ),
      "utf8"
    );

    await runApplyCommand(
      { namespace: ["app"], prune: true, cwd: validScenario },
      {
        adapter,
        storePaths: { statePath }
      }
    );

    expect(calls.includes("delete:com.example.legacy")).toBe(true);
    expect(calls.includes("delete:com.example.unmanaged")).toBe(false);
  });

  test("prune respects selected namespace boundaries across multiple namespaces", async () => {
    const { adapter, calls } = makeAdapter();
    const statePath = await tempStatePath();

    await fs.writeFile(
      statePath,
      JSON.stringify(
        {
          version: 1,
          records: [
            {
              label: "com.example.legacy.app",
              namespace: "app",
              managedBy: "svc",
              hash: "old",
              lastAppliedAt: "2026-04-01T00:00:00.000Z"
            },
            {
              label: "com.example.legacy.workers",
              namespace: "workers",
              managedBy: "svc",
              hash: "old",
              lastAppliedAt: "2026-04-01T00:00:00.000Z"
            }
          ]
        },
        null,
        2
      ),
      "utf8"
    );

    await runApplyCommand(
      { namespace: ["app"], prune: true, cwd: validScenario },
      {
        adapter,
        storePaths: { statePath }
      }
    );

    expect(calls.includes("delete:com.example.legacy.app")).toBe(true);
    expect(calls.includes("delete:com.example.legacy.workers")).toBe(false);
  });

  test("adopts existing runtime jobs on create without upsert", async () => {
    const { adapter, calls } = makeAdapter(true);
    const statePath = await tempStatePath();

    const result = await runApplyCommand(
      { all: true, cwd: validScenario },
      {
        adapter,
        storePaths: { statePath }
      }
    );

    expect(result.plan.summary.create).toBe(2);
    expect(calls.filter((call) => call.startsWith("upsert:")).length).toBe(0);

    const persisted = JSON.parse(await fs.readFile(statePath, "utf8")) as { records: Array<{ label: string }> };
    expect(persisted.records.map((record) => record.label)).toEqual(["com.example.app", "com.example.worker"]);
  });
});
