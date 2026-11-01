"use client";

import { createContext, useContext, type ReactNode } from "react";

// Which page the catalog editors belong to, so their redirecting forms return to it: the
// administration ("services") or the sector page of a permission holder ("sector-services",
// SPEC 2026-11-01-permissoes-configuraveis, 5.3.1).
const AdminSectionContext = createContext("services");

export function AdminSectionProvider({ section, children }: { section: string; children: ReactNode }) {
  return <AdminSectionContext.Provider value={section}>{children}</AdminSectionContext.Provider>;
}

export function useAdminSection(): string {
  return useContext(AdminSectionContext);
}
