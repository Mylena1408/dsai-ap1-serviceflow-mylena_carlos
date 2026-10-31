import type { RequestStatus } from "@/modules/requests";

export const REQUEST_STATUS_LABELS: Record<RequestStatus, string> = {
  OPEN: "Aberta",
  IN_PROGRESS: "Em atendimento",
  COMPLETED: "Concluída",
  CANCELLED: "Cancelada",
};
