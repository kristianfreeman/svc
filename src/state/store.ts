import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import type { ManagedRecord } from "../planner/types.ts";

const stateSchema = z
  .object({
    version: z.literal(1),
    records: z.array(
      z
        .object({
          label: z.string(),
          namespace: z.string(),
          managedBy: z.string(),
          hash: z.string(),
          lastAppliedAt: z.string()
        })
        .strict()
    )
  })
  .strict();

export interface StorePaths {
  statePath: string;
}

export function defaultStorePaths(): StorePaths {
  return {
    statePath: path.join(os.homedir(), ".svc", "state.json")
  };
}

export async function readManagedRecords(paths = defaultStorePaths()): Promise<ManagedRecord[]> {
  const raw = await fs.readFile(paths.statePath, "utf8").catch((error) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  });

  if (!raw) {
    return [];
  }

  const parsed = stateSchema.parse(JSON.parse(raw));
  return parsed.records;
}

export async function writeManagedRecords(records: ManagedRecord[], paths = defaultStorePaths()): Promise<void> {
  const payload = JSON.stringify({ version: 1, records }, null, 2);
  await fs.mkdir(path.dirname(paths.statePath), { recursive: true });
  await fs.writeFile(paths.statePath, payload + "\n", "utf8");
}
