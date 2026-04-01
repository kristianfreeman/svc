import path from "node:path";
import { describe, expect, test } from "vitest";
import { loadDesiredState } from "../config/load.ts";
import { buildDesiredServices } from "./desired.ts";
import { buildPlan } from "./plan.ts";

const validScenario = path.resolve(process.cwd(), "src/config/fixtures/scenarios/valid");

async function firstDesired() {
  const desired = buildDesiredServices(await loadDesiredState({ cwd: validScenario }))[0];
  if (!desired) {
    throw new Error("fixture must include at least one desired service");
  }
  return desired;
}

describe("buildPlan", () => {
  test("emits create for missing managed records", async () => {
    const plan = await buildPlan({ cwd: validScenario });
    expect(plan.summary.create).toBe(1);
    expect(plan.actions[0]?.action).toBe("create");
    expect(plan.actions[0]?.label).toBe("com.example.app");
  });

  test("emits noop when hash matches and runtime is present", async () => {
    const desired = await firstDesired();
    const plan = await buildPlan({
      cwd: validScenario,
      currentRecords: [
        {
          label: desired.label,
          namespace: desired.namespace,
          managedBy: desired.managedBy,
          hash: desired.hash,
          lastAppliedAt: "2026-04-01T00:00:00.000Z"
        }
      ],
      runtimeJobs: [{ label: desired.label, present: true }]
    });

    expect(plan.summary.noop).toBe(1);
    expect(plan.actions[0]?.action).toBe("noop");
  });

  test("emits update for hash drift", async () => {
    const desired = await firstDesired();
    const plan = await buildPlan({
      cwd: validScenario,
      currentRecords: [
        {
          label: desired.label,
          namespace: desired.namespace,
          managedBy: desired.managedBy,
          hash: "legacy-hash",
          lastAppliedAt: "2026-04-01T00:00:00.000Z"
        }
      ],
      runtimeJobs: [{ label: desired.label, present: true }]
    });

    expect(plan.summary.update).toBe(1);
    expect(plan.actions[0]?.action).toBe("update");
  });

  test("emits restart when runtime job is missing", async () => {
    const desired = await firstDesired();
    const plan = await buildPlan({
      cwd: validScenario,
      currentRecords: [
        {
          label: desired.label,
          namespace: desired.namespace,
          managedBy: desired.managedBy,
          hash: desired.hash,
          lastAppliedAt: "2026-04-01T00:00:00.000Z"
        }
      ],
      runtimeJobs: []
    });

    expect(plan.summary.restart).toBe(1);
    expect(plan.actions[0]?.action).toBe("restart");
  });

  test("prune only deletes managed resources in selected scope", async () => {
    const desired = await firstDesired();
    const plan = await buildPlan({
      cwd: validScenario,
      prune: true,
      currentRecords: [
        {
          label: desired.label,
          namespace: desired.namespace,
          managedBy: desired.managedBy,
          hash: desired.hash,
          lastAppliedAt: "2026-04-01T00:00:00.000Z"
        },
        {
          label: "com.example.old",
          namespace: desired.namespace,
          managedBy: desired.managedBy,
          hash: "old",
          lastAppliedAt: "2026-04-01T00:00:00.000Z"
        },
        {
          label: "com.example.unmanaged",
          namespace: desired.namespace,
          managedBy: "manual",
          hash: "manual",
          lastAppliedAt: "2026-04-01T00:00:00.000Z"
        },
        {
          label: "com.example.other.namespace",
          namespace: "workers",
          managedBy: desired.managedBy,
          hash: "old",
          lastAppliedAt: "2026-04-01T00:00:00.000Z"
        }
      ],
      runtimeJobs: [{ label: desired.label, present: true }]
    });

    const deletes = plan.actions.filter((action) => action.action === "delete").map((action) => action.label);
    expect(deletes).toEqual(["com.example.old"]);
  });
});
