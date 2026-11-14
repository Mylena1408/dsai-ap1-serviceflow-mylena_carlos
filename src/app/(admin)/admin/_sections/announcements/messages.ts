import {
  MAX_ANNOUNCEMENT_BODY_LENGTH,
  MAX_ANNOUNCEMENT_TITLE_LENGTH,
  MAX_LEAD_HOURS,
  MAX_MAINTENANCE_HOURS,
  MAX_NOTICE_DAYS,
  type AnnouncementConflictReason,
} from "@/modules/announcements";

// The messages of the section "Avisos" (SPEC 2026-11-09-comunicacao-e-calendarios, 3.3; SF-235): each refusal has its
// own, chosen by the field of a validation error or by the reason of a conflict.

const MESSAGES: Record<string, { text: string; error: boolean }> = {
  created: { text: "Aviso criado.", error: false },
  updated: { text: "Aviso alterado.", error: false },
  closed: { text: "Aviso encerrado. Ele sai da faixa agora e fica no histórico.", error: false },
  deleted: { text: "Aviso apagado.", error: false },
  "invalid-title": { text: `Dê um título de 1 a ${MAX_ANNOUNCEMENT_TITLE_LENGTH} caracteres.`, error: true },
  "invalid-body": { text: `Escreva um texto de 1 a ${MAX_ANNOUNCEMENT_BODY_LENGTH} caracteres.`, error: true },
  "invalid-level": { text: "Escolha o nível do aviso: informação ou atenção.", error: true },
  "invalid-role": { text: "Para o público \"um perfil\", escolha o perfil.", error: true },
  "invalid-sector": { text: "Para o público \"um setor\", escolha um setor ativo.", error: true },
  "invalid-start": { text: "Informe o início com data e hora.", error: true },
  "invalid-end": {
    text: `Confira o fim: precisa ter data e hora e vir depois do início; um aviso dura até ${MAX_NOTICE_DAYS} dias e uma manutenção até ${MAX_MAINTENANCE_HOURS} horas.`,
    error: true,
  },
  "invalid-lead": { text: `A antecedência da manutenção vai de 0 a ${MAX_LEAD_HOURS} horas.`, error: true },
  invalid: { text: "Confira os campos do aviso.", error: true },
  "ends-in-past": { text: "O fim precisa estar no futuro.", error: true },
  ended: { text: "Este aviso já terminou e não muda mais.", error: true },
  "not-scheduled": { text: "Só um aviso que ainda não começou pode ser apagado. Para tirá-lo da faixa, encerre-o.", error: true },
  "not-current": { text: "Só um aviso em andamento pode ser encerrado.", error: true },
  "start-moved": { text: "Este aviso já começou: o início não pode ir para depois de agora.", error: true },
  missing: { text: "O aviso não está mais disponível.", error: true },
};

const FIELD_CODES: Record<string, string> = {
  title: "invalid-title",
  body: "invalid-body",
  level: "invalid-level",
  audienceRole: "invalid-role",
  audienceSectorId: "invalid-sector",
  startsAt: "invalid-start",
  endsAt: "invalid-end",
  leadHours: "invalid-lead",
};

const REASON_CODES: Record<AnnouncementConflictReason, string> = {
  ends_in_past: "ends-in-past",
  ended: "ended",
  not_scheduled: "not-scheduled",
  not_current: "not-current",
  start_moved: "start-moved",
  not_dismissable: "missing",
};

/** The message code of a refusal: by the conflict's reason, by the field, or generic. */
export function announcementErrorCode(code: string, reason: AnnouncementConflictReason | null, path: string | null): string {
  if (reason) return REASON_CODES[reason];
  if (code === "VALIDATION_ERROR") return (path && FIELD_CODES[path]) || "invalid";
  return "missing";
}

export function announcementMessage(code: string | undefined): { text: string; error: boolean } | null {
  return code ? (MESSAGES[code] ?? null) : null;
}
