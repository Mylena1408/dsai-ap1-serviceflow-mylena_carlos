// Fictitious demonstration data (SPEC 2026-09-30, sections 22.6, 22.7 and 25). Pure data and
// rules only: the loader in infrastructure/ writes it, and the product never depends on it.

export const DEMO_CATALOG = [
  {
    category: "TI",
    services: [
      {
        name: "Criação de conta de acesso",
        description: "Criação de usuário e e-mail institucional para um novo colaborador.",
      },
      {
        name: "Redefinição de senha de sistema",
        description: "Desbloqueio ou redefinição de senha de um sistema interno.",
      },
      {
        name: "Solicitação de equipamento",
        description: "Pedido de notebook, monitor, teclado ou outro equipamento de trabalho.",
      },
    ],
  },
  {
    category: "RH",
    services: [
      {
        name: "Declaração de vínculo",
        description: "Emissão de declaração de vínculo empregatício ou funcional.",
      },
      {
        name: "Solicitação de férias",
        description: "Registro do pedido de férias com o período desejado.",
      },
      {
        name: "Atualização cadastral",
        description: "Alteração de endereço, telefone, dados bancários ou dependentes.",
      },
    ],
  },
  {
    category: "Manutenção",
    services: [
      {
        name: "Reparo elétrico",
        description: "Tomadas, interruptores, iluminação ou disjuntores com defeito.",
      },
      {
        name: "Manutenção de ar-condicionado",
        description: "Limpeza, falha de refrigeração ou ruído em aparelho de ar-condicionado.",
      },
      {
        name: "Reparo de mobiliário",
        description: "Conserto de mesas, cadeiras, armários ou divisórias.",
      },
    ],
  },
] as const;

export type DemoServiceName = (typeof DEMO_CATALOG)[number]["services"][number]["name"];
export type DemoPriority = "LOW" | "NORMAL" | "HIGH" | "URGENT";

/** Section 25.3: deadlines, priorities and approval that make the SLA and approval screens show data. */
export const DEMO_SERVICE_SETTINGS: Partial<
  Record<DemoServiceName, { slaHours: number; defaultPriority: DemoPriority; requiresApproval: boolean }>
> = {
  "Redefinição de senha de sistema": { slaHours: 8, defaultPriority: "HIGH", requiresApproval: false },
  "Solicitação de equipamento": { slaHours: 72, defaultPriority: "NORMAL", requiresApproval: true },
  "Reparo elétrico": { slaHours: 24, defaultPriority: "NORMAL", requiresApproval: false },
  "Manutenção de ar-condicionado": { slaHours: 48, defaultPriority: "NORMAL", requiresApproval: false },
};

/** The two fictitious requesters without a sign-in button (section 25.1). */
export const DEMO_EXTRA_REQUESTERS = {
  bruno: { name: "Bruno Lima", email: "bruno.lima@exemplo.test" },
  carla: { name: "Carla Mendes", email: "carla.mendes@exemplo.test" },
} as const;

export type DemoRequesterKey = "ana" | "bruno" | "carla";

export const DEMO_DOCUMENT_REQUIREMENTS: ReadonlyArray<{
  service: DemoServiceName;
  requirements: ReadonlyArray<{
    name: string;
    isRequired: boolean;
    acceptedFormats: ReadonlyArray<"PDF" | "DOCX" | "TXT">;
  }>;
}> = [
  {
    service: "Solicitação de férias",
    requirements: [{ name: "Formulário de férias", isRequired: true, acceptedFormats: ["PDF"] }],
  },
  {
    service: "Atualização cadastral",
    requirements: [
      { name: "Comprovante de residência", isRequired: true, acceptedFormats: ["PDF", "DOCX"] },
      { name: "Certidão de dependente", isRequired: false, acceptedFormats: ["PDF"] },
    ],
  },
];

// Example custom fields (SPEC 2026-11-01-campos-personalizados, section 3 item 6).
export const DEMO_SERVICE_FIELDS: ReadonlyArray<{
  service: DemoServiceName;
  fields: ReadonlyArray<{
    label: string;
    helpText?: string;
    type: "SHORT_TEXT" | "LONG_TEXT" | "INTEGER" | "DATE" | "SELECT" | "YES_NO";
    isRequired: boolean;
    options?: ReadonlyArray<string>;
    minValue?: number;
    maxValue?: number;
  }>;
}> = [
  {
    service: "Manutenção de ar-condicionado",
    fields: [
      { label: "Sala ou local", helpText: "Por exemplo: sala 12, 2º andar.", type: "SHORT_TEXT", isRequired: true },
      {
        label: "Problema principal",
        type: "SELECT",
        isRequired: true,
        options: ["Não refrigera", "Pingando água", "Ruído", "Não liga"],
      },
      { label: "Quantidade de aparelhos", type: "INTEGER", isRequired: false, minValue: 1, maxValue: 20 },
      { label: "Melhor dia para a visita", type: "DATE", isRequired: false },
      { label: "O aparelho está ligado agora?", type: "YES_NO", isRequired: false },
    ],
  },
];

export type DemoOutcome = "OPEN" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";

export interface DemoComment {
  /** The requester or the attendant (Diego). */
  author: "requester" | "attendant";
  afterHours: number;
  body: string;
  internal?: boolean;
}

export interface DemoRequestScenario {
  key: string;
  requester: DemoRequesterKey;
  service: DemoServiceName;
  description: string;
  outcome: DemoOutcome;
  openedHoursAgo: number;
  /** Hours after opening; the attendant assumes the request just before starting it. */
  startAfterHours?: number;
  completeAfterHours?: number;
  /** Cancellation by the requester, hours after opening. */
  cancel?: { afterHours: number; note: string };
  /** Only for a service that requires approval; the decision is the manager's. */
  approval?: { decision: "PENDING" } | { decision: "APPROVED" | "REJECTED"; afterHours: number; note: string };
  fieldAnswers?: Readonly<Record<string, string>>;
  comments?: ReadonlyArray<DemoComment>;
}

/** Section 25.3: every status, assignee, deadline situations, the three approval states and a conversation. */
export const DEMO_REQUESTS: ReadonlyArray<DemoRequestScenario> = [
  {
    key: "ana-equipamento",
    requester: "ana",
    service: "Solicitação de equipamento",
    description: "Preciso de um monitor adicional para trabalhar com planilhas.",
    outcome: "IN_PROGRESS",
    openedHoursAgo: 72,
    approval: { decision: "APPROVED", afterHours: 20, note: "Aprovado; o monitor sai do estoque do setor." },
    startAfterHours: 24,
  },
  {
    key: "ana-declaracao",
    requester: "ana",
    service: "Declaração de vínculo",
    description: "Declaração para apresentar no banco até sexta-feira.",
    outcome: "IN_PROGRESS",
    openedHoursAgo: 50,
    startAfterHours: 2,
    comments: [
      { author: "requester", afterHours: 1, body: "Preciso entregar no banco até sexta-feira, se possível." },
      { author: "attendant", afterHours: 3, body: "Já estou preparando a declaração; aviso assim que estiver assinada." },
      { author: "attendant", afterHours: 3.5, body: "Conferir a data de admissão no sistema de RH antes de emitir.", internal: true },
    ],
  },
  {
    key: "ana-eletrica",
    requester: "ana",
    service: "Reparo elétrico",
    description: "A tomada ao lado da minha mesa não está funcionando.",
    outcome: "COMPLETED",
    openedHoursAgo: 216,
    startAfterHours: 2,
    completeAfterHours: 20,
  },
  {
    key: "ana-conta",
    requester: "ana",
    service: "Criação de conta de acesso",
    description: "Conta de acesso para o estagiário que começa na segunda-feira.",
    outcome: "OPEN",
    openedHoursAgo: 5,
  },
  {
    key: "ana-ar",
    requester: "ana",
    service: "Manutenção de ar-condicionado",
    description: "O ar-condicionado da sala 12 está pingando.",
    outcome: "CANCELLED",
    openedHoursAgo: 144,
    cancel: { afterHours: 3, note: "O técnico do prédio já resolveu o vazamento." },
    fieldAnswers: { "Sala ou local": "Sala 12, 2º andar", "Problema principal": "Pingando água" },
  },
  {
    key: "bruno-senha",
    requester: "bruno",
    service: "Redefinição de senha de sistema",
    description: "Fui bloqueado no sistema de compras após três tentativas.",
    outcome: "OPEN",
    openedHoursAgo: 26,
    comments: [{ author: "requester", afterHours: 2, body: "Continuo bloqueado; há pedidos de compra parados." }],
  },
  {
    key: "bruno-cadastro",
    requester: "bruno",
    service: "Atualização cadastral",
    description: "Mudei de endereço e preciso atualizar meus dados.",
    outcome: "COMPLETED",
    openedHoursAgo: 360,
    startAfterHours: 3,
    completeAfterHours: 30,
  },
  {
    key: "bruno-equipamento",
    requester: "bruno",
    service: "Solicitação de equipamento",
    description: "Teclado novo para a estação 4.",
    outcome: "CANCELLED",
    openedHoursAgo: 120,
    approval: { decision: "REJECTED", afterHours: 8, note: "Há um teclado reserva no setor; retire com o patrimônio." },
  },
  {
    key: "bruno-mobiliario",
    requester: "bruno",
    service: "Reparo de mobiliário",
    description: "A cadeira da estação 4 está com o encosto solto.",
    outcome: "IN_PROGRESS",
    openedHoursAgo: 96,
    startAfterHours: 4,
  },
  {
    key: "bruno-ar",
    requester: "bruno",
    service: "Manutenção de ar-condicionado",
    description: "Ruído forte no aparelho da sala de reuniões.",
    outcome: "COMPLETED",
    openedHoursAgo: 288,
    startAfterHours: 6,
    completeAfterHours: 60,
    fieldAnswers: { "Sala ou local": "Sala de reuniões, 3º andar", "Problema principal": "Ruído" },
  },
  {
    key: "carla-eletrica",
    requester: "carla",
    service: "Reparo elétrico",
    description: "Lâmpada queimada no corredor do segundo andar.",
    outcome: "OPEN",
    openedHoursAgo: 21,
  },
  {
    key: "carla-equipamento",
    requester: "carla",
    service: "Solicitação de equipamento",
    description: "Notebook para as reuniões fora do escritório.",
    outcome: "OPEN",
    openedHoursAgo: 20,
    approval: { decision: "PENDING" },
  },
  {
    key: "carla-declaracao",
    requester: "carla",
    service: "Declaração de vínculo",
    description: "Declaração para matrícula em curso de pós-graduação.",
    outcome: "COMPLETED",
    openedHoursAgo: 480,
    startAfterHours: 4,
    completeAfterHours: 24,
  },
  {
    key: "carla-ar",
    requester: "carla",
    service: "Manutenção de ar-condicionado",
    description: "O ar-condicionado da recepção não está gelando.",
    outcome: "IN_PROGRESS",
    openedHoursAgo: 6,
    startAfterHours: 1,
    fieldAnswers: { "Sala ou local": "Recepção, térreo", "Problema principal": "Não refrigera", "Quantidade de aparelhos": "2" },
  },
];

export type DemoRecipient = "ana" | "bruno" | "diego" | "paulo";

/** Unread and read notifications that the in-app lists show (section 25.3). */
export const DEMO_NOTIFICATIONS: ReadonlyArray<{
  recipient: DemoRecipient;
  request: string;
  type:
    | "status.IN_PROGRESS"
    | "status.COMPLETED"
    | "comment.public"
    | "approval.requested"
    | "approval.approved"
    | "approval.rejected";
  afterHours: number;
  read: boolean;
}> = [
  { recipient: "ana", request: "ana-declaracao", type: "status.IN_PROGRESS", afterHours: 2, read: false },
  { recipient: "ana", request: "ana-declaracao", type: "comment.public", afterHours: 3, read: false },
  { recipient: "ana", request: "ana-equipamento", type: "approval.approved", afterHours: 20, read: true },
  { recipient: "ana", request: "ana-eletrica", type: "status.COMPLETED", afterHours: 20, read: true },
  { recipient: "diego", request: "ana-declaracao", type: "comment.public", afterHours: 1, read: false },
  { recipient: "diego", request: "bruno-senha", type: "comment.public", afterHours: 2, read: false },
  { recipient: "paulo", request: "carla-equipamento", type: "approval.requested", afterHours: 0, read: false },
  { recipient: "paulo", request: "ana-equipamento", type: "approval.requested", afterHours: 0, read: true },
  { recipient: "bruno", request: "bruno-equipamento", type: "approval.rejected", afterHours: 8, read: false },
];

const HOUR_MS = 60 * 60 * 1000;
/** The attendant assumes the request this long before starting it. */
const ASSUME_BEFORE_START_MS = 5 * 60 * 1000;

export interface DemoTimeline {
  openedAt: Date;
  decidedAt: Date | null;
  assignedAt: Date | null;
  startedAt: Date | null;
  completedAt: Date | null;
  cancelledAt: Date | null;
  /** The last change of status or approval. */
  updatedAt: Date;
}

/** Dates of a scenario, counted back from `now`; `hoursAfterOpening` places comments and notifications. */
export function demoTimeline(scenario: DemoRequestScenario, now: Date): DemoTimeline {
  const openedAt = new Date(now.getTime() - scenario.openedHoursAgo * HOUR_MS);
  const after = (hours: number | undefined) =>
    hours === undefined ? null : new Date(openedAt.getTime() + hours * HOUR_MS);
  const decidedAt =
    scenario.approval && scenario.approval.decision !== "PENDING" ? after(scenario.approval.afterHours) : null;
  const startedAt = after(scenario.startAfterHours);
  const completedAt = after(scenario.completeAfterHours);
  const cancelledAt =
    scenario.approval?.decision === "REJECTED" ? decidedAt : after(scenario.cancel?.afterHours);
  const changes = [openedAt, decidedAt, startedAt, completedAt, cancelledAt].filter((date): date is Date => date !== null);

  return {
    openedAt,
    decidedAt,
    assignedAt: startedAt ? new Date(startedAt.getTime() - ASSUME_BEFORE_START_MS) : null,
    startedAt,
    completedAt,
    cancelledAt,
    updatedAt: new Date(Math.max(...changes.map((date) => date.getTime()))),
  };
}

export function hoursAfterOpening(openedAt: Date, hours: number): Date {
  return new Date(openedAt.getTime() + hours * HOUR_MS);
}

/**
 * Checks that a scenario can exist through the real rules: the steps match the outcome, an
 * approval exists only where the service requires it and comes before the start, and nothing
 * happens after `now`. Returns the problems found (empty when coherent).
 */
export function demoScenarioProblems(scenario: DemoRequestScenario, now: Date): string[] {
  const problems: string[] = [];
  const timeline = demoTimeline(scenario, now);
  const requiresApproval = DEMO_SERVICE_SETTINGS[scenario.service]?.requiresApproval ?? false;
  const started = timeline.startedAt !== null;
  const completed = timeline.completedAt !== null;
  const cancelled = timeline.cancelledAt !== null;

  const expected: Record<DemoOutcome, boolean> = {
    OPEN: !started && !completed && !cancelled,
    IN_PROGRESS: started && !completed && !cancelled,
    COMPLETED: started && completed && !cancelled,
    CANCELLED: cancelled && !completed,
  };
  if (!expected[scenario.outcome]) problems.push("steps do not match the outcome");
  if (Boolean(scenario.approval) !== requiresApproval) problems.push("approval does not match the service");
  if (scenario.approval?.decision === "PENDING" && scenario.outcome !== "OPEN") problems.push("pending approval must stay open");
  if (scenario.approval?.decision === "REJECTED" && (scenario.outcome !== "CANCELLED" || scenario.cancel)) {
    problems.push("a rejection is the cancellation");
  }
  if (started && requiresApproval && scenario.approval?.decision !== "APPROVED") problems.push("started without approval");
  if (started && timeline.decidedAt && timeline.decidedAt >= (timeline.assignedAt ?? timeline.startedAt!)) {
    problems.push("started before the decision");
  }
  if (completed && timeline.completedAt! <= timeline.startedAt!) problems.push("completed before the start");
  if (scenario.cancel && started) problems.push("the requester cancels only before the start");

  const last = Math.max(
    timeline.updatedAt.getTime(),
    ...(scenario.comments ?? []).map((comment) => hoursAfterOpening(timeline.openedAt, comment.afterHours).getTime()),
  );
  if (last >= now.getTime()) problems.push("something happens after now");

  return problems;
}
