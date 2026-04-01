import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const scenariosDir = path.resolve(process.cwd(), "src/config/fixtures/scenarios");
const cliPath = path.resolve(process.cwd(), "src/cli.ts");
const execFileAsync = promisify(execFile);

const validScenarios = ["valid"];
const invalidScenarios = [
  "unknown-key",
  "duplicate-label",
  "invalid-health-url",
  "missing-program",
  "missing-namespace"
];

for (const scenario of validScenarios) {
  await execFileAsync("npx", ["tsx", cliPath, "validate", "--all"], {
    cwd: path.join(scenariosDir, scenario, "ops/launchd")
  });
  console.log(`fixture ${scenario}: valid as expected`);
}

for (const scenario of invalidScenarios) {
  let failed = false;
  try {
    await execFileAsync("npx", ["tsx", cliPath, "validate", "--all"], {
      cwd: path.join(scenariosDir, scenario, "ops/launchd")
    });
  } catch {
    failed = true;
  }

  if (!failed) {
    throw new Error(`fixture ${scenario}: expected validation failure`);
  }
  console.log(`fixture ${scenario}: invalid as expected`);
}
