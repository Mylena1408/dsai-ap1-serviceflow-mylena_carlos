import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDirectory = resolve(process.cwd(), "prisma", "migrations");

const migrations = readdirSync(migrationsDirectory, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => ({
    name: entry.name,
    sql: readFileSync(resolve(migrationsDirectory, entry.name, "migration.sql"), "utf8"),
  }));

describe("Prisma migrations", () => {
  it("do not seed sectors, services, or document requirements", () => {
    expect(migrations.length).toBeGreaterThan(0);

    for (const { name, sql } of migrations) {
      expect(sql, name).not.toMatch(/\b(INSERT\s+INTO|COPY)\b/i);
    }
  });

  it("keep the document requirements migration additive", () => {
    const migration = migrations.find(({ name }) =>
      name.endsWith("_document_requirements_and_attachments"),
    );

    expect(migration).toBeDefined();
    expect(migration?.sql).not.toMatch(/^\s*(DROP|TRUNCATE|DELETE\s+FROM|UPDATE)\b/im);
    expect(migration?.sql).not.toMatch(
      /ALTER\s+TABLE\s+"public"\."(Sector|Category|User|Service|Request|RequestStatusEvent)"/i,
    );
  });
});
