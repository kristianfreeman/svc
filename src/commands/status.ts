import { loadDesiredState } from "../config/load.ts";
import { createLaunchdAdapter, type LaunchdAdapter } from "../launchd/adapter.ts";
import { buildDesiredServices } from "../planner/desired.ts";
import { defaultStorePaths, readManagedRecords, type StorePaths } from "../state/store.ts";

export type SyncState = "in_sync" | "drifted" | "unmanaged";

export interface StatusCommandOptions {
  all?: boolean;
  namespace?: string[];
  unmanaged?: boolean;
  unmanagedPrefix?: string[];
  json?: boolean;
  cwd?: string;
}

export interface StatusRow {
  label: string;
  namespace: string;
  state: SyncState;
  reason: string;
}

interface StatusDeps {
  adapter: LaunchdAdapter;
  storePaths: StorePaths;
}

export async function runStatusCommand(
  options: StatusCommandOptions,
  deps: Partial<StatusDeps> = {}
): Promise<string> {
  const adapter = deps.adapter ?? createLaunchdAdapter();
  const storePaths = deps.storePaths ?? defaultStorePaths();

  const desiredState = await loadDesiredState({
    cwd: options.cwd,
    allNamespaces: options.all,
    selectedNamespaces: options.namespace
  });
  const desiredServices = buildDesiredServices(desiredState);
  const records = await readManagedRecords(storePaths);
  const runtimeLabels = new Set(await adapter.listRuntimeLabels());

  const desiredByLabel = new Map(desiredServices.map((service) => [service.label, service]));
  const managedRecords = records.filter((record) => record.managedBy === desiredState.root.managedBy);
  const recordByLabel = new Map(managedRecords.map((record) => [record.label, record]));

  const rows: StatusRow[] = desiredServices.map((desired) => {
    const current = recordByLabel.get(desired.label);
    if (!current) {
      return {
        label: desired.label,
        namespace: desired.namespace,
        state: "drifted",
        reason: "managed record missing"
      };
    }
    if (current.hash !== desired.hash) {
      return {
        label: desired.label,
        namespace: desired.namespace,
        state: "drifted",
        reason: "spec hash drift"
      };
    }
    if (!runtimeLabels.has(desired.label)) {
      return {
        label: desired.label,
        namespace: desired.namespace,
        state: "drifted",
        reason: "runtime job missing"
      };
    }
    return {
      label: desired.label,
      namespace: desired.namespace,
      state: "in_sync",
      reason: "desired, managed state, and runtime match"
    };
  });

  const unmanagedPrefixes = resolveUnmanagedPrefixes(options, desiredState.root.ownershipPrefixes, desiredServices);
  const unmanaged = options.unmanaged
    ? Array.from(runtimeLabels)
        .filter((label) => !desiredByLabel.has(label) && !recordByLabel.has(label))
        .filter((label) => includeLabelByPrefix(label, unmanagedPrefixes))
        .map((label) => ({
          label,
          namespace: "-",
          state: "unmanaged" as const,
          reason: "present in runtime but not managed by svc"
        }))
    : [];

  const allRows = [...rows, ...unmanaged].sort((a, b) => a.label.localeCompare(b.label));

  if (options.json) {
    return JSON.stringify(
      {
        summary: {
          in_sync: allRows.filter((row) => row.state === "in_sync").length,
          drifted: allRows.filter((row) => row.state === "drifted").length,
          unmanaged: allRows.filter((row) => row.state === "unmanaged").length
        },
        services: allRows
      },
      null,
      2
    );
  }

  const lines = allRows.map((row) => `${row.state.padEnd(9)} ${row.label} (${row.namespace}) - ${row.reason}`);
  return lines.join("\n");
}

function resolveUnmanagedPrefixes(
  options: StatusCommandOptions,
  configuredPrefixes: string[],
  desiredServices: Array<{ label: string }>
): string[] {
  if (options.unmanagedPrefix && options.unmanagedPrefix.length > 0) {
    return options.unmanagedPrefix;
  }
  if (configuredPrefixes.length > 0) {
    return configuredPrefixes;
  }
  return Array.from(new Set(desiredServices.map((service) => inferLabelPrefix(service.label)).filter(Boolean)));
}

function inferLabelPrefix(label: string): string {
  const parts = label.split(".").filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0]}.${parts[1]}.`;
  }
  return `${label}.`;
}

function includeLabelByPrefix(label: string, prefixes: string[]): boolean {
  if (prefixes.length === 0) {
    return false;
  }
  return prefixes.some((prefix) => label.startsWith(prefix));
}
