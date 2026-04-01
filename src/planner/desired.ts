import type { DesiredState } from "../config/load.ts";
import { stableHash } from "./hash.ts";
import type { DesiredService } from "./types.ts";

export function buildDesiredServices(state: DesiredState): DesiredService[] {
  const services = state.services.map(({ namespace, config }) => {
    const domain = config.domain ?? state.root.defaults.domain ?? "gui";
    const environment = {
      ...(state.root.defaults.environment ?? {}),
      ...config.environment,
      SVC_MANAGED_BY: state.root.managedBy,
      SVC_NAMESPACE: namespace,
      SVC_LABEL: config.label
    };

    const spec: Record<string, unknown> = {
      label: config.label,
      namespace,
      domain,
      user: config.user,
      program: config.program,
      programArguments: config.programArguments,
      runAtLoad: config.runAtLoad ?? state.root.defaults.runAtLoad ?? false,
      keepAlive: config.keepAlive ?? state.root.defaults.keepAlive ?? false,
      workingDirectory: config.workingDirectory ?? state.root.defaults.workingDirectory,
      standardOutPath: config.standardOutPath,
      standardErrorPath: config.standardErrorPath,
      environment,
      health: config.health
    };

    return {
      namespace,
      label: config.label,
      managedBy: state.root.managedBy,
      hash: stableHash(spec),
      spec
    } satisfies DesiredService;
  });

  return services.sort((a, b) => a.label.localeCompare(b.label));
}
