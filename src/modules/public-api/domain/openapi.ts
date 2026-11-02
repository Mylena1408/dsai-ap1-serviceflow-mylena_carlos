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
          { name: "sla", in: "query", description: "Só atendentes", schema: { type: "string", enum: ["on_time", "due_soon", "overdue", "none"] } },
          { name: "filter", in: "query", schema: { type: "string", enum: ["pending", "all", "sector"] } },
        ],
        responses: { "200": { description: "Uma página", content: json(ref("RequestPage")) }, ...errors("invalid_request", "forbidden") },
      },
      post: {
        summary: "Abrir uma solicitação",
        description:
          "Só solicitantes, sem anexos: serviço com documento obrigatório responde 422 documents_required. " +
          "fieldValues traz as respostas dos campos pelo id do campo. Escopo: WRITE.",
        requestBody: {
          required: true,
          content: json({
            type: "object",
            additionalProperties: false,
            required: ["serviceId", "description"],
            properties: {
              serviceId: { type: "string", format: "uuid" },
              description: { type: "string", maxLength: 10000 },
              fieldValues: { type: "object", additionalProperties: { type: "string" } },
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
          slaSituation: { type: "string", enum: ["none", "on_time", "due_soon", "overdue", "completed_on_time", "completed_late"] },
          completedLate: nullable("boolean"),
        },
      },
      RequestDetail: {
        allOf: [
          ref("RequestSummary"),
          {
            type: "object",
            properties: {
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
              history: { type: "object", description: "status, assignment, priority, stages e approval" },
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
        },
      },
    },
  },
} as const;
