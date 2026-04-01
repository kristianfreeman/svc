import { loadDesiredState } from "../config/load.ts";

export interface ValidateCommandOptions {
  all?: boolean;
  namespace?: string[];
  cwd?: string;
}

export async function runValidateCommand(options: ValidateCommandOptions): Promise<{ namespaces: number; services: number }> {
  const state = await loadDesiredState({
    cwd: options.cwd,
    allNamespaces: options.all,
    selectedNamespaces: options.namespace
  });

  return {
    namespaces: state.namespaces.length,
    services: state.services.length
  };
}
