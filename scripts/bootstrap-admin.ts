import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { StringDecoder } from "node:string_decoder";
import { loadEnvConfig } from "@next/env";
import { PrismaClient } from "@prisma/client";
import { bootstrapFirstAdmin } from "../src/modules/auth/infrastructure/prisma-bootstrap-admin";
import {
  BootstrapInputError,
  formatBootstrapFailure,
} from "../src/modules/auth/application/bootstrap-admin-cli";
import { parseDatabaseUrl } from "../src/server/config";

async function readHiddenInput(prompt: string): Promise<string> {
  if (!stdin.isTTY || !stdout.isTTY || typeof stdin.setRawMode !== "function") {
    throw new BootstrapInputError("TERMINAL_REQUIRED");
  }

  stdout.write(prompt);
  stdin.setRawMode(true);
  stdin.resume();

  const decoder = new StringDecoder("utf8");
  let value = "";

  return new Promise((resolve, reject) => {
    const cleanup = () => {
      stdin.off("data", handleInput);
      stdin.setRawMode(false);
      stdout.write("\n");
    };

    const handleInput = (chunk: Buffer) => {
      for (const character of decoder.write(chunk)) {
        if (character === "\u0003") {
          cleanup();
          reject(new BootstrapInputError("CANCELLED"));
          return;
        }

        if (character === "\r" || character === "\n") {
          cleanup();
          resolve(value);
          return;
        }

        if (character === "\u007f" || character === "\b") {
          value = Array.from(value).slice(0, -1).join("");
          continue;
        }

        value += character;
      }
    };

    stdin.on("data", handleInput);
  });
}

async function main(): Promise<void> {
  loadEnvConfig(process.cwd());

  if (!process.env.DATABASE_URL) {
    throw new BootstrapInputError("DATABASE_URL_REQUIRED");
  }

  const databaseConfig = parseDatabaseUrl(process.env.DATABASE_URL);

  if (databaseConfig.database.toLowerCase().endsWith("_test")) {
    throw new BootstrapInputError("TEST_DATABASE");
  }

  if (!stdin.isTTY || !stdout.isTTY || typeof stdin.setRawMode !== "function") {
    throw new BootstrapInputError("TERMINAL_REQUIRED");
  }

  const database = new PrismaClient({
    datasourceUrl: databaseConfig.url,
    log: [],
  });

  try {
    const prompt = createInterface({ input: stdin, output: stdout });
    let name: string;
    let email: string;

    try {
      name = await prompt.question("Nome do administrador: ");
      email = await prompt.question("E-mail do administrador: ");
    } finally {
      prompt.close();
    }

    const password = await readHiddenInput("Senha (entrada oculta): ");
    const confirmation = await readHiddenInput("Confirme a senha (entrada oculta): ");

    if (password !== confirmation) {
      throw new BootstrapInputError("PASSWORD_MISMATCH");
    }

    await bootstrapFirstAdmin({ name, email, password }, database);
    stdout.write("Administrador inicial criado com sucesso.\n");
  } finally {
    await database.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(formatBootstrapFailure(error));
  process.exitCode = 1;
});
