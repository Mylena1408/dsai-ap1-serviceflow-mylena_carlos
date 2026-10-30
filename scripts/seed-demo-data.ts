import { loadEnvConfig } from "@next/env";
import { PrismaClient } from "@prisma/client";
import { parseDatabaseUrl } from "../src/server/config";
import { seedDemoData } from "./demo-data";

async function main(): Promise<void> {
  loadEnvConfig(process.cwd());

  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL é obrigatória.");
  }

  const databaseConfig = parseDatabaseUrl(process.env.DATABASE_URL);

  if (databaseConfig.database.toLowerCase().endsWith("_test")) {
    throw new Error("Os dados de demonstração não podem usar banco de testes.");
  }

  const database = new PrismaClient({ datasourceUrl: databaseConfig.url, log: [] });

  try {
    const summary = await seedDemoData(database);
    console.log(
      [
        "Dados de demonstração prontos:",
        `- ${summary.categories} categorias e ${summary.services} serviços no Setor de demonstração`,
        `- ${summary.users} usuários (contas de demonstração e fictícios, sem senha utilizável)`,
        `- ${summary.requestsCreated} solicitações criadas nesta execução`,
        `- ${summary.requirementsCreated} documentos exigidos criados nesta execução`,
      ].join("\n"),
    );
  } finally {
    await database.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Falha ao carregar os dados de demonstração.");
  process.exitCode = 1;
});
