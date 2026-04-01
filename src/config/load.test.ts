import path from "node:path";
import { describe, expect, test } from "vitest";
import { loadDesiredState } from "./load.ts";

const fixturesDir = path.resolve(process.cwd(), "src/config/fixtures/scenarios");

function scenarioPath(name: string): string {
  return path.join(fixturesDir, name);
}

describe("loadDesiredState", () => {
  test("loads enabled namespaces by default", async () => {
    const state = await loadDesiredState({ cwd: scenarioPath("valid") });
    expect(state.namespaces.map((ns) => ns.namespace)).toEqual(["app"]);
    expect(state.services.map((service) => service.config.label)).toEqual(["com.example.app"]);
  });

  test("loads all namespaces when --all is enabled", async () => {
    const state = await loadDesiredState({ cwd: scenarioPath("valid"), allNamespaces: true });
    expect(state.namespaces.map((ns) => ns.namespace)).toEqual(["app", "workers"]);
    expect(state.services).toHaveLength(2);
  });

  test("rejects unknown keys", async () => {
    await expect(loadDesiredState({ cwd: scenarioPath("unknown-key") })).rejects.toThrow("Invalid root config");
  });

  test("rejects duplicate labels across namespaces", async () => {
    await expect(loadDesiredState({ cwd: scenarioPath("duplicate-label") })).rejects.toThrow(
      "Cross-namespace validation failed"
    );
  });

  test("rejects semantic violations", async () => {
    await expect(loadDesiredState({ cwd: scenarioPath("semantic-invalid") })).rejects.toThrow(
      "Semantic validation failed"
    );
  });

  test.each([
    ["unknown-key", "Invalid root config"],
    ["duplicate-label", "Cross-namespace validation failed"],
    ["invalid-health-url", "Invalid namespace config"],
    ["missing-program", "Semantic validation failed"]
  ])("invalid fixture matrix: %s", async (scenario, message) => {
    await expect(loadDesiredState({ cwd: scenarioPath(scenario) })).rejects.toThrow(message);
  });

  test("rejects root references to missing namespace files", async () => {
    await expect(loadDesiredState({ cwd: scenarioPath("missing-namespace") })).rejects.toThrow(
      "Cross-namespace validation failed"
    );
  });
});
