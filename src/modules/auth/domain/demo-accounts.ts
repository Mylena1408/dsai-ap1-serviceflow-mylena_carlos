// Demonstration mode (SPEC 2026-09-30, sections 22 and 25): each profile button enters as a
// fictitious person with complete data. The reserved .test domain never reaches a real mailbox.
export const DEMO_ROLES = ["ADMIN", "REQUESTER", "ATTENDANT", "MANAGER"] as const;

export type DemoRole = (typeof DEMO_ROLES)[number];

export interface DemoAccount {
  name: string;
  email: string;
}

export const DEMO_ACCOUNTS: Record<DemoRole, DemoAccount> = {
  ADMIN: { name: "Marina Alves", email: "marina.alves@exemplo.test" },
  REQUESTER: { name: "Ana Souza", email: "ana.souza@exemplo.test" },
  ATTENDANT: { name: "Diego Rocha", email: "diego.rocha@exemplo.test" },
  // SPEC 2026-11-01-aprovacoes, 5.1: manager of the demonstration sector.
  MANAGER: { name: "Paulo Ribeiro", email: "paulo.ribeiro@exemplo.test" },
};

export const DEMO_SECTOR_NAME = "Central de Serviços";

/**
 * Section 25.1: the generic accounts and the sector name used before 2026-11-02. Databases that
 * still have them get the accounts deactivated and the sector renamed.
 */
export const LEGACY_DEMO_EMAILS: readonly string[] = [
  "demo.administrador@serviceflow.demo",
  "demo.solicitante@serviceflow.demo",
  "demo.atendente@serviceflow.demo",
  "demo.gestor@serviceflow.demo",
];

export const LEGACY_DEMO_SECTOR_NAME = "Setor de demonstração";
