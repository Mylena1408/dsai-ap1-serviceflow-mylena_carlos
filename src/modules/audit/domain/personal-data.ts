import { ROLE_LABELS } from "@/shared/admin-labels";
import { NOTIFICATION_CATEGORY_LABELS, notificationMessage, type NotificationType } from "@/shared/notifications";
import { PERMISSION_LABELS, type Permission } from "@/shared/permissions";
import {
  APPROVAL_LABELS,
  PRIORITY_LABELS,
  REQUEST_STATUS_LABELS,
  requestShortCode,
  type ApprovalStateValue,
  type PriorityValue,
  type StatusValue,
} from "@/shared/requests";
import { zonedDayOf } from "@/shared/time";

// "Meus dados" (SPEC 2026-11-02-auditoria-lgpd, 5.4, decision D3): the person's own data in a
// readable JSON. Built field by field from what the reader loads, so a password hash or another
// person's internal note cannot reach the file even if the source carried it by mistake.

type Role = keyof typeof ROLE_LABELS;
type Category = keyof typeof NOTIFICATION_CATEGORY_LABELS;

export interface PersonalDataSource {
  person: {
    name: string;
    email: string;
    role: Role;
    sectorName: string | null;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
  };
  emailCategories: Category[];
  /** Requests the person opened, oldest first. */
  requests: Array<{
    id: string;
    serviceName: string;
    categoryName: string;
    sectorName: string;
    description: string;
    status: StatusValue;
    priority: PriorityValue;
    approvalState: ApprovalStateValue | null;
    createdAt: Date;
    completedAt: Date | null;
    cancelledAt: Date | null;
    dueAt: Date | null;
    answers: Array<{ label: string; value: string }>;
    history: Array<{ occurredAt: Date; toStatus: StatusValue; actorName: string; note: string | null }>;
    /** Public comments only: internal notes belong to the team. */
    comments: Array<{ createdAt: Date; authorName: string; body: string; isInternal: boolean }>;
    attachments: Array<{ requirementName: string; filename: string; createdAt: Date; removed: boolean }>;
  }>;
  /** Comments and notes the person wrote in requests opened by others. */
  writtenElsewhere: Array<{ requestId: string; serviceName: string; createdAt: Date; body: string; isInternal: boolean }>;
  /** Most recent first. */
  notifications: Array<{ createdAt: Date; readAt: Date | null; type: NotificationType; serviceName: string }>;
  permissions: Array<{ permission: Permission; grantedAt: Date }>;
  /**
   * API tokens (SPEC 2026-11-02-api-externa-webhooks, 5.7): name, scope text, last four characters
   * and dates, never the value or the hash. Absent for sources written before that SPEC.
   */
  apiTokens?: Array<{
    name: string;
    scope: string;
    lastFour: string;
    createdAt: Date;
    expiresAt: Date;
    lastUsedAt: Date | null;
    revokedAt: Date | null;
  }>;
}

const iso = (value: Date | null) => (value ? value.toISOString() : null);

export function buildPersonalDataExport(source: PersonalDataSource, now: Date) {
  const { person } = source;

  return {
    geradoEm: now.toISOString(),
    observacao:
      "Dados pessoais guardados pelo ServiceFlow sobre você. Os arquivos anexados não vão no arquivo: eles podem ser baixados nas próprias solicitações.",
    pessoa: {
      nome: person.name,
      email: person.email,
      perfil: ROLE_LABELS[person.role],
      setor: person.sectorName,
      ativa: person.isActive,
      criadaEm: iso(person.createdAt),
      atualizadaEm: iso(person.updatedAt),
    },
    emailsQueVoceEscolheuReceber: source.emailCategories.map((category) => NOTIFICATION_CATEGORY_LABELS[category]),
    solicitacoesQueVoceAbriu: source.requests.map((request) => ({
      codigo: requestShortCode(request.id),
      servico: request.serviceName,
      categoria: request.categoryName,
      setor: request.sectorName,
      descricao: request.description,
      status: REQUEST_STATUS_LABELS[request.status],
      prioridade: PRIORITY_LABELS[request.priority],
      aprovacao: request.approvalState ? APPROVAL_LABELS[request.approvalState] : null,
      abertaEm: iso(request.createdAt),
      concluidaEm: iso(request.completedAt),
      canceladaEm: iso(request.cancelledAt),
      vencimento: iso(request.dueAt),
      respostas: request.answers.map((answer) => ({ campo: answer.label, valor: answer.value })),
      historico: request.history.map((event) => ({
        quando: iso(event.occurredAt),
        status: REQUEST_STATUS_LABELS[event.toStatus],
        por: event.actorName,
        justificativa: event.note,
      })),
      comentarios: request.comments
        .filter((comment) => !comment.isInternal)
        .map((comment) => ({ quando: iso(comment.createdAt), autor: comment.authorName, texto: comment.body })),
      anexos: request.attachments.map((attachment) => ({
        documento: attachment.requirementName,
        arquivo: attachment.removed ? "Arquivo removido na anonimização" : attachment.filename,
        enviadoEm: iso(attachment.createdAt),
      })),
    })),
    comentariosQueVoceEscreveuEmOutrasSolicitacoes: source.writtenElsewhere.map((comment) => ({
      solicitacao: requestShortCode(comment.requestId),
      servico: comment.serviceName,
      quando: iso(comment.createdAt),
      notaInterna: comment.isInternal,
      texto: comment.body,
    })),
    notificacoesRecentes: source.notifications.map((notification) => ({
      quando: iso(notification.createdAt),
      texto: notificationMessage(notification),
      lida: notification.readAt !== null,
    })),
    permissoesRecebidas: source.permissions.map((grant) => ({ permissao: PERMISSION_LABELS[grant.permission], concedidaEm: iso(grant.grantedAt) })),
    tokensDeAcessoAPI: (source.apiTokens ?? []).map((token) => ({
      nome: token.name,
      escopo: token.scope,
      terminaEm: token.lastFour,
      criadoEm: iso(token.createdAt),
      validoAte: iso(token.expiresAt),
      ultimoUso: iso(token.lastUsedAt),
      revogadoEm: iso(token.revokedAt),
    })),
  };
}

export type PersonalDataExport = ReturnType<typeof buildPersonalDataExport>;

export function personalDataFileName(now: Date): string {
  return `serviceflow-meus-dados-${zonedDayOf(now)}.json`;
}
