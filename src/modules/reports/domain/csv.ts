import { ValidationError } from "@/server/errors";
import {
  APPROVAL_LABELS,
  PRIORITY_LABELS,
  REQUEST_STATUS_LABELS,
  SLA_SITUATION_LABELS,
  requestShortCode,
  type ApprovalStateValue,
  type PriorityValue,
  type SlaSituationValue,
  type StatusValue,
} from "@/shared/requests";
import { zonedDateTimeOf } from "@/shared/time";
import { REPORT_TIME_ZONE, type ReportPeriod } from "./period";

// CSV export of the requests of the dashboard (SPEC 2026-11-02-painel-relatorios, 5.4). Only the
// minimal columns below exist here: no description, comments, notes, answers, documents, approval
// remarks or data about the requester can reach the file.

export const REPORT_CSV_MAX_ROWS = 10_000;

export const REPORT_CSV_COLUMNS = [
  "Código",
  "Serviço",
  "Categoria",
  "Setor",
  "Status",
  "Prioridade",
  "Aprovação",
  "Etapa atual",
  "Responsável",
  "Aberta em",
  "Concluída em",
  "Cancelada em",
  "Vencimento",
  "Situação do prazo",
  "Concluída no prazo",
] as const;

export interface ReportCsvRow {
  id: string;
  serviceName: string;
  categoryName: string;
  sectorName: string;
  status: StatusValue;
  priority: PriorityValue;
  /** Null when the service did not require approval. */
  approvalState: ApprovalStateValue | null;
  stageName: string | null;
  assigneeName: string | null;
  createdAt: Date;
  completedAt: Date | null;
  cancelledAt: Date | null;
  dueAt: Date | null;
  /** Computed at export time, like on the screens. */
  slaSituation: SlaSituationValue;
  completedLate: boolean | null;
}

const SEPARATOR = ";";
const LINE_END = "\r\n";
const BYTE_ORDER_MARK = "﻿";

/**
 * One field: a value a spreadsheet would read as a formula gets an apostrophe in front, and a
 * value with the separator, quotes or line breaks is quoted.
 */
export function csvField(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[;"\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

function dateTime(value: Date | null): string {
  return value ? zonedDateTimeOf(value, REPORT_TIME_ZONE) : "";
}

/** "Sim" or "Não" for completed requests with a due date; empty otherwise. */
function completedOnTime(row: ReportCsvRow): string {
  if (row.status !== "COMPLETED" || row.completedLate === null) {
    return "";
  }
  return row.completedLate ? "Não" : "Sim";
}

function csvLine(row: ReportCsvRow): string {
  return [
    requestShortCode(row.id),
    row.serviceName,
    row.categoryName,
    row.sectorName,
    REQUEST_STATUS_LABELS[row.status],
    PRIORITY_LABELS[row.priority],
    row.approvalState ? APPROVAL_LABELS[row.approvalState] : "",
    row.stageName ?? "",
    row.assigneeName ?? "",
    dateTime(row.createdAt),
    dateTime(row.completedAt),
    dateTime(row.cancelledAt),
    dateTime(row.dueAt),
    SLA_SITUATION_LABELS[row.slaSituation],
    completedOnTime(row),
  ]
    .map(csvField)
    .join(SEPARATOR);
}

/** Refuses an export above the row limit ("Escolha um período menor"). */
export function assertReportCsvSize(rowCount: number): void {
  if (rowCount > REPORT_CSV_MAX_ROWS) {
    throw new ValidationError([{ path: ["period"], code: "too_many_rows" }]);
  }
}

/** UTF-8 text with a byte order mark, `;` between fields and CRLF after each line. */
export function buildRequestsCsv(rows: readonly ReportCsvRow[]): string {
  assertReportCsvSize(rows.length);
  const lines = [REPORT_CSV_COLUMNS.map(csvField).join(SEPARATOR), ...rows.map(csvLine)];
  return BYTE_ORDER_MARK + lines.join(LINE_END) + LINE_END;
}

export function reportCsvFileName(period: Pick<ReportPeriod, "firstDay" | "lastDay">): string {
  return `serviceflow-solicitacoes-${period.firstDay}-a-${period.lastDay}.csv`;
}
