import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { parse, stringify } from "yaml";
import { loadRootConfig, loadNamespaceConfigs } from "../config/load.ts";
import { type ServiceConfig, namespaceConfigSchema, rootConfigSchema, schemaVersion } from "../config/model.ts";
import { SvcError } from "../errors.ts";

const execFileAsync = promisify(execFile);

export interface ImportCommandOptions {
  namespace: string;
  prefix?: string[];
  dryRun?: boolean;
  cwd?: string;
}

interface ImportDeps {
  homeDir: string;
  userName: string;
  readPlistJson: (filePath: string) => Promise<Record<string, unknown>>;
}

const defaultDeps: ImportDeps = {
  homeDir: os.homedir(),
  userName: os.userInfo().username,
  async readPlistJson(filePath) {
    const { stdout } = await execFileAsync("plutil", ["-convert", "json", "-o", "-", filePath]);
    return JSON.parse(stdout) as Record<string, unknown>;
  }
};

export async function runImportCommand(
  options: ImportCommandOptions,
  deps: Partial<ImportDeps> = {}
): Promise<string> {
  const cwd = options.cwd ?? process.cwd();
  const merged = { ...defaultDeps, ...deps };
  const launchAgentsDir = path.join(merged.homeDir, "Library", "LaunchAgents");
  const { configPath, namespaceDir } = await resolveConfigPaths(cwd);
  const namespacePath = path.join(namespaceDir, `${options.namespace}.yaml`);

  const prefixes = options.prefix ?? [];
  const labels = await discoverLabels(launchAgentsDir, prefixes, merged.readPlistJson);
  const services = labels
    .map((job) => mapJobToService(job, merged.userName))
    .sort((a, b) => a.label.localeCompare(b.label));

  const root = await loadRootConfig(configPath);
  const namespaces = await loadNamespaceConfigs(namespaceDir);
  const existing = namespaces.find((ns) => ns.namespace === options.namespace);

  const namespaceDocument = {
    schemaVersion,
    namespace: options.namespace,
    owner: existing?.owner ?? { team: "platform", contact: "platform@example.com" },
    services
  };
  namespaceConfigSchema.parse(namespaceDocument);

  const nextRoot = {
    ...root,
    ownershipPrefixes: Array.from(new Set([...(root.ownershipPrefixes ?? []), ...prefixes])).sort(),
    namespaces: {
      ...root.namespaces,
      [options.namespace]: {
        enabled: true
      }
    }
  };
  rootConfigSchema.parse(nextRoot);

  if (!options.dryRun) {
    await fs.mkdir(namespaceDir, { recursive: true });
    await fs.writeFile(namespacePath, stringify(namespaceDocument, { lineWidth: 0 }), "utf8");
    await fs.writeFile(configPath, stringify(nextRoot, { lineWidth: 0 }), "utf8");
  }

  return JSON.stringify(
    {
      dryRun: options.dryRun ?? false,
      namespace: options.namespace,
      labels: services.map((service) => service.label),
      wrote: options.dryRun
        ? []
        : [
            path.relative(cwd, configPath),
            path.relative(cwd, namespacePath)
          ]
    },
    null,
    2
  );
}

async function resolveConfigPaths(cwd: string): Promise<{ configPath: string; namespaceDir: string }> {
  const localConfig = path.join(cwd, "config.yaml");
  if (await pathExists(localConfig)) {
    return {
      configPath: localConfig,
      namespaceDir: path.join(cwd, "namespaces")
    };
  }

  const baseDir = path.join(os.homedir(), ".config", "svc");
  return {
    configPath: path.join(baseDir, "config.yaml"),
    namespaceDir: path.join(baseDir, "namespaces")
  };
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function discoverLabels(
  launchAgentsDir: string,
  prefixes: string[],
  readPlistJson: (filePath: string) => Promise<Record<string, unknown>>
): Promise<Array<Record<string, unknown>>> {
  const entries = await fs.readdir(launchAgentsDir).catch((error) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new SvcError(`LaunchAgents directory not found: ${launchAgentsDir}`);
    }
    throw error;
  });

  const files = entries.filter((entry) => entry.endsWith(".plist")).sort();
  const jobs: Array<Record<string, unknown>> = [];

  for (const file of files) {
    const filePath = path.join(launchAgentsDir, file);
    const job = await readPlistJson(filePath).catch(() => null);
    if (!job) {
      continue;
    }
    const label = typeof job.Label === "string" ? job.Label : "";
    if (!label) {
      continue;
    }
    if (prefixes.length > 0 && !prefixes.some((prefix) => label.startsWith(prefix))) {
      continue;
    }
    jobs.push(job);
  }

  return jobs;
}

function mapJobToService(job: Record<string, unknown>, userName: string): ServiceConfig {
  const label = String(job.Label ?? "");
  const program = typeof job.Program === "string" ? job.Program : undefined;
  const programArguments = Array.isArray(job.ProgramArguments)
    ? job.ProgramArguments.filter((value): value is string => typeof value === "string")
    : undefined;

  if (!program && (!programArguments || programArguments.length === 0)) {
    throw new SvcError(`Cannot import ${label}: missing Program and ProgramArguments`);
  }

  return {
    label,
    domain: "gui",
    user: userName,
    disabled: false,
    program,
    programArguments,
    environment: readStringMap(job.EnvironmentVariables),
    workingDirectory: readOptionalString(job.WorkingDirectory),
    runAtLoad: readOptionalBoolean(job.RunAtLoad),
    keepAlive: readKeepAlive(job.KeepAlive),
    standardOutPath: readOptionalString(job.StandardOutPath),
    standardErrorPath: readOptionalString(job.StandardErrorPath)
  };
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readOptionalBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function readKeepAlive(value: unknown): boolean | undefined {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "object" && value !== null) {
    return true;
  }
  return undefined;
}

function readStringMap(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object") {
    return {};
  }
  const record = value as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const [key, raw] of Object.entries(record)) {
    if (typeof raw === "string") {
      out[key] = raw;
    }
  }
  return out;
}
