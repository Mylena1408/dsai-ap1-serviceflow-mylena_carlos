import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
}));
const navigation = vi.hoisted(() => ({
  redirect: vi.fn((path: string): never => {
    throw new Error(`REDIRECT:${path}`);
  }),
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/server/auth", () => auth);
vi.mock("next/navigation", () => navigation);
vi.mock("next-auth/react", () => ({ signIn: vi.fn() }));
// The module entry point loads Argon2 and Prisma; the page only needs the buttons.
vi.mock("@/modules/auth", async () => ({
  DemoSignInButtons: (await import("@/modules/auth/ui/demo-sign-in-buttons")).DemoSignInButtons,
}));

import HomePage from "@/app/page";

describe("home page role routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // SPEC 2026-09-30, section 24 (CA-ENT-01): without a session the root is the entrance.
  it("shows the profile choice without e-mail or password when there is no session", async () => {
    auth.getCurrentUser.mockResolvedValue(null);

    const html = renderToStaticMarkup(await HomePage());

    expect(navigation.redirect).not.toHaveBeenCalled();
    expect(html).toContain("Escolha um perfil");
    for (const profile of ["Administrador", "Solicitante", "Atendente", "Gestor"]) {
      expect(html).toContain(`Entrar como ${profile}`);
    }
    expect(html).not.toMatch(/type="(password|email)"/);
    expect(html).not.toContain("Senha");
  });

  it.each([
    [
      {
        id: "admin-id",
        name: "Admin",
        email: "admin@example.test",
        role: "ADMIN",
        sectorId: null,
        isActive: true,
      },
      "/admin",
    ],
    [
      {
        id: "requester-id",
        name: "Requester",
        email: "requester@example.test",
        role: "REQUESTER",
        sectorId: null,
        isActive: true,
      },
      "/catalog",
    ],
    [
      {
        id: "attendant-id",
        name: "Attendant",
        email: "attendant@example.test",
        role: "ATTENDANT",
        sectorId: "sector-id",
        isActive: true,
      },
      "/queue",
    ],
  ] as const)("routes the current database-backed session to %s", async (user, path) => {
    auth.getCurrentUser.mockResolvedValue(user);

    await expect(HomePage()).rejects.toThrow(`REDIRECT:${path}`);
  });
});
