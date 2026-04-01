import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parse } from "yaml";
import { ZodError } from "zod";
import { SvcError } from "../errors.ts";
import {
  namespaceConfigSchema,
  rootConfigSchema,
  type NamespaceConfig,
  type RootConfig,
  type ServiceConfig
} from "./model.ts";

const MODERN_ROOT_PATH = "root.yaml";
const MODERN_NAMESPACE_DIR = "namespaces";
const LEGACY_ROOT_PATH = "ops/launchd/root.yaml";
const LEGACY_NAMESPACE_DIR = "ops/launchd/namespaces";
const GLOBAL_CONFIG_DIR = path.join(os.homedir(), ".config", "svc");

export interface DesiredState {
  root: RootConfig;
  namespaces: NamespaceConfig[];
  services: Array<{
    namespace: string;
    config: ServiceConfig;
  }>;
}

export interface LoadConfigOptions {
  cwd?: string;
  includeDisabled?: boolean;
  allNamespaces?: boolean;
  selectedNamespaces?: string[];
  rootConfigPath?: string;
  namespaceDir?: string;
}

export async function loadDesiredState(options: LoadConfigOptions = {}): Promise<DesiredState> {
  const cwd = options.cwd ?? process.cwd();
  const { rootPath, namespaceDir } = await resolveConfigPaths(options, cwd);

  const root = await loadRootConfig(rootPath);
  const allNamespaces = await loadNamespaceConfigs(namespaceDir);

  const filteredNamespaces = filterNamespaces(root, allNamespaces, options);
  validateCrossNamespace(filteredNamespaces, allNamespaces, root);

  const services = filteredNamespaces.flatMap((namespace) =>
    namespace.services
      .filter((service) => options.includeDisabled || !service.disabled)
      .map((config) => ({ namespace: namespace.namespace, config }))
  );

  return {
    root,
    namespaces: filteredNamespaces,
    services
  };
}

async function resolveConfigPaths(
  options: LoadConfigOptions,
  cwd: string
): Promise<{ rootPath: string; namespaceDir: string }> {
  if (options.rootConfigPath || options.namespaceDir) {
    return {
      rootPath: path.resolve(cwd, options.rootConfigPath ?? MODERN_ROOT_PATH),
      namespaceDir: path.resolve(cwd, options.namespaceDir ?? MODERN_NAMESPACE_DIR)
    };
  }

  const modernRoot = path.resolve(cwd, MODERN_ROOT_PATH);
  const modernNamespaces = path.resolve(cwd, MODERN_NAMESPACE_DIR);
  if (await pathExists(modernRoot)) {
    return { rootPath: modernRoot, namespaceDir: modernNamespaces };
  }

  const legacyRoot = path.resolve(cwd, LEGACY_ROOT_PATH);
  const legacyNamespaces = path.resolve(cwd, LEGACY_NAMESPACE_DIR);
  if (await pathExists(legacyRoot)) {
    return { rootPath: legacyRoot, namespaceDir: legacyNamespaces };
  }

  return {
    rootPath: path.join(GLOBAL_CONFIG_DIR, MODERN_ROOT_PATH),
    namespaceDir: path.join(GLOBAL_CONFIG_DIR, MODERN_NAMESPACE_DIR)
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

export async function loadRootConfig(rootPath: string): Promise<RootConfig> {
  const raw = await readYamlFile(rootPath, "root config");
  try {
    return rootConfigSchema.parse(raw);
  } catch (error) {
    throw zodAsSvcError(error, `Invalid root config at ${rootPath}`);
  }
}

export async function loadNamespaceConfigs(namespaceDir: string): Promise<NamespaceConfig[]> {
  const files = await fs.readdir(namespaceDir).catch((error) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new SvcError(`Namespace directory does not exist: ${namespaceDir}`);
    }
    throw error;
  });

  const yamlFiles = files.filter((name) => name.endsWith(".yaml") || name.endsWith(".yml")).sort();
  const namespaces: NamespaceConfig[] = [];

  for (const fileName of yamlFiles) {
    const filePath = path.join(namespaceDir, fileName);
    const raw = await readYamlFile(filePath, "namespace config");
    try {
      const parsed = namespaceConfigSchema.parse(raw);
      validateNamespaceSemantics(parsed, filePath);
      namespaces.push(parsed);
    } catch (error) {
      throw zodAsSvcError(error, `Invalid namespace config at ${filePath}`);
    }
  }

  return namespaces;
}

function filterNamespaces(
  root: RootConfig,
  namespaces: NamespaceConfig[],
  options: LoadConfigOptions
): NamespaceConfig[] {
  const requested = options.selectedNamespaces ?? [];
  const requestedSet = new Set(requested);
  const enabledByRoot = new Map<string, boolean>();

  for (const [namespace, value] of Object.entries(root.namespaces)) {
    enabledByRoot.set(namespace, value.enabled);
  }

  const missingRequested = requested.filter((name) => !namespaces.some((ns) => ns.namespace === name));
  if (missingRequested.length > 0) {
    throw new SvcError("Requested namespace files are missing", missingRequested);
  }

  return namespaces.filter((namespace) => {
    if (requestedSet.size > 0) {
      return requestedSet.has(namespace.namespace);
    }
    if (options.allNamespaces) {
      return true;
    }
    return enabledByRoot.get(namespace.namespace) ?? false;
  });
}

function validateNamespaceSemantics(namespace: NamespaceConfig, filePath: string): void {
  const details: string[] = [];
  const labels = new Set<string>();

  for (const service of namespace.services) {
    if (!service.program && !service.programArguments) {
      details.push(`${namespace.namespace}/${service.label}: either program or programArguments is required`);
    }

    if (service.programArguments?.length) {
      const firstArg = service.programArguments[0];
      if (!service.program && firstArg && !path.isAbsolute(firstArg)) {
        details.push(
          `${namespace.namespace}/${service.label}: first programArguments value must be an absolute path when program is omitted`
        );
      }
    }

    if (service.domain === "gui" && !service.user) {
      details.push(`${namespace.namespace}/${service.label}: user is required when domain is gui`);
    }

    for (const envKey of Object.keys(service.environment)) {
      if (!/^[A-Z_][A-Z0-9_]*$/.test(envKey)) {
        details.push(`${namespace.namespace}/${service.label}: invalid environment key ${envKey}`);
      }
    }

    if (service.health?.type === "http" && !service.health.url) {
      details.push(`${namespace.namespace}/${service.label}: health.url is required when health.type is http`);
    }

    if (labels.has(service.label)) {
      details.push(`${namespace.namespace}: duplicate label ${service.label}`);
    }
    labels.add(service.label);
  }

  if (details.length > 0) {
    throw new SvcError(`Semantic validation failed for ${filePath}`, details);
  }
}

function validateCrossNamespace(namespaces: NamespaceConfig[], allNamespaces: NamespaceConfig[], root: RootConfig): void {
  const labelOwners = new Map<string, string>();
  const details: string[] = [];

  for (const namespace of namespaces) {
    for (const service of namespace.services) {
      const prior = labelOwners.get(service.label);
      if (prior && prior !== namespace.namespace) {
        details.push(`label ${service.label} appears in both ${prior} and ${namespace.namespace}`);
      } else {
        labelOwners.set(service.label, namespace.namespace);
      }
    }
  }

  for (const namespaceName of Object.keys(root.namespaces)) {
    const hasFile = allNamespaces.some((namespace) => namespace.namespace === namespaceName);
    if (!hasFile) {
      details.push(`root references namespace ${namespaceName} but no matching namespace file exists`);
    }
  }

  if (details.length > 0) {
    throw new SvcError("Cross-namespace validation failed", details);
  }
}

async function readYamlFile(filePath: string, kind: string): Promise<unknown> {
  const raw = await fs.readFile(filePath, "utf8").catch((error) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new SvcError(`${kind} not found: ${filePath}`);
    }
    throw error;
  });
  try {
    return parse(raw, { uniqueKeys: true });
  } catch (error) {
    throw new SvcError(`Failed to parse YAML at ${filePath}: ${(error as Error).message}`);
  }
}

function zodAsSvcError(error: unknown, message: string): SvcError {
  if (error instanceof SvcError) {
    return error;
  }
  if (error instanceof ZodError) {
    const details = error.issues.map((issue) => {
      const location = issue.path.length > 0 ? issue.path.join(".") : "<root>";
      return `${location}: ${issue.message}`;
    });
    return new SvcError(message, details);
  }
  if (error instanceof Error) {
    return new SvcError(`${message}: ${error.message}`);
  }
  return new SvcError(message);
}
