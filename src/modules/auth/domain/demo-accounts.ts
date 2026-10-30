// Demonstration mode (SPEC 2026-09-30, section 22): one reusable account per role.
export const DEMO_ROLES = ["ADMIN", "REQUESTER", "ATTENDANT"] as const;

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
};

export const DEMO_SECTOR_NAME = "Setor de demonstração";
