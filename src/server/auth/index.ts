import { auth } from "../../../auth";

export interface AuthenticatedUser {
  id: string;
  name: string;
  email: string;
  role: "ADMIN" | "REQUESTER" | "ATTENDANT" | "MANAGER";
  sectorId: string | null;
  isActive: true;
}

export async function getCurrentUser(): Promise<AuthenticatedUser | null> {
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
