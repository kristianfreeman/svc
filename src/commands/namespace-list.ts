import { loadDesiredState } from "../config/load.ts";

export interface NamespaceListCommandOptions {
  json?: boolean;
  cwd?: string;
}

export async function runNamespaceListCommand(options: NamespaceListCommandOptions): Promise<string> {
  const state = await loadDesiredState({ cwd: options.cwd, allNamespaces: true, includeDisabled: true });
  const enabled = new Set(
    Object.entries(state.root.namespaces)
      .filter(([, config]) => config.enabled)
      .map(([namespace]) => namespace)
  );

  const rows = state.namespaces.map((namespace) => ({
    namespace: namespace.namespace,
    enabled: enabled.has(namespace.namespace),
    owner: namespace.owner
  }));

  if (options.json) {
    return JSON.stringify(rows, null, 2);
  }

  return rows
    .map((row) => `${row.enabled ? "enabled" : "disabled"} ${row.namespace} (${row.owner.team} / ${row.owner.contact})`)
    .join("\n");
}
