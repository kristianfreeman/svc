#!/usr/bin/env node
import { goke } from "goke";
import { z } from "zod";
import { createRequire } from "node:module";
import { runApplyCommand } from "./commands/apply.ts";
import { runDoctorCommand } from "./commands/doctor.ts";
import { runImportCommand } from "./commands/import.ts";
import { runLogsCommand } from "./commands/logs.ts";
import { runNamespaceListCommand } from "./commands/namespace-list.ts";
import { runPlanCommand } from "./commands/plan.ts";
import { runStatusCommand } from "./commands/status.ts";
import { runValidateCommand } from "./commands/validate.ts";
import { formatError } from "./errors.ts";

const require = createRequire(import.meta.url);
const packageJson = require("../package.json") as { version: string };

const cli = goke("svc");

cli
  .command(
    "validate",
    "Validate launchd declarative configuration for schema, semantics, and cross-namespace conflicts."
  )
  .option("--all", "Validate all namespace files regardless of enabled state")
  .option("--namespace <namespace>", z.array(z.string()).describe("Namespace to validate (repeatable)"))
  .action(async (options) => {
    const result = await runValidateCommand(options);
    console.log(`Validated ${result.namespaces} namespace(s), ${result.services} service(s)`);
  });

cli
  .command("plan", "Plan reconcile actions between desired config and launchd runtime")
  .option("--all", "Include disabled namespaces from root selection")
  .option("--namespace <namespace>", z.array(z.string()).describe("Namespace to plan (repeatable)"))
  .option("--prune", "Include managed delete actions for scoped resources")
  .option("--json", "Render plan as JSON")
  .action(async (options) => {
    const output = await runPlanCommand(options);
    console.log(output);
  });

cli
  .command("apply", "Apply reconcile actions with operator safety gates")
  .option("--all", "Include disabled namespaces from root selection")
  .option("--namespace <namespace>", z.array(z.string()).describe("Namespace to apply (repeatable)"))
  .option("--prune", "Delete managed resources in selected scope")
  .option("--json", "Render apply result as JSON")
  .option("--dry-run", "Render apply actions without mutating runtime")
  .action(async (options) => {
    const result = await runApplyCommand(options);
    console.log(result.output);
  });

cli
  .command("status", "Show managed and unmanaged status summary")
  .option("--all", "Include disabled namespaces from root selection")
  .option("--namespace <namespace>", z.array(z.string()).describe("Namespace to inspect (repeatable)"))
  .option("--unmanaged", "Include unmanaged runtime labels (scoped by ownership prefixes)")
  .option(
    "--unmanaged-prefix <prefix>",
    z.array(z.string()).describe("Prefix for unmanaged label discovery (repeatable, implies --unmanaged)")
  )
  .option("--json", "Render status output as JSON")
  .action(async (options) => {
    console.log(
      await runStatusCommand({
        ...options,
        unmanaged: options.unmanaged || (options.unmanagedPrefix?.length ?? 0) > 0
      })
    );
  });

cli
  .command("doctor", "Run diagnostics against configuration and runtime")
  .option("--all", "Include disabled namespaces from root selection")
  .option("--namespace <namespace>", z.array(z.string()).describe("Namespace to inspect (repeatable)"))
  .option("--json", "Render doctor output as JSON")
  .action(async (options) => {
    console.log(await runDoctorCommand(options));
  });

cli
  .command("logs <label>", "Show launchd related logs for a service label")
  .option("--follow", "Follow log output")
  .action(async (label, options) => {
    await runLogsCommand(label, options);
  });

cli
  .command("namespace list", "List discovered namespace files")
  .option("--json", "Render namespace list as JSON")
  .action(async (options) => {
    console.log(await runNamespaceListCommand(options));
  });

cli
  .command("namespace import <namespace>", "Import LaunchAgents into a namespace config")
  .option("--prefix <prefix>", z.array(z.string()).describe("Label prefix filter (repeatable)"))
  .option("--dry-run", "Preview import changes without writing files")
  .action(async (namespace, options) => {
    console.log(await runImportCommand({ namespace, ...options }));
  });

cli.help();
cli.version(packageJson.version);

try {
  cli.parse();
} catch (error) {
  console.error(formatError(error));
  process.exitCode = 1;
}
