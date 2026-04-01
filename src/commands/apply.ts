import { loadDesiredState } from "../config/load.ts";
import { createLaunchdAdapter, type LaunchdAdapter } from "../launchd/adapter.ts";
import { buildDesiredServices } from "../planner/desired.ts";
import { buildPlan } from "../planner/plan.ts";
import type { ManagedRecord, PlanAction, PlanResult } from "../planner/types.ts";
import { defaultStorePaths, readManagedRecords, writeManagedRecords, type StorePaths } from "../state/store.ts";

export interface ApplyCommandOptions {
  all?: boolean;
  namespace?: string[];
  prune?: boolean;
  json?: boolean;
  dryRun?: boolean;
  cwd?: string;
}

interface ApplyDeps {
  adapter: LaunchdAdapter;
  storePaths: StorePaths;
}

export async function runApplyCommand(
  options: ApplyCommandOptions,
  deps: Partial<ApplyDeps> = {}
): Promise<{ output: string; plan: PlanResult; executed: PlanAction[] }> {
  const adapter = deps.adapter ?? createLaunchdAdapter();
  const storePaths = deps.storePaths ?? defaultStorePaths();

  const desiredState = await loadDesiredState({
    cwd: options.cwd,
    allNamespaces: options.all,
    selectedNamespaces: options.namespace
  });
  const desiredServices = buildDesiredServices(desiredState);

  const existingRecords = await readManagedRecords(storePaths);
  const runtimeJobs = await adapter.getRuntimeJobs(desiredServices.map((service) => service.label));
  const plan = await buildPlan({
    cwd: options.cwd,
    allNamespaces: options.all,
    selectedNamespaces: options.namespace,
    prune: options.prune,
    currentRecords: existingRecords,
    runtimeJobs
  });

  if (options.dryRun) {
    const output = options.json
      ? JSON.stringify({ dryRun: true, plan }, null, 2)
      : `Dry run: no changes applied\n${renderPlanText(plan)}`;
    return { output, plan, executed: [] };
  }

  const desiredByLabel = new Map(desiredServices.map((service) => [service.label, service]));
  const runtimeByLabel = new Map(runtimeJobs.map((job) => [job.label, job]));
  const executed: PlanAction[] = [];

  for (const action of plan.actions) {
    if (action.action === "noop") {
      continue;
    }
    if (action.action === "create" || action.action === "update") {
      const desired = desiredByLabel.get(action.label);
      if (desired) {
        const runtimePresent = runtimeByLabel.get(action.label)?.present ?? false;
        if (!(action.action === "create" && runtimePresent)) {
          await adapter.upsertService(desired);
        }
      }
    } else if (action.action === "restart") {
      await adapter.restartService(action.label);
    } else if (action.action === "delete") {
      await adapter.deleteService(action.label);
    }
    executed.push(action);
  }

  const updatedRecords = mergeManagedRecords(existingRecords, desiredServices, desiredState.root.managedBy);
  const finalRecords = options.prune
    ? updatedRecords.filter(
        (record) =>
          !plan.actions.some((action) => action.action === "delete" && action.label === record.label) ||
          record.managedBy !== desiredState.root.managedBy
      )
    : updatedRecords;
  await writeManagedRecords(finalRecords, storePaths);

  const output = options.json
    ? JSON.stringify({ dryRun: false, plan, executed }, null, 2)
    : `${renderPlanText(plan)}\nApplied ${executed.length} action(s)`;

  return { output, plan, executed };
}

function mergeManagedRecords(
  existing: ManagedRecord[],
  desiredServices: Array<{ label: string; namespace: string; managedBy: string; hash: string }>,
  managedBy: string
): ManagedRecord[] {
  const now = new Date().toISOString();
  const desiredByLabel = new Map(desiredServices.map((service) => [service.label, service]));
  const retained = existing.filter((record) => record.managedBy !== managedBy || desiredByLabel.has(record.label));

  const nextManaged = desiredServices.map((service) => ({
    label: service.label,
    namespace: service.namespace,
    managedBy: service.managedBy,
    hash: service.hash,
    lastAppliedAt: now
  }));

  return [...retained.filter((record) => record.managedBy !== managedBy), ...nextManaged].sort((a, b) =>
    a.label.localeCompare(b.label)
  );
}

function renderPlanText(plan: PlanResult): string {
  const lines = [
    `Plan summary: create=${plan.summary.create} update=${plan.summary.update} restart=${plan.summary.restart} delete=${plan.summary.delete} noop=${plan.summary.noop}`
  ];
  for (const action of plan.actions) {
    lines.push(`[${action.action}] ${action.label} (${action.namespace}) - ${action.reason}`);
  }
  return lines.join("\n");
}
