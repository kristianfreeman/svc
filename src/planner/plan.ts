import { loadDesiredState, type LoadConfigOptions } from "../config/load.ts";
import { readManagedRecords } from "../state/store.ts";
import { buildDesiredServices } from "./desired.ts";
import type { ManagedRecord, PlanAction, PlanResult, RuntimeJobSnapshot } from "./types.ts";

export interface PlanOptions extends LoadConfigOptions {
  prune?: boolean;
  runtimeJobs?: RuntimeJobSnapshot[];
  currentRecords?: ManagedRecord[];
}

export async function buildPlan(options: PlanOptions = {}): Promise<PlanResult> {
  const desiredState = await loadDesiredState(options);
  const desiredServices = buildDesiredServices(desiredState);
  const currentRecords = options.currentRecords ?? (await readManagedRecords());
  const runtimeJobs = options.runtimeJobs ?? [];
  const runtimePresent = new Set(runtimeJobs.filter((job) => job.present).map((job) => job.label));

  const desiredByLabel = new Map(desiredServices.map((service) => [service.label, service]));
  const managedByLabel = new Map(
    currentRecords
      .filter((record) => record.managedBy === desiredState.root.managedBy)
      .map((record) => [record.label, record])
  );

  const actions: PlanAction[] = [];

  for (const desired of desiredServices) {
    const current = managedByLabel.get(desired.label);
    if (!current) {
      actions.push({
        action: "create",
        label: desired.label,
        namespace: desired.namespace,
        desiredHash: desired.hash,
        reason: "managed record missing"
      });
      continue;
    }

    if (current.hash !== desired.hash) {
      actions.push({
        action: "update",
        label: desired.label,
        namespace: desired.namespace,
        desiredHash: desired.hash,
        currentHash: current.hash,
        reason: "desired spec hash differs"
      });
      continue;
    }

    if (!runtimePresent.has(desired.label)) {
      actions.push({
        action: "restart",
        label: desired.label,
        namespace: desired.namespace,
        desiredHash: desired.hash,
        currentHash: current.hash,
        reason: "runtime job not loaded"
      });
      continue;
    }

    actions.push({
      action: "noop",
      label: desired.label,
      namespace: desired.namespace,
      desiredHash: desired.hash,
      currentHash: current.hash,
      reason: "in sync"
    });
  }

  if (options.prune) {
    const selectedNamespaceSet = options.selectedNamespaces?.length
      ? new Set(options.selectedNamespaces)
      : new Set(desiredState.namespaces.map((namespace) => namespace.namespace));

    for (const record of currentRecords) {
      if (record.managedBy !== desiredState.root.managedBy) {
        continue;
      }
      if (!selectedNamespaceSet.has(record.namespace)) {
        continue;
      }
      if (!desiredByLabel.has(record.label)) {
        actions.push({
          action: "delete",
          label: record.label,
          namespace: record.namespace,
          currentHash: record.hash,
          reason: "managed record is out of desired scope"
        });
      }
    }
  }

  const ordered = actions.sort((a, b) => {
    const actionOrder = orderOfAction(a.action) - orderOfAction(b.action);
    if (actionOrder !== 0) {
      return actionOrder;
    }
    return a.label.localeCompare(b.label);
  });

  return {
    actions: ordered,
    summary: {
      create: ordered.filter((action) => action.action === "create").length,
      update: ordered.filter((action) => action.action === "update").length,
      restart: ordered.filter((action) => action.action === "restart").length,
      delete: ordered.filter((action) => action.action === "delete").length,
      noop: ordered.filter((action) => action.action === "noop").length
    }
  };
}

function orderOfAction(action: PlanAction["action"]): number {
  switch (action) {
    case "create":
      return 0;
    case "update":
      return 1;
    case "restart":
      return 2;
    case "delete":
      return 3;
    case "noop":
      return 4;
    default:
      return 99;
  }
}
