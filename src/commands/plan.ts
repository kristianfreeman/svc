import { buildPlan } from "../planner/plan.ts";

export interface PlanCommandOptions {
  all?: boolean;
  namespace?: string[];
  prune?: boolean;
  json?: boolean;
  cwd?: string;
}

export async function runPlanCommand(options: PlanCommandOptions): Promise<string> {
  const plan = await buildPlan({
    cwd: options.cwd,
    allNamespaces: options.all,
    selectedNamespaces: options.namespace,
    prune: options.prune
  });

  if (options.json) {
    return JSON.stringify(plan, null, 2);
  }

  const lines = [
    `Plan summary: create=${plan.summary.create} update=${plan.summary.update} restart=${plan.summary.restart} delete=${plan.summary.delete} noop=${plan.summary.noop}`
  ];

  for (const action of plan.actions) {
    lines.push(`[${action.action}] ${action.label} (${action.namespace}) - ${action.reason}`);
  }

  return lines.join("\n");
}
