// Demonstration mode (SPEC 2026-09-30, section 22): one reusable account per role.
export const DEMO_ROLES = ["ADMIN", "REQUESTER", "ATTENDANT", "MANAGER"] as const;

export type DemoRole = (typeof DEMO_ROLES)[number];

export interface DemoAccount {
  name: string;
  email: string;
}

export const DEMO_ACCOUNTS: Record<DemoRole, DemoAccount> = {
  ADMIN: {
    name: "Administrador (demonstração)",
    email: "demo.administrador@serviceflow.demo",
  },
  REQUESTER: {
    name: "Solicitante (demonstração)",
    email: "demo.solicitante@serviceflow.demo",
  },
  ATTENDANT: {
    name: "Atendente (demonstração)",
    email: "demo.atendente@serviceflow.demo",
  },
  // SPEC 2026-11-01-aprovacoes, 5.1: manager of the demonstration sector.
  MANAGER: {
    name: "Gestor (demonstração)",
    email: "demo.gestor@serviceflow.demo",
  },
};

export const DEMO_SECTOR_NAME = "Setor de demonstração";
