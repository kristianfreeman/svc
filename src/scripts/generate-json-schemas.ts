import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { namespaceConfigSchema, rootConfigSchema } from "../config/model.ts";

const rootSchema = {
  $id: "https://svc.dev/schemas/root.schema.json",
  description: "svc root launchd configuration schema",
  ...z.toJSONSchema(rootConfigSchema)
};

const namespaceSchema = {
  $id: "https://svc.dev/schemas/namespace.schema.json",
  description: "svc namespace launchd configuration schema",
  ...z.toJSONSchema(namespaceConfigSchema)
};

const schemasDir = path.resolve(process.cwd(), "schemas");

await fs.mkdir(schemasDir, { recursive: true });
await fs.writeFile(path.join(schemasDir, "root.schema.json"), JSON.stringify(rootSchema, null, 2) + "\n", "utf8");
await fs.writeFile(
  path.join(schemasDir, "namespace.schema.json"),
  JSON.stringify(namespaceSchema, null, 2) + "\n",
  "utf8"
);

console.log("Generated JSON schemas in schemas/");
