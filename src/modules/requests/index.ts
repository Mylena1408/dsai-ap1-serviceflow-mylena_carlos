import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/server/db";
import { getApplicationDocumentStorage, type DocumentStorage } from "@/server/storage";
import * as assignment from "./application/assignment";
import * as attachmentQueries from "./application/attachment-queries";
import * as createRequestUseCase from "./application/create-request";
import * as fieldAnswerQueries from "./application/field-answer-queries";
import * as lifecycleActions from "./application/lifecycle-actions";
import * as priorityUseCase from "./application/priority";
import * as queries from "./application/request-queries";
import * as slaAlerts from "./application/sla-alerts";
import * as approvalDeadlines from "./application/approval-deadline-alerts";
import * as stageDeadlines from "./application/stage-deadline-alerts";
import * as stageUseCase from "./application/stages";
import * as sectorTransfer from "./application/sector-transfer";
import * as lateDocument from "./application/late-document";
import * as slaPause from "./application/sla-pause";
import * as attendanceFields from "./application/attendance-fields";
import type { ActiveDocumentRequirement } from "./domain/attachment-requirements";
import * as approvalUseCase from "./application/approval";
import * as transitionUseCase from "./application/transition-request-status";
import type { AttachmentDownload, RequestAttachmentSummary } from "./domain/attachment";
import type { RequestFieldAnswer } from "./domain/field-answer";
import type { RequestWithHistory } from "./domain/request";
import { createPrismaFieldAnswerQueryRepository } from "./infrastructure/prisma-field-answer-repository";
import {
  createPrismaAttachmentQueryRepository,
  createPrismaRequestExistenceReader,
} from "./infrastructure/prisma-attachment-repository";
import * as orphanCleanup from "./application/orphan-cleanup";
import * as satisfaction from "./application/satisfaction";
import * as escalations from "./application/escalations";
import { createPrismaSatisfactionStore } from "./infrastructure/prisma-satisfaction";
import { createPrismaSlaAlertStore } from "./infrastructure/prisma-sla-alerts";
import { createPrismaApprovalDeadlineStore } from "./infrastructure/prisma-approval-deadline-alerts";
import { createPrismaStageDeadlineStore } from "./infrastructure/prisma-stage-deadline-alerts";
import * as ruleRuns from "./application/escalation-rule-runs";
import * as links from "./application/links";
import * as bundleOpening from "./application/open-bundle";
import * as groups from "./application/groups";
import * as absenceHandover from "./application/absence-handover";
import * as teamLoad from "./application/team-load";
import * as recurringRuns from "./application/recurring-runs";
import * as batch from "./application/batch";
import { createPrismaRecurringRunStore, findRequestScheduleName } from "./infrastructure/prisma-recurring-runs";
import { createPrismaTeamLoadReader } from "./infrastructure/prisma-team-load";
import { createPrismaAbsenceHandoverStore } from "./infrastructure/prisma-absence-handover";
import { createPrismaGroupReader } from "./infrastructure/prisma-request-groups";
import { createPrismaLinkReader, createPrismaLinkStore } from "./infrastructure/prisma-request-links";
import { createPrismaEscalationRuleRunStore } from "./infrastructure/prisma-escalation-rule-runs";
import {
  createPrismaRequestQueryRepository,
  createPrismaRequestTransaction,
  createPrismaRequestTransactionRunner,
} from "./infrastructure/prisma-request-repository";

export { buildAttachmentContentDisposition } from "./domain/attachment";
export type { AttachmentDownload, RequestAttachmentSummary } from "./domain/attachment";
export type { RequestFieldAnswer } from "./domain/field-answer";
export { effectiveAssigneeId, REOPEN_WINDOW_MS } from "./domain/lifecycle";
export { pendingApprovalLevel, pendingApprovalSector, requestApprovalSectors } from "./domain/approval";
export { sectorSubstituteIds } from "./infrastructure/approval-coverage";
export {
  MAX_SEARCH_TERM,
  MIN_SEARCH_TERM,
  SEARCH_PAGE_SIZE,
} from "./domain/search-criteria";
export type { AssigneeFilter, SearchCriteria, SearchOrder, SlaFilter } from "./domain/search-criteria";
export { completedLateAt, dueAtFrom, slaSituation } from "./domain/sla";
export type { SlaSituation } from "./domain/sla";
export type { RequestSearchResult } from "./application/request-queries";
export { buildRequestSnapshot } from "./domain/snapshot";
export { assertRequestStatusTransition } from "./domain/status-transition";
export type {
  RequestPriority,
  RequestStatus,
  RequestSummary,
  RequestWithHistory,
} from "./domain/request";

export type CreatedRequest = RequestWithHistory;
export type RequestWithHistoryForRequester = RequestWithHistory;

export async function createRequest(
  input: unknown,
  database: PrismaClient = prisma,
  storage: DocumentStorage = getApplicationDocumentStorage(),
): Promise<CreatedRequest> {
  return createRequestUseCase.createRequest(
    input,
    createPrismaRequestTransactionRunner(database, {
      translate: ["P2003", "P2025"],
      fallbackMessage: "Request creation failed.",
    }),
    storage,
  );
}

export async function listRequestAttachments(
  requestId: unknown,
  database: PrismaClient = prisma,
): Promise<RequestAttachmentSummary[]> {
  return attachmentQueries.listRequestAttachments(
    requestId,
    createPrismaAttachmentQueryRepository(database),
  );
}

export async function listRequestFieldAnswers(
  requestId: unknown,
  database: PrismaClient = prisma,
): Promise<RequestFieldAnswer[]> {
  return fieldAnswerQueries.listRequestFieldAnswers(requestId, createPrismaFieldAnswerQueryRepository(database));
}

export async function getAttachmentDownload(
  requestId: unknown,
  attachmentId: unknown,
  database: PrismaClient = prisma,
  storage: DocumentStorage = getApplicationDocumentStorage(),
): Promise<AttachmentDownload> {
  return attachmentQueries.getAttachmentDownload(
    requestId,
    attachmentId,
    createPrismaAttachmentQueryRepository(database),
    storage,
  );
}

export async function listRequesterRequests(
  database: PrismaClient = prisma,
): Promise<RequestWithHistoryForRequester[]> {
  return queries.listRequesterRequests(createPrismaRequestQueryRepository(database));
}

// Manager area (SPEC 2026-11-01-aprovacoes, 5.7).
export async function listManagerApprovals(
  filter: unknown,
  database: PrismaClient = prisma,
): Promise<RequestWithHistory[]> {
  return queries.listManagerApprovals(filter, createPrismaRequestQueryRepository(database));
}

/** SPEC 2026-11-06-aprofundamento-configurabilidade, 5.3.4. */
export async function listQueueStageChoices(database: PrismaClient = prisma): Promise<string[]> {
  return queries.listQueueStageChoices(createPrismaRequestQueryRepository(database));
}
export { NO_STAGE_FILTER } from "./domain/search-criteria";

/** SPEC 2026-11-06-aprofundamento-configurabilidade, 4.3.3 to 4.3.6. */
export async function getApprovalLevels(request: Parameters<typeof queries.getApprovalLevels>[0], database: PrismaClient = prisma) {
  return queries.getApprovalLevels(request, createPrismaRequestQueryRepository(database));
}
export { approvalLevelText } from "./domain/approval-levels-view";
export type { ApprovalLevelLine, ApprovalLevelsView } from "./domain/approval-levels-view";

/** SPEC 2026-11-06-aprofundamento-configurabilidade, 4.3.5. */
export async function getApprovalActingSectors(database: PrismaClient = prisma): Promise<string[]> {
  return queries.getApprovalActingSectors(createPrismaRequestQueryRepository(database));
}

export async function getManagerRequest(requestId: unknown, database: PrismaClient = prisma): Promise<RequestWithHistory> {
  return queries.getManagerRequest(requestId, createPrismaRequestQueryRepository(database));
}

export async function getRequesterRequest(
  requestId: unknown,
  database: PrismaClient = prisma,
): Promise<RequestWithHistoryForRequester> {
  return queries.getRequesterRequest(requestId, createPrismaRequestQueryRepository(database));
}

export async function listAttendantQueue(
  database: PrismaClient = prisma,
): Promise<RequestWithHistory[]> {
  return queries.listAttendantQueue(createPrismaRequestQueryRepository(database));
}

export async function getAttendantRequest(
  requestId: unknown,
  database: PrismaClient = prisma,
): Promise<RequestWithHistory> {
  return queries.getAttendantRequest(requestId, createPrismaRequestQueryRepository(database));
}

export async function transitionRequestStatus(
  input: unknown,
  database: PrismaClient = prisma,
): Promise<RequestWithHistory> {
  return transitionUseCase.transitionRequestStatus(
    input,
    createPrismaRequestTransactionRunner(database, {
      translate: ["P2034"],
      fallbackMessage: "Request transition failed.",
    }),
  );
}

const assignmentErrors = {
  translate: ["P2003", "P2034"] as const,
  fallbackMessage: "Request assignment failed.",
};

export async function assumeRequest(input: unknown, database: PrismaClient = prisma): Promise<void> {
  return assignment.assumeRequest(input, createPrismaRequestTransactionRunner(database, assignmentErrors));
}

export async function releaseRequest(input: unknown, database: PrismaClient = prisma): Promise<void> {
  return assignment.releaseRequest(input, createPrismaRequestTransactionRunner(database, assignmentErrors));
}

export async function transferRequest(input: unknown, database: PrismaClient = prisma): Promise<void> {
  return assignment.transferRequest(input, createPrismaRequestTransactionRunner(database, assignmentErrors));
}

export async function listTransferCandidates(
  requestId: unknown,
  database: PrismaClient = prisma,
): Promise<Array<{ id: string; name: string }>> {
  return queries.listTransferCandidates(requestId, createPrismaRequestQueryRepository(database));
}

/** SPEC 2026-11-03-anexos-comentarios-documentos, 5.3. */
export async function addLateDocument(
  input: unknown,
  database: PrismaClient = prisma,
  storage: DocumentStorage = getApplicationDocumentStorage(),
): Promise<void> {
  return lateDocument.addLateDocument(
    input,
    createPrismaRequestTransactionRunner(database, { translate: ["P2002", "P2003", "P2034"], fallbackMessage: "Document upload failed." }),
    storage,
  );
}

export async function listMissingDocuments(
  requestId: unknown,
  database: PrismaClient = prisma,
): Promise<ActiveDocumentRequirement[]> {
  return lateDocument.listMissingDocuments(requestId, createPrismaAttachmentQueryRepository(database));
}

/** SPEC 2026-11-03-transferencia-entre-setores, 5.3. */
export async function sendRequestToSector(input: unknown, database: PrismaClient = prisma): Promise<void> {
  return sectorTransfer.sendRequestToSector(input, createPrismaRequestTransactionRunner(database, assignmentErrors));
}

/** SPEC 2026-11-03-transferencia-entre-setores, 5.2. */
export async function listSectorDestinations(
  requestId: unknown,
  database: PrismaClient = prisma,
): Promise<Array<{ id: string; name: string }>> {
  return sectorTransfer.listSectorDestinations(requestId, createPrismaRequestQueryRepository(database));
}

const lifecycleErrors = {
  translate: ["P2034"] as const,
  fallbackMessage: "Request lifecycle change failed.",
};

export async function cancelRequest(input: unknown, database: PrismaClient = prisma): Promise<void> {
  return lifecycleActions.cancelRequest(input, createPrismaRequestTransactionRunner(database, lifecycleErrors));
}

export async function reopenRequest(input: unknown, database: PrismaClient = prisma): Promise<void> {
  return lifecycleActions.reopenRequest(input, createPrismaRequestTransactionRunner(database, lifecycleErrors));
}

export async function searchRequesterRequests(
  rawParams: unknown,
  database: PrismaClient = prisma,
): Promise<queries.RequestSearchResult> {
  return queries.searchRequesterRequests(rawParams, createPrismaRequestQueryRepository(database));
}

export async function searchAttendantQueue(
  rawParams: unknown,
  database: PrismaClient = prisma,
): Promise<queries.RequestSearchResult> {
  return queries.searchAttendantQueue(rawParams, createPrismaRequestQueryRepository(database));
}

export type { OrphanCleanupSummary } from "./application/orphan-cleanup";

/** Removes attachment objects whose request never committed (daily job, SPEC 21.15.5). */
export async function cleanOrphanAttachmentObjects(
  now: Date,
  storage: DocumentStorage = getApplicationDocumentStorage(),
  database: PrismaClient = prisma,
): Promise<orphanCleanup.OrphanCleanupSummary> {
  return orphanCleanup.cleanOrphanAttachmentObjects(storage, createPrismaRequestExistenceReader(database), now);
}

export type { SlaAlertSummary } from "./application/sla-alerts";
export type { ApprovalDeadlineSummary } from "./application/approval-deadline-alerts";
export type { StageDeadlineSummary } from "./application/stage-deadline-alerts";
export type { EscalationRuleSummary } from "./application/escalation-rule-runs";

/** Daily job step: applies the sectors' escalation rules (SPEC 2026-11-06-aprofundamento-configurabilidade, 7.3). */
export async function applyEscalationRules(now: Date, database: PrismaClient = prisma): Promise<ruleRuns.EscalationRuleSummary> {
  return ruleRuns.applyEscalationRules(now, createPrismaEscalationRuleRunStore(database));
}

/** Daily job step: announces the late stages (SPEC 2026-11-06-aprofundamento-configurabilidade, 5.3.2). */
export async function recordStageDeadlineAlerts(now: Date, database: PrismaClient = prisma): Promise<stageDeadlines.StageDeadlineSummary> {
  return stageDeadlines.recordStageDeadlineAlerts(now, createPrismaStageDeadlineStore(database));
}
export { approvalOverdue } from "./domain/approval";

/** Daily job step: announces the late approval levels (SPEC 2026-11-06-aprofundamento-configurabilidade, 4.3.6). */
export async function recordApprovalDeadlineAlerts(
  now: Date,
  database: PrismaClient = prisma,
): Promise<approvalDeadlines.ApprovalDeadlineSummary> {
  return approvalDeadlines.recordApprovalDeadlineAlerts(now, createPrismaApprovalDeadlineStore(database));
}

/** Daily job step: records the SLA alerts owed at `now` (SPEC 2026-11-01, section 5.5). */
export async function recordSlaAlerts(now: Date, database: PrismaClient = prisma): Promise<slaAlerts.SlaAlertSummary> {
  return slaAlerts.recordSlaAlerts(now, createPrismaSlaAlertStore(database));
}

// Manager decision on a pending approval (SPEC 2026-11-01-aprovacoes, 5.4).
export async function decideApproval(input: unknown, database: PrismaClient = prisma): Promise<void> {
  return approvalUseCase.decideApproval(input, createPrismaRequestTransactionRunner(database, lifecycleErrors));
}

// Advance or return one stage of the flow (SPEC 2026-11-01-fluxos-configuraveis, 5.3).
export async function moveRequestStage(input: unknown, database: PrismaClient = prisma): Promise<void> {
  return stageUseCase.moveRequestStage(input, createPrismaRequestTransactionRunner(database, lifecycleErrors));
}

export async function changeRequestPriority(input: unknown, database: PrismaClient = prisma): Promise<void> {
  return priorityUseCase.changeRequestPriority(
    input,
    createPrismaRequestTransactionRunner(database, lifecycleErrors),
  );
}

// SLA pause "aguardando o solicitante" (SPEC 2026-11-03-pausa-sla-calendario, 5.3 and 5.4).
export async function pauseRequestSla(input: unknown, database: PrismaClient = prisma): Promise<void> {
  return slaPause.pauseRequestSla(input, createPrismaRequestTransactionRunner(database, lifecycleErrors));
}

export async function resumeRequestSla(input: unknown, database: PrismaClient = prisma): Promise<void> {
  return slaPause.resumeRequestSla(input, createPrismaRequestTransactionRunner(database, lifecycleErrors));
}

/** For the comments module: resumes a paused SLA inside its own transaction (5.4.2). */
export async function resumeSlaOnRequesterReply(
  transaction: Prisma.TransactionClient,
  requestId: string,
  authorId: string,
): Promise<void> {
  await slaPause.resumeOnRequesterReply(createPrismaRequestTransaction(transaction), requestId, authorId);
}

// Fields filled by the attendance (SPEC 2026-11-03-campos-condicionais-atendimento, 5.5).
export { AttendanceFieldsMissingError } from "./application/attendance-fields";
export type { AttendanceFieldsView } from "./application/attendance-fields";

export async function saveAttendanceFields(input: unknown, database: PrismaClient = prisma): Promise<{ changed: string[] }> {
  return attendanceFields.saveAttendanceFields(input, createPrismaRequestTransactionRunner(database, lifecycleErrors));
}

export async function getAttendanceFields(
  requestId: unknown,
  database: PrismaClient = prisma,
): Promise<attendanceFields.AttendanceFieldsView> {
  return attendanceFields.getAttendanceFields(requestId, createPrismaRequestTransactionRunner(database, lifecycleErrors));
}

// Satisfaction survey (SPEC 2026-11-06-pesquisa-satisfacao).
export {
  MAX_SATISFACTION_COMMENT_LENGTH,
  SATISFACTION_RATINGS,
  SATISFACTION_WINDOW_MS,
} from "./domain/satisfaction";
export type { SatisfactionAvailability } from "./domain/satisfaction";
export type { RequestSatisfactionView, SatisfactionHistoryEntry, SatisfactionRecord } from "./application/satisfaction";

/** The owner rates a completed request (section 4). */
export async function rateRequest(input: unknown, database: PrismaClient = prisma): Promise<void> {
  return satisfaction.rateRequest(input, createPrismaSatisfactionStore(database));
}

/** The rating of a request, for whoever reads the request (section 4.6). */
export async function getRequestSatisfaction(
  requestId: unknown,
  database: PrismaClient = prisma,
  now: Date = new Date(),
): Promise<satisfaction.RequestSatisfactionView> {
  return satisfaction.getRequestSatisfaction(
    requestId,
    createPrismaAttachmentQueryRepository(database),
    createPrismaSatisfactionStore(database),
    now,
  );
}

// Automatic escalation of overdue requests (SPEC 2026-11-06-escalonamento).
export { escalatedPriority } from "./domain/escalation";
export type { RequestEscalationRecord } from "./application/escalations";

/** Escalations of a request, for the sector's team and a reading manager (section 4.7). */
export async function listRequestEscalations(
  requestId: unknown,
  database: PrismaClient = prisma,
): Promise<escalations.RequestEscalationRecord[]> {
  return escalations.listRequestEscalations(requestId, createPrismaAttachmentQueryRepository(database), {
    listForRequest: (id) =>
      database.requestEscalation.findMany({
        where: { requestId: id },
        // The option and the rules of one run share the instant: the option first, then by trigger
        // (enum order), so the block reads the same every time.
        orderBy: [{ occurredAt: "asc" }, { trigger: "asc" }, { overdueDays: "asc" }, { id: "asc" }],
        // The trigger and the rule's actions (SPEC 2026-11-06-aprofundamento-configurabilidade, 7.3 item 5).
        select: {
          id: true,
          fromPriority: true,
          toPriority: true,
          occurredAt: true,
          trigger: true,
          overdueDays: true,
          ruleName: true,
          assignmentSkipped: true,
          notifiedUserIds: true,
          assignedTo: { select: { id: true, name: true } },
        },
      }).then((rows) => rows.map(({ notifiedUserIds, ...row }) => ({ ...row, notifiedCount: notifiedUserIds.length }))),
  });
}

// Links between requests (SPEC 2026-11-07-operacao-e-automacao, 3.3 item 1).
export { LINK_KINDS, LINK_ROLE_LABELS, MAX_LINKS_PER_REQUEST, type LinkKind, type LinkRole } from "./domain/links";
export type { RequestLinkEventView, RequestLinkView } from "./application/links";

export async function linkRequests(input: unknown, database: PrismaClient = prisma): Promise<{ linkId: string }> {
  return links.linkRequests(input, createPrismaLinkStore(database));
}

export async function unlinkRequests(input: unknown, database: PrismaClient = prisma): Promise<void> {
  return links.unlinkRequests(input, createPrismaLinkStore(database));
}

/** Links and their history, for whoever reads the request. */
export async function listRequestLinks(requestId: unknown, database: PrismaClient = prisma) {
  return links.listRequestLinks(requestId, createPrismaAttachmentQueryRepository(database), createPrismaLinkReader(database));
}

// Opening a bundle (SPEC 2026-11-07-operacao-e-automacao, 3.3 item 3).
export type { BundleOpening } from "./application/open-bundle";

export async function openBundle(input: unknown, database: PrismaClient = prisma): Promise<bundleOpening.BundleOpening> {
  return bundleOpening.openBundle(
    input,
    createPrismaRequestTransactionRunner(database, { translate: ["P2003", "P2025"], fallbackMessage: "Bundle opening failed." }),
  );
}

// Following a bundle (SPEC 2026-11-07-operacao-e-automacao, 3.3 item 4).
export { groupProgress, groupProgressText, groupStateLabel, type GroupCancellation, type GroupProgress } from "./domain/request-group";
export type { GroupBlock, RequesterGroupView } from "./application/groups";

export async function getRequesterGroup(groupId: unknown, database: PrismaClient = prisma): Promise<groups.RequesterGroupView> {
  return groups.getRequesterGroup(groupId, createPrismaGroupReader(database));
}

/** Each open request cancelled by the same rule as alone, in its own transaction. */
export async function cancelGroup(input: unknown, database: PrismaClient = prisma) {
  return groups.cancelGroup(input, createPrismaGroupReader(database), (requestId, note) => cancelRequest({ requestId, ...(note ? { note } : {}) }, database));
}

export async function listRequesterGroupLabels(requestIds: readonly string[], database: PrismaClient = prisma) {
  return groups.listRequesterGroupLabels(requestIds, createPrismaGroupReader(database));
}

export async function getRequestGroupBlock(requestId: unknown, database: PrismaClient = prisma): Promise<groups.GroupBlock | null> {
  return groups.getRequestGroupBlock(requestId, createPrismaAttachmentQueryRepository(database), createPrismaGroupReader(database));
}

// SPEC 2026-11-07-operacao-e-automacao, 4.3 item 7.
export type { AbsenceHandoverSummary } from "./application/absence-handover";

/** Daily job step: hands absent attendants' requests to colleagues, once per absence. */
export async function handOverAbsentAttendants(database: PrismaClient = prisma): Promise<absenceHandover.AbsenceHandoverSummary> {
  return absenceHandover.handOverAbsentAttendants(
    createPrismaAbsenceHandoverStore(
      database,
      createPrismaRequestTransactionRunner(database, { translate: ["P2025"], fallbackMessage: "Absence handover failed." }),
    ),
  );
}

// "Carga da equipe" (SPEC 2026-11-07-operacao-e-automacao, 4.3 item 8).
export { atLimit, type SectorLoad, type TeamMemberLoad } from "./application/team-load";

export async function getTeamLoad(database: PrismaClient = prisma): Promise<teamLoad.SectorLoad[] | null> {
  return teamLoad.getTeamLoad(createPrismaTeamLoadReader(database));
}

// Runs of the recurring requests' schedules (SPEC 2026-11-07-operacao-e-automacao, 5.3 items 3 and 4).
export type { RecurringRunSummary } from "./application/recurring-runs";

/** Daily job step: one run per active schedule whose latest day up to today has not run. */
export async function runRecurringSchedules(database: PrismaClient = prisma): Promise<recurringRuns.RecurringRunSummary> {
  return recurringRuns.runRecurringSchedules(createPrismaRecurringRunStore(database));
}

/** "Aberta automaticamente pela agenda …": the schedule that opened the request, or null. */
export async function getRequestScheduleName(requestId: unknown, database: PrismaClient = prisma): Promise<string | null> {
  return recurringRuns.getRequestScheduleName(requestId, createPrismaAttachmentQueryRepository(database), (id) =>
    findRequestScheduleName(database, id),
  );
}

// Batch actions in the queue (SPEC 2026-11-07-operacao-e-automacao, 7.3 item 2).
export { BATCH_ACTIONS, BATCH_REFUSAL_LABELS, MAX_BATCH_ITEMS, type BatchAction, type BatchChoices, type BatchItemResult, type BatchRefusal, type BatchResult } from "./application/batch";

/** Each item through the individual action, in its own transaction; the result per item. */
export async function runQueueBatch(input: unknown, database: PrismaClient = prisma): Promise<batch.BatchResult> {
  return batch.runQueueBatch(input, {
    assume: (item) => assumeRequest(item, database),
    transfer: (item) => transferRequest(item, database),
    priority: (item) => changeRequestPriority(item, database),
    sector: (item) => sendRequestToSector(item, database),
  });
}

/** The colleagues and sectors the batch form offers. */
export async function listBatchChoices(database: PrismaClient = prisma): Promise<batch.BatchChoices> {
  return batch.listBatchChoices(createPrismaRequestQueryRepository(database));
}
