export type PlanActionType = "create" | "update" | "restart" | "delete" | "noop";

export interface DesiredService {
  namespace: string;
  label: string;
  managedBy: string;
  hash: string;
  spec: Record<string, unknown>;
}

export interface ManagedRecord {
  label: string;
  namespace: string;
  managedBy: string;
  hash: string;
  lastAppliedAt: string;
}

export interface RuntimeJobSnapshot {
  label: string;
  present: boolean;
}

export interface PlanAction {
  action: PlanActionType;
  label: string;
  namespace: string;
  reason: string;
  desiredHash?: string;
  currentHash?: string;
}

export interface PlanResult {
  actions: PlanAction[];
  summary: {
    create: number;
    update: number;
    restart: number;
    delete: number;
    noop: number;
  };
}
