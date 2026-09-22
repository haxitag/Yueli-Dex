import { TEMPLATES } from "./node_modules/@haxitag/yueli-dex-templates-core/dist/index.js";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const __filename = fileURLToPath(import.meta.url);
console.log("__dirname:", __dirname);

const mockMod = await import("/Users/zhyr/work/Yueli-DEX/packages/playground/src/lib/mock-jev-provider.ts");
console.log("mock keys:", Object.keys(mockMod));

const t = TEMPLATES[0];
console.log("t.id:", t.id, "type:", typeof t.id);
console.log("t.meta.exampleInput type:", typeof t.meta.exampleInput);
console.log("t.meta.exampleInput:", JSON.stringify(t.meta.exampleInput).slice(0, 100));
console.log("t.choices[0].id:", t.choices[0].id);
