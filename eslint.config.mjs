import { readdirSync } from "node:fs";
import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Module boundaries (SPEC/2026-10-27-refatoracao-arquitetural.md, section 6).
const modules = readdirSync(new URL("./src/modules", import.meta.url), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);
const moduleInternals = "@/modules/*/**";
const moduleBoundaryMessage =
  "Import other modules only through their public API: @/modules/<module>.";

// Deep imports that existed before SF-037. Removed as each module is migrated (SF-040, SF-043).
const transitionalDeepImports = [
  "!@/modules/auth/change-own-password",
  "!@/modules/auth/components",
  "!@/modules/auth/components/*",
];

const moduleBoundaries = modules.map((name) => {
  const otherModules = modules.filter((other) => other !== name).join("|");

  return {
    files: [`src/modules/${name}/**/*.{ts,tsx}`],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: [moduleInternals], message: moduleBoundaryMessage },
            {
              // Relative paths into another module, e.g. "../services/policy".
              regex: `^(\\.\\./)+(${otherModules})(/|$)`,
              message: moduleBoundaryMessage,
            },
          ],
        },
      ],
    },
  };
});

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  ...moduleBoundaries,
  {
    files: ["src/app/**/*.{ts,tsx}", "src/server/**/*.ts", "src/shared/**/*.ts", "scripts/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [moduleInternals, ...transitionalDeepImports],
              message: moduleBoundaryMessage,
            },
          ],
        },
      ],
    },
  },
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts"]),
]);
