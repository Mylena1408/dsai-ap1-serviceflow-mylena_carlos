// Names of profiles and custom field types as people read them, shared by the administration
// forms (client components) and the audit section (SPEC 2026-11-02-auditoria-lgpd, 5.2).

export const ROLE_LABELS = {
  ADMIN: "Administrador",
  REQUESTER: "Solicitante",
  ATTENDANT: "Atendente",
  MANAGER: "Gestor",
} as const;

export const FIELD_TYPE_LABELS = {
  SHORT_TEXT: "Texto curto",
  LONG_TEXT: "Texto longo",
  INTEGER: "Número inteiro",
  DATE: "Data",
  SELECT: "Lista de opções",
  YES_NO: "Sim ou não",
} as const;
