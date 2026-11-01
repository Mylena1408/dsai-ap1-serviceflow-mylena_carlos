import { randomBytes } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import {
  DEMO_ACCOUNTS,
  DEMO_SECTOR_NAME,
  type DemoRole,
} from "../src/modules/auth/domain/demo-accounts";
import { hashPassword } from "../src/modules/auth/infrastructure/argon2-password";
import { buildRequestSnapshot } from "../src/modules/requests/domain/snapshot";

// Fictitious demonstration data (SPEC 2026-09-30, sections 22.6 and 22.7). Loaded only on
// demand by `npm run seed:demo`; the product itself does not depend on these records.

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

type DemoServiceName = (typeof DEMO_CATALOG)[number]["services"][number]["name"];

// Reserved .test domain: these addresses can never reach a real mailbox.
export const DEMO_PEOPLE = {
  ana: { name: "Ana Souza", email: "ana.souza@exemplo.test", role: "REQUESTER" },
  bruno: { name: "Bruno Lima", email: "bruno.lima@exemplo.test", role: "REQUESTER" },
  carla: { name: "Carla Mendes", email: "carla.mendes@exemplo.test", role: "REQUESTER" },
  diego: { name: "Diego Rocha", email: "diego.rocha@exemplo.test", role: "ATTENDANT" },
} as const;

type Person = keyof typeof DEMO_PEOPLE | "demoRequester" | "demoAttendant";
type Status = "OPEN" | "IN_PROGRESS" | "COMPLETED";

export const DEMO_REQUESTS: ReadonlyArray<{
  requester: Person;
  attendant: Person;
  service: DemoServiceName;
  description: string;
  status: Status;
  daysAgo: number;
}> = [
  { requester: "demoRequester", attendant: "demoAttendant", service: "Solicitação de equipamento", description: "Preciso de um monitor adicional para trabalhar com planilhas.", status: "OPEN", daysAgo: 1 },
  { requester: "demoRequester", attendant: "demoAttendant", service: "Declaração de vínculo", description: "Declaração para apresentar no banco até sexta-feira.", status: "IN_PROGRESS", daysAgo: 3 },
  { requester: "demoRequester", attendant: "diego", service: "Reparo elétrico", description: "A tomada ao lado da minha mesa não está funcionando.", status: "COMPLETED", daysAgo: 9 },
  { requester: "ana", attendant: "demoAttendant", service: "Criação de conta de acesso", description: "Conta para o estagiário que começa na segunda-feira.", status: "OPEN", daysAgo: 0 },
  { requester: "ana", attendant: "diego", service: "Solicitação de férias", description: "Férias de 10 a 24 de dezembro.", status: "IN_PROGRESS", daysAgo: 2 },
  { requester: "ana", attendant: "demoAttendant", service: "Manutenção de ar-condicionado", description: "O ar-condicionado da sala 12 está pingando.", status: "COMPLETED", daysAgo: 12 },
  { requester: "bruno", attendant: "demoAttendant", service: "Redefinição de senha de sistema", description: "Fui bloqueado no sistema de compras após três tentativas.", status: "OPEN", daysAgo: 1 },
  { requester: "bruno", attendant: "diego", service: "Atualização cadastral", description: "Mudei de endereço e preciso atualizar meus dados.", status: "COMPLETED", daysAgo: 15 },
  { requester: "bruno", attendant: "demoAttendant", service: "Reparo de mobiliário", description: "A cadeira da estação 4 está com o encosto solto.", status: "IN_PROGRESS", daysAgo: 4 },
  { requester: "carla", attendant: "diego", service: "Solicitação de equipamento", description: "Teclado com teclas falhando; preciso de substituição.", status: "OPEN", daysAgo: 2 },
  { requester: "carla", attendant: "demoAttendant", service: "Declaração de vínculo", description: "Declaração para matrícula em curso de pós-graduação.", status: "COMPLETED", daysAgo: 20 },
  { requester: "carla", attendant: "diego", service: "Reparo elétrico", description: "Lâmpada queimada no corredor do segundo andar.", status: "OPEN", daysAgo: 0 },
];

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

// Example custom fields (SPEC 2026-11-01-campos-personalizados, section 3 item 6). The
// service is not used by the end-to-end flows, so their steps stay the same.
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

export interface DemoDataSummary {
  categories: number;
  services: number;
  users: number;
  requestsCreated: number;
  requirementsCreated: number;
}

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

async function ensureActiveByName(
  find: () => Promise<{ id: string; isActive: boolean } | null>,
  reactivate: (id: string) => Promise<unknown>,
  create: () => Promise<{ id: string }>,
): Promise<string> {
  const existing = await find();

  if (!existing) {
    return (await create()).id;
  }

  if (!existing.isActive) {
    await reactivate(existing.id);
  }

  return existing.id;
}

/** An Argon2id hash of a discarded random value: the account cannot use e-mail and password. */
function unusablePasswordHash(): Promise<string> {
  return hashPassword(randomBytes(32).toString("base64"));
}

/** Creates or restores the demonstration data without duplicating records. */
export async function seedDemoData(
  database: PrismaClient,
  now: Date = new Date(),
): Promise<DemoDataSummary> {
  const people: Record<Person, { name: string; email: string; role: DemoRole }> = {
    ...DEMO_PEOPLE,
    demoRequester: { ...DEMO_ACCOUNTS.REQUESTER, role: "REQUESTER" },
    demoAttendant: { ...DEMO_ACCOUNTS.ATTENDANT, role: "ATTENDANT" },
  };
  const everyone = { ...people, demoAdmin: { ...DEMO_ACCOUNTS.ADMIN, role: "ADMIN" as const } };

  // Argon2 is slow on purpose, so hashes for missing users are computed outside the transaction.
  const existingEmails = new Set(
    (
      await database.user.findMany({
        where: { email: { in: Object.values(everyone).map(({ email }) => email) } },
        select: { email: true },
      })
    ).map(({ email }) => email.toLowerCase()),
  );
  const newHashes = new Map<string, string>();
  for (const { email } of Object.values(everyone)) {
    if (!existingEmails.has(email.toLowerCase())) {
      newHashes.set(email, await unusablePasswordHash());
    }
  }

  return database.$transaction(
    async (transaction) => {
      const sectorId = await ensureActiveByName(
        () =>
          transaction.sector.findFirst({
            where: { name: DEMO_SECTOR_NAME },
            orderBy: [{ isActive: "desc" }, { createdAt: "asc" }],
            select: { id: true, isActive: true },
          }),
        (id) => transaction.sector.update({ where: { id }, data: { isActive: true } }),
        () => transaction.sector.create({ data: { name: DEMO_SECTOR_NAME }, select: { id: true } }),
      );
      const sector = { id: sectorId, name: DEMO_SECTOR_NAME };

      const services = new Map<
        DemoServiceName,
        { id: string; name: string; description: string; category: { id: string; name: string } }
      >();

      for (const group of DEMO_CATALOG) {
        const categoryId = await ensureActiveByName(
          () =>
            transaction.category.findFirst({
              where: { name: group.category },
              orderBy: [{ isActive: "desc" }, { createdAt: "asc" }],
              select: { id: true, isActive: true },
            }),
          (id) => transaction.category.update({ where: { id }, data: { isActive: true } }),
          () => transaction.category.create({ data: { name: group.category }, select: { id: true } }),
        );

        for (const service of group.services) {
          const existing = await transaction.service.findFirst({
            where: { name: service.name, categoryId },
            orderBy: [{ isActive: "desc" }, { createdAt: "asc" }],
            select: { id: true },
          });
          const saved = existing
            ? await transaction.service.update({
                where: { id: existing.id },
                data: { description: service.description, sectorId, isActive: true },
                select: { id: true },
              })
            : await transaction.service.create({
                data: { ...service, categoryId, sectorId },
                select: { id: true },
              });

          services.set(service.name, {
            id: saved.id,
            name: service.name,
            description: service.description,
            category: { id: categoryId, name: group.category },
          });
        }
      }

      const userIds = {} as Record<keyof typeof everyone, string>;

      for (const [key, person] of Object.entries(everyone) as Array<
        [keyof typeof everyone, (typeof everyone)[keyof typeof everyone]]
      >) {
        const data = {
          name: person.name,
          role: person.role,
          sectorId: person.role === "ATTENDANT" ? sectorId : null,
          isActive: true,
        };
        const current = await transaction.user.findUnique({
          where: { email: person.email },
          select: { id: true },
        });
        const saved = current
          ? await transaction.user.update({ where: { id: current.id }, data, select: { id: true } })
          : await transaction.user.create({
              data: {
                ...data,
                email: person.email,
                passwordHash: newHashes.get(person.email) ?? (await unusablePasswordHash()),
              },
              select: { id: true },
            });
        userIds[key] = saved.id;
      }

      // Requests are created only once: the fictitious requesters' history marks a previous run.
      const previousRequests = await transaction.request.count({
        where: { requesterId: { in: [userIds.ana, userIds.bruno, userIds.carla] } },
      });
      let requestsCreated = 0;

      if (previousRequests === 0) {
        for (const item of DEMO_REQUESTS) {
          const service = services.get(item.service);
          if (!service) throw new Error(`Unknown demonstration service: ${item.service}`);

          const openedAt = new Date(now.getTime() - item.daysAgo * DAY - 3 * HOUR);
          const startedAt = new Date(openedAt.getTime() + 2 * HOUR);
          const completedAt = new Date(openedAt.getTime() + 26 * HOUR);
          const lastChange =
            item.status === "COMPLETED" ? completedAt : item.status === "IN_PROGRESS" ? startedAt : openedAt;
          const requesterId = userIds[item.requester];
          const attendantId = userIds[item.attendant];

          const request = await transaction.request.create({
            data: {
              ...buildRequestSnapshot(requesterId, { ...service, sector }),
              description: item.description,
              status: item.status,
              createdAt: openedAt,
              updatedAt: lastChange,
              completedAt: item.status === "COMPLETED" ? completedAt : null,
            },
            select: { id: true },
          });

          const events: Prisma.RequestStatusEventCreateManyInput[] = [
            { requestId: request.id, actorId: requesterId, fromStatus: null, toStatus: "OPEN", occurredAt: openedAt },
          ];
          if (item.status !== "OPEN") {
            events.push({ requestId: request.id, actorId: attendantId, fromStatus: "OPEN", toStatus: "IN_PROGRESS", occurredAt: startedAt });
          }
          if (item.status === "COMPLETED") {
            events.push({ requestId: request.id, actorId: attendantId, fromStatus: "IN_PROGRESS", toStatus: "COMPLETED", occurredAt: completedAt });
          }
          await transaction.requestStatusEvent.createMany({ data: events });
          requestsCreated += 1;
        }
      }

      let requirementsCreated = 0;

      for (const { service: serviceName, requirements } of DEMO_DOCUMENT_REQUIREMENTS) {
        const service = services.get(serviceName);
        if (!service) throw new Error(`Unknown demonstration service: ${serviceName}`);

        const existing = await transaction.serviceDocumentRequirement.count({
          where: { serviceId: service.id },
        });
        if (existing > 0) continue;

        await transaction.serviceDocumentRequirement.createMany({
          data: requirements.map((requirement, position) => ({
            serviceId: service.id,
            name: requirement.name,
            isRequired: requirement.isRequired,
            acceptedFormats: [...requirement.acceptedFormats],
            position,
          })),
        });
        requirementsCreated += requirements.length;
      }

      for (const { service: serviceName, fields } of DEMO_SERVICE_FIELDS) {
        const service = services.get(serviceName);
        if (!service) throw new Error(`Unknown demonstration service: ${serviceName}`);

        // Like the requirements, a service already configured (even by hand) is left alone.
        if ((await transaction.serviceField.count({ where: { serviceId: service.id } })) > 0) continue;

        await transaction.serviceField.createMany({
          data: fields.map((field, position) => ({
            serviceId: service.id,
            label: field.label,
            helpText: field.helpText ?? null,
            type: field.type,
            isRequired: field.isRequired,
            options: [...(field.options ?? [])],
            minValue: field.minValue ?? null,
            maxValue: field.maxValue ?? null,
            position,
          })),
        });
      }

      return {
        categories: DEMO_CATALOG.length,
        services: services.size,
        users: Object.keys(userIds).length,
        requestsCreated,
        requirementsCreated,
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30_000 },
  );
}
