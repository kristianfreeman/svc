import { z } from "zod";

export const schemaVersion = "1" as const;

export const rootConfigSchema = z
  .object({
    schemaVersion: z.literal(schemaVersion),
    managedBy: z.string().min(1).default("svc"),
    ownershipPrefixes: z.array(z.string().min(1)).default([]),
    defaults: z
      .object({
        domain: z.enum(["user", "gui"]).optional(),
        runAtLoad: z.boolean().optional(),
        keepAlive: z.boolean().optional(),
        workingDirectory: z.string().min(1).optional(),
        environment: z.record(z.string(), z.string()).optional()
      })
      .strict()
      .default({}),
    namespaces: z.record(
      z.string(),
      z
        .object({
          enabled: z.boolean().default(true)
        })
        .strict()
    )
  })
  .strict();

export const healthSchema = z
  .object({
    type: z.enum(["process", "http"]),
    intervalSeconds: z.number().int().positive().default(30),
    timeoutSeconds: z.number().int().positive().default(5),
    url: z.string().url().optional()
  })
  .strict();

export const serviceSchema = z
  .object({
    label: z.string().min(3),
    domain: z.enum(["user", "gui"]).optional(),
    user: z.string().min(1).optional(),
    disabled: z.boolean().default(false),
    program: z.string().min(1).optional(),
    programArguments: z.array(z.string().min(1)).min(1).optional(),
    environment: z.record(z.string(), z.string()).default({}),
    workingDirectory: z.string().min(1).optional(),
    runAtLoad: z.boolean().optional(),
    keepAlive: z.boolean().optional(),
    standardOutPath: z.string().min(1).optional(),
    standardErrorPath: z.string().min(1).optional(),
    health: healthSchema.optional()
  })
  .strict();

export const namespaceConfigSchema = z
  .object({
    schemaVersion: z.literal(schemaVersion),
    namespace: z.string().min(1),
    owner: z
      .object({
        team: z.string().min(1),
        contact: z.string().min(1)
      })
      .strict(),
    services: z.array(serviceSchema)
  })
  .strict();

export type RootConfig = z.infer<typeof rootConfigSchema>;
export type NamespaceConfig = z.infer<typeof namespaceConfigSchema>;
export type ServiceConfig = z.infer<typeof serviceSchema>;
