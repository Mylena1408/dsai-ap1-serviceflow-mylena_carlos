export interface AuthenticatedUser {
  id: string;
  name: string;
  email: string;
  role: "ADMIN" | "REQUESTER" | "ATTENDANT" | "MANAGER";
  sectorId: string | null;
  isActive: true;
}

export async function getCurrentUser(): Promise<AuthenticatedUser | null> {
  // Loaded on use: the Auth.js composition (root auth.ts) reaches the modules, and modules reach
  // this file, so a static import would make a cycle and load Auth.js in scripts and tests
  // that never read a session (SPEC 2026-09-30, section 25.2).
  const { auth } = await import("../../../auth");
  const session = await auth();
  const user = session?.user;

  if (!user?.id || !user.name || !user.email || !user.isActive) {
    return null;
  }

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    sectorId: user.sectorId,
    isActive: true,
  };
}
