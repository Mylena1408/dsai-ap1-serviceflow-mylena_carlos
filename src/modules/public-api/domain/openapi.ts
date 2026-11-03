import { API_ERROR_CODES } from "./errors";

// OpenAPI document of /api/v1 (SPEC 2026-11-02-api-externa-webhooks, 5.4; CA-API-09), served at
// GET /api/v1/openapi.json. A test compares the operations below with the route files.

export interface ApiOperation {
  method: "get" | "post";
  path: string;
  scope: "READ" | "WRITE" | null;
}

export const API_V1_OPERATIONS: readonly ApiOperation[] = [
  { method: "get", path: "/api/v1/me", scope: "READ" },
  { method: "get", path: "/api/v1/services", scope: "READ" },
  { method: "get", path: "/api/v1/requests", scope: "READ" },
  { method: "post", path: "/api/v1/requests", scope: "WRITE" },
  { method: "get", path: "/api/v1/requests/{requestId}", scope: "READ" },
  { method: "post", path: "/api/v1/requests/{requestId}/comments", scope: "WRITE" },
  // SPEC 2026-11-03-api-acoes-webhooks-setor, 5.1 (decision W1).
  { method: "post", path: "/api/v1/requests/{requestId}/start", scope: "WRITE" },
  { method: "post", path: "/api/v1/requests/{requestId}/complete", scope: "WRITE" },
  { method: "post", path: "/api/v1/requests/{requestId}/assume", scope: "WRITE" },
  { method: "post", path: "/api/v1/requests/{requestId}/release", scope: "WRITE" },
  { method: "post", path: "/api/v1/requests/{requestId}/transfer", scope: "WRITE" },
  { method: "get", path: "/api/v1/requests/{requestId}/transfer-candidates", scope: "READ" },
  { method: "post", path: "/api/v1/requests/{requestId}/cancel", scope: "WRITE" },
  { method: "post", path: "/api/v1/requests/{requestId}/reopen", scope: "WRITE" },
  // SPEC 2026-11-03-transferencia-entre-setores, 5.8.
  { method: "post", path: "/api/v1/requests/{requestId}/transfer-sector", scope: "WRITE" },
  { method: "get", path: "/api/v1/requests/{requestId}/sector-candidates", scope: "READ" },
  // SPEC 2026-11-03-pausa-sla-calendario, 5.8.
  { method: "post", path: "/api/v1/requests/{requestId}/pause-sla", scope: "WRITE" },
  { method: "post", path: "/api/v1/requests/{requestId}/resume-sla", scope: "WRITE" },
  { method: "get", path: "/api/v1/openapi.json", scope: null },
];

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const json = (schema: object) => ({ "application/json": { schema } });
const nullable = (type: string, extra: object = {}) => ({ type: [type, "null"], ...extra });
const dateTime = { type: "string", format: "date-time" };
const person = { type: "object", required: ["id", "name"], properties: { id: { type: "string", format: "uuid" }, name: { type: "string" } } };
const STATUS = { type: "string", enum: ["OPEN", "IN_PROGRESS", "COMPLETED", "CANCELLED"] };
const PRIORITY = { type: "string", enum: ["LOW", "NORMAL", "HIGH", "URGENT"] };

function errors(...codes: Array<(typeof API_ERROR_CODES)[number]>) {
  const status: Record<string, string> = {
    invalid_request: "400",
    invalid_token: "401",
    forbidden: "403",
    insufficient_scope: "403",
    not_found: "404",
    conflict: "409",
    documents_required: "422",
    rate_limited: "429",
  };
  const responses: Record<string, object> = {};
  for (const code of ["invalid_token", "rate_limited", ...codes] as const) {
    const key = status[code]!;
    const existing = responses[key] as { description: string } | undefined;
    responses[key] = {
      description: existing ? `${existing.description}, ${code}` : code,
      content: json(ref("Error")),
      ...(code === "rate_limited" ? { headers: { "Retry-After": { schema: { type: "integer" }, description: "Segundos até a próxima janela" } } } : {}),
    };
  }
  return responses;
}

const requestIdParameter = { name: "requestId", in: "path", required: true, schema: { type: "string", format: "uuid" } };

/** An action of the attendance (SPEC 2026-11-03-api-acoes-webhooks-setor, 5.1). */
function actionOperation(summary: string, description: string, body?: object) {
  return {
    post: {
      summary,
      description: `${description} Mesmas regras da tela. Responde com o detalhe atualizado. Escopo: WRITE.`,
      parameters: [requestIdParameter],
      ...(body ? { requestBody: { required: true, content: json(body) } } : {}),
      responses: {
        "200": { description: "A solicitação atualizada", content: json(ref("RequestDetail")) },
        ...errors("invalid_request", "insufficient_scope", "forbidden", "not_found", "conflict"),
      },
    },
  };
}

const noteBody = (required: boolean) => ({
  type: "object",
  additionalProperties: false,
  ...(required ? { required: ["note"] } : {}),
  properties: { note: { type: "string", maxLength: 1000 } },
});

export const OPENAPI_DOCUMENT = {
  openapi: "3.1.0",
  info: {
    title: "ServiceFlow API",
    version: "1.0.0",
    description:
      "API do ServiceFlow com tokens pessoais. Cada chamada age com o perfil, o setor e as permissões de quem criou o token, " +
      "com as mesmas regras da tela. Limite de 60 chamadas por minuto por token. O que a pessoa não pode ler responde 404.",
  },
  servers: [{ url: "/" }],
  security: [{ bearerToken: [] }],
  paths: {
    "/api/v1/me": {
      get: {
        summary: "Quem é a pessoa do token",
        description: "Nome, e-mail, perfil, setor e permissões; escopo e validade do token. Escopo: READ.",
        responses: { "200": { description: "A pessoa", content: json(ref("Me")) }, ...errors() },
      },
    },
    "/api/v1/services": {
      get: {
        summary: "Catálogo publicado",
        description: "Só solicitantes. Serviços com documentos exigidos e campos. Escopo: READ.",
        responses: {
          "200": { description: "Serviços", content: json({ type: "object", required: ["items"], properties: { items: { type: "array", items: ref("Service") } } }) },
          ...errors("forbidden"),
        },
      },
    },
    "/api/v1/requests": {
      get: {
        summary: "Solicitações da pessoa",
        description:
          "Solicitante: as próprias; atendente: a fila do setor; gestor: as aprovações (filter=pending, all ou sector). " +
          "Solicitante e atendente aceitam os filtros da tela: q, status (repetível), assignee, from, to, order, sla. 20 por página. Escopo: READ.",
        parameters: [
          { name: "page", in: "query", schema: { type: "integer", minimum: 1 } },
          { name: "q", in: "query", schema: { type: "string" } },
          { name: "status", in: "query", schema: { type: "array", items: STATUS }, style: "form", explode: true },
          { name: "assignee", in: "query", schema: { type: "string", enum: ["all", "mine", "unassigned"] } },
          { name: "from", in: "query", schema: { type: "string", format: "date" } },
          { name: "to", in: "query", schema: { type: "string", format: "date" } },
          { name: "order", in: "query", schema: { type: "string", enum: ["newest", "oldest", "due"] } },
          { name: "sla", in: "query", description: "Só atendentes", schema: { type: "string", enum: ["on_time", "due_soon", "overdue", "none", "paused"] } },
          { name: "filter", in: "query", schema: { type: "string", enum: ["pending", "all", "sector"] } },
        ],
        responses: { "200": { description: "Uma página", content: json(ref("RequestPage")) }, ...errors("invalid_request", "forbidden") },
      },
      post: {
        summary: "Abrir uma solicitação",
        description:
          "Só solicitantes, sem anexos: serviço com documento obrigatório responde 422 documents_required. " +
          "fieldValues traz as respostas dos campos pelo id do campo; a seleção múltipla aceita uma lista de opções, e o valor de um campo cuja condição não foi atendida é descartado. Escopo: WRITE.",
        requestBody: {
          required: true,
          content: json({
            type: "object",
            additionalProperties: false,
            required: ["serviceId", "description"],
            properties: {
              serviceId: { type: "string", format: "uuid" },
              description: { type: "string", maxLength: 10000 },
              fieldValues: {
                type: "object",
                additionalProperties: { oneOf: [{ type: "string" }, { type: "array", items: { type: "string" } }] },
              },
            },
          }),
        },
        responses: {
          "201": { description: "Solicitação aberta", content: json(ref("RequestDetail")) },
          ...errors("invalid_request", "insufficient_scope", "forbidden", "not_found", "conflict", "documents_required"),
        },
      },
    },
    "/api/v1/requests/{requestId}": {
      get: {
        summary: "Detalhe de uma solicitação",
        description: "Com respostas, anexos (sem download), comentários visíveis à pessoa e histórico. Escopo: READ.",
        parameters: [requestIdParameter],
        responses: { "200": { description: "A solicitação", content: json(ref("RequestDetail")) }, ...errors("invalid_request", "forbidden", "not_found") },
      },
    },
    "/api/v1/requests/{requestId}/comments": {
      post: {
        summary: "Comentar",
        description: "Mesmas regras da conversa na tela; internal=true só para atendentes. Escopo: WRITE.",
        parameters: [requestIdParameter],
        requestBody: {
          required: true,
          content: json({
            type: "object",
            additionalProperties: false,
            required: ["body"],
            properties: { body: { type: "string", maxLength: 5000 }, internal: { type: "boolean" } },
          }),
        },
        responses: {
          "201": { description: "Comentário", content: json(ref("Comment")) },
          ...errors("invalid_request", "insufficient_scope", "forbidden", "not_found", "conflict"),
        },
      },
    },
    "/api/v1/requests/{requestId}/start": actionOperation("Iniciar o atendimento", "Atendente do setor; com responsável, só ele; com aprovação pendente, 409."),
    "/api/v1/requests/{requestId}/complete": actionOperation("Concluir", "Atendente do setor; com responsável, só ele."),
    "/api/v1/requests/{requestId}/assume": actionOperation("Assumir", "Atendente do setor, quando não há responsável efetivo."),
    "/api/v1/requests/{requestId}/release": actionOperation("Liberar", "O responsável ou quem supervisiona a fila do setor."),
    "/api/v1/requests/{requestId}/transfer": actionOperation(
      "Transferir",
      "O responsável ou quem supervisiona a fila, para um atendente ativo do setor (veja transfer-candidates).",
      { type: "object", additionalProperties: false, required: ["assigneeId"], properties: { assigneeId: { type: "string", format: "uuid" } } },
    ),
    "/api/v1/requests/{requestId}/transfer-candidates": {
      get: {
        summary: "Para quem se pode transferir",
        description: "Atendentes ativos do setor, sem o responsável atual nem quem pede. Escopo: READ.",
        parameters: [requestIdParameter],
        responses: {
          "200": { description: "Candidatos", content: json({ type: "object", required: ["items"], properties: { items: { type: "array", items: person } } }) },
          ...errors("invalid_request", "forbidden", "not_found"),
        },
      },
    },
    "/api/v1/requests/{requestId}/cancel": actionOperation(
      "Cancelar",
      "Solicitante, só com a solicitação aberta (motivo opcional); atendente do setor, com motivo obrigatório.",
      noteBody(false),
    ),
    "/api/v1/requests/{requestId}/reopen": actionOperation("Reabrir", "Solicitante, até 7 dias depois da conclusão, com motivo.", noteBody(true)),
    "/api/v1/requests/{requestId}/pause-sla": actionOperation(
      "Pausar o prazo",
      "Responsável (ou quem supervisiona a fila; sem responsável, atendente do setor), com a solicitação em atendimento, com prazo, sem pausa e sem estar vencida. O motivo é mostrado ao solicitante.",
      { type: "object", additionalProperties: false, required: ["reason"], properties: { reason: { type: "string", minLength: 1, maxLength: 500 } } },
    ),
    "/api/v1/requests/{requestId}/resume-sla": actionOperation(
      "Retomar o prazo",
      "Quem pode pausar, com a solicitação pausada. O tempo pausado não conta no prazo.",
      { type: "object", additionalProperties: false, properties: {} },
    ),
    "/api/v1/requests/{requestId}/transfer-sector": {
      post: {
        summary: "Encaminhar para outro setor",
        description:
          "Atendente do setor (o responsável, se houver, ou quem supervisiona a fila), com a solicitação aberta e sem aprovação pendente, para um setor de sector-candidates, com justificativa. O responsável sai; prazo e prioridade ficam. Quem encaminha deixa de ver a solicitação, então a resposta só confirma o encaminhamento. Escopo: WRITE.",
        parameters: [requestIdParameter],
        requestBody: {
          required: true,
          content: json({
            type: "object",
            additionalProperties: false,
            required: ["sectorId", "note"],
            properties: { sectorId: { type: "string", format: "uuid" }, note: { type: "string", minLength: 1, maxLength: 1000 } },
          }),
        },
        responses: {
          "200": {
            description: "Encaminhada",
            content: json({
              type: "object",
              required: ["id", "sectorId"],
              properties: { id: { type: "string", format: "uuid" }, sectorId: { type: "string", format: "uuid" } },
            }),
          },
          ...errors("invalid_request", "insufficient_scope", "forbidden", "not_found", "conflict"),
        },
      },
    },
    "/api/v1/requests/{requestId}/sector-candidates": {
      get: {
        summary: "Para quais setores se pode encaminhar",
        description: "Setores ativos, diferentes do atual e com pelo menos um atendente ativo, por nome. Escopo: READ.",
        parameters: [requestIdParameter],
        responses: {
          "200": { description: "Setores", content: json({ type: "object", required: ["items"], properties: { items: { type: "array", items: person } } }) },
          ...errors("invalid_request", "forbidden", "not_found"),
        },
      },
    },
    "/api/v1/openapi.json": {
      get: {
        summary: "Este documento",
        security: [],
        responses: { "200": { description: "OpenAPI 3.1", content: json({ type: "object" }) } },
      },
    },
  },
  components: {
    securitySchemes: {
      bearerToken: { type: "http", scheme: "bearer", description: "Token pessoal sf_..., criado em \"Acesso à API\"." },
    },
    schemas: {
      Error: {
        type: "object",
        required: ["error"],
        properties: {
          error: {
            type: "object",
            required: ["code", "message"],
            properties: {
              code: { type: "string", enum: [...API_ERROR_CODES] },
              message: { type: "string" },
              issues: { type: "array", items: { type: "object", properties: { path: { type: "array", items: { type: "string" } }, code: { type: "string" } } } },
              fields: { type: "array", items: { type: "object", properties: { fieldId: { type: "string" }, code: { type: "string" } } } },
            },
          },
        },
      },
      Me: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          name: { type: "string" },
          email: { type: "string" },
          role: { type: "string", enum: ["REQUESTER", "ATTENDANT", "MANAGER"] },
          sector: nullable("object", { properties: person.properties }),
          permissions: { type: "array", items: { type: "string", enum: ["SECTOR_SERVICES", "SECTOR_REQUESTS_READ", "QUEUE_SUPERVISION"] } },
          token: { type: "object", properties: { scope: { type: "string", enum: ["READ", "WRITE"] }, expiresAt: dateTime } },
        },
      },
      Service: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          name: { type: "string" },
          description: { type: "string" },
          category: person,
          sector: person,
          defaultPriority: PRIORITY,
          slaHours: nullable("integer"),
          requiresApproval: { type: "boolean" },
          documents: { type: "array", items: { type: "object", properties: { name: { type: "string" }, required: { type: "boolean" }, formats: { type: "array", items: { type: "string" } } } } },
          fields: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string", format: "uuid" },
                label: { type: "string" },
                type: { type: "string" },
                required: { type: "boolean" },
                helpText: nullable("string"),
                options: { type: "array", items: { type: "string" } },
                minValue: nullable("integer"),
                maxValue: nullable("integer"),
                condition: nullable("object", {
                  description: "Mostrar só quando o campo fieldId for (ou, na seleção múltipla, contiver) value; true/false para sim ou não.",
                  properties: { fieldId: { type: "string", format: "uuid" }, value: { type: "string" } },
                }),
              },
            },
          },
        },
      },
      RequestSummary: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          service: person,
          category: person,
          sector: person,
          description: { type: "string" },
          status: STATUS,
          priority: PRIORITY,
          approval: nullable("string", { enum: ["PENDING", "APPROVED", "REJECTED", null] }),
          stage: nullable("string"),
          assignee: nullable("object", { properties: person.properties }),
          createdAt: dateTime,
          updatedAt: dateTime,
          completedAt: nullable("string", { format: "date-time" }),
          cancelledAt: nullable("string", { format: "date-time" }),
          dueAt: nullable("string", { format: "date-time" }),
          slaSituation: { type: "string", enum: ["none", "on_time", "due_soon", "overdue", "completed_on_time", "completed_late", "paused"] },
          completedLate: nullable("boolean"),
        },
      },
      RequestDetail: {
        allOf: [
          ref("RequestSummary"),
          {
            type: "object",
            properties: {
              slaBusinessHours: { type: "boolean", description: "O prazo conta só horas úteis do calendário." },
              slaPausedAt: nullable("string", { format: "date-time" }),
              fieldAnswers: { type: "array", items: { type: "object", properties: { label: { type: "string" }, type: { type: "string" }, value: { type: "string" } } } },
              attachments: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    id: { type: "string", format: "uuid" },
                    document: { type: "string" },
                    fileName: { type: "string" },
                    format: { type: "string" },
                    sizeBytes: { type: "integer" },
                    removed: { type: "boolean" },
                  },
                },
              },
              comments: { type: "array", items: ref("Comment") },
              history: { type: "object", description: "status, assignment, sectors (encaminhamentos), priority, pauses (pausas do prazo), stages e approval" },
            },
          },
        ],
      },
      RequestPage: {
        type: "object",
        properties: {
          items: { type: "array", items: ref("RequestSummary") },
          page: { type: "integer" },
          pageCount: { type: "integer" },
          total: { type: "integer" },
        },
      },
      Comment: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          author: person,
          body: { type: "string" },
          internal: { type: "boolean" },
          createdAt: dateTime,
          files: {
            type: "array",
            description: "Arquivos do comentário: só metadados; o download é feito pela tela.",
            items: {
              type: "object",
              properties: {
                id: { type: "string", format: "uuid" },
                fileName: nullable("string"),
                format: { type: "string", enum: ["PDF", "DOCX", "TXT"] },
                sizeBytes: { type: "integer" },
                removed: { type: "boolean" },
              },
            },
          },
        },
      },
    },
  },
} as const;
