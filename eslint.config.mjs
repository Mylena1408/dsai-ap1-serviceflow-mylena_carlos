import { readdirSync } from "node:fs";
import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Module and layer boundaries (SPEC/2026-10-27-refatoracao-arquitetural.md, sections 5 and 6).
const modules = readdirSync(new URL("./src/modules", import.meta.url), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);
const moduleInternals = "@/modules/*/**";
const moduleBoundaryMessage =
  "Import other modules only through their public API: @/modules/<module>.";

const persistence = ["@prisma/client", "@/server/db", "@/server/db/*"];
const frameworks = ["next", "next/*", "next-auth", "next-auth/*", "react", "react/*", "react-dom", "react-dom/*"];

// What each layer must not import, besides other modules' internals. Flat config replaces
// (does not merge) a rule configured twice for the same file, so every layer block below
// repeats the module boundary patterns.
const layerRestrictions = {
  domain: {
    group: [...persistence, ...frameworks],
    relative: ["application", "infrastructure", "ui"],
    message: "domain/ holds pure rules: no Prisma, database, Next.js, React or outer layers.",
  },
  application: {
    group: [...persistence, ...frameworks],
    relative: ["infrastructure", "ui"],
    message: "application/ must not depend on Prisma, the database, Next.js, React or outer layers.",
  },
  ui: {
    group: persistence,
    relative: ["infrastructure"],
    message: "ui/ must not access the database or repositories.",
  },
  infrastructure: { group: [], relative: [], message: "" },
};

function restrictedImports(moduleName, layer) {
  const otherModules = modules.filter((other) => other !== moduleName).join("|");
  const patterns = [
    { group: [moduleInternals], message: moduleBoundaryMessage },
    {
      // Relative paths into another module, e.g. "../services/policy".
      regex: `^(\\.\\./)+(${otherModules})(/|$)`,
      message: moduleBoundaryMessage,
    },
  ];
  const restriction = layer && layerRestrictions[layer];

  if (restriction?.group.length) {
    patterns.push({ group: restriction.group, message: restriction.message });
  }
  if (restriction?.relative.length) {
    patterns.push({
      regex: `^\\.\\./(${restriction.relative.join("|")})(/|$)`,
      message: restriction.message,
    });
  }

  return { "no-restricted-imports": ["error", { patterns }] };
}

const moduleBoundaries = modules.flatMap((name) => [
  // Composition files at the module root (index.ts).
  { files: [`src/modules/${name}/*.{ts,tsx}`], rules: restrictedImports(name) },
  ...Object.keys(layerRestrictions).map((layer) => ({
    files: [`src/modules/${name}/${layer}/**/*.{ts,tsx}`],
    rules: restrictedImports(name, layer),
  })),
]);

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  ...moduleBoundaries,
  {
    files: ["src/app/**/*.{ts,tsx}", "src/server/**/*.ts", "src/shared/**/*.ts", "scripts/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        { patterns: [{ group: [moduleInternals], message: moduleBoundaryMessage }] },
      ],
    },
  },
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts"]),
]);
