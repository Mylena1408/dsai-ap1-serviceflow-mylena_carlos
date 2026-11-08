import { expect, test, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { ENTRANCE } from "./entrance";
import { seedDemoData } from "../../scripts/demo-data";

// SPEC 2026-11-07-operacao-e-automacao, section 8, part E (SF-193; CA-LOT-03 and 04 through the screen): the
// attendant marks three requests of the page and assumes them; one already belongs to a colleague and is
// refused with its reason, without undoing the others; then the two assumed ones get a higher priority, and
// the history of each shows what the individual actions write. The concurrent batches are covered by
// queue-batch.test.ts.

const unique = `e2e-lote-${Date.now()}`;
const serviceName = `${unique} Suporte`;

async function enterAsAttendant(page: Page) {
  await page.goto("/");
  await page.waitForLoadState("networkidle"); // buttons only work after hydration
  await page.getByRole("button", { name: "Entrar como Atendente" }).click();
  await expect(page).not.toHaveURL(ENTRANCE);
}

// The colleague created here would take turns in the round-robin of later tests (queue-distribution.spec.ts
// expects Diego to be next): deactivated at the end, even when the test stops halfway.
test.afterEach(async () => {
  const database = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL, log: [] });
  try {
    await database.user.updateMany({ where: { email: `${unique}@example.test` }, data: { isActive: false } });
  } finally {
    await database.$disconnect();
  }
});

test("batch: assume three requests with one refused, then raise the priority of the assumed ones", async ({ page }) => {
  test.setTimeout(120_000);
  const database = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL, log: [] });
  const ids: string[] = [];
  try {
    await seedDemoData(database);
    const sector = await database.sector.findFirstOrThrow({ where: { name: "Central de Serviços" } });
    await database.sector.update({ where: { id: sector.id }, data: { distributionMode: "NONE" } });
    const category = await database.category.findFirstOrThrow({ where: { isActive: true } });
    const service = await database.service.create({ data: { name: serviceName, description: "Serviço do teste.", categoryId: category.id, sectorId: sector.id } });
    const requester = await database.user.findUniqueOrThrow({ where: { email: "ana.souza@exemplo.test" } });
    const colleague = await database.user.create({
      data: { name: `Bruno ${unique}`, email: `${unique}@example.test`, role: "ATTENDANT", sectorId: sector.id, passwordHash: "!e2e-unusable" },
    });
    for (let index = 0; index < 3; index += 1) {
      const request = await database.request.create({
        data: {
          requesterId: requester.id,
          serviceId: service.id,
          sectorId: sector.id,
          serviceNameSnapshot: service.name,
          serviceDescriptionSnapshot: service.description,
          categoryIdSnapshot: category.id,
          categoryNameSnapshot: category.name,
          sectorNameSnapshot: sector.name,
          description: `Pedido ${index + 1} do lote`,
          status: "OPEN",
          // The second one already belongs to the colleague.
          ...(index === 1 ? { assigneeId: colleague.id } : {}),
        },
      });
      ids.push(request.id);
    }
  } finally {
    await database.$disconnect();
  }
  const label = (id: string) => `${serviceName} (#${id.slice(0, 8)})`;

  await enterAsAttendant(page);
  // The search keeps the three requests on one page.
  await page.goto(`/queue?q=${encodeURIComponent(unique)}`);
  const batch = page.getByRole("region", { name: "Ações em lote" });
  for (const id of ids) await page.getByRole("checkbox", { name: `Marcar ${label(id)} para ação em lote` }).check();
  await batch.getByRole("button", { name: "Aplicar às marcadas" }).click();

  const result = batch.getByRole("status");
  await expect(result).toContainText("Assumir: 2 feitas, 1 recusada.");
  const items = batch.getByRole("list", { name: "Resultado por solicitação" });
  await expect(items).toContainText(`${label(ids[0])}: feito`);
  await expect(items).toContainText(`${label(ids[1])}: recusado (já tem responsável`);
  await expect(items).toContainText(`${label(ids[2])}: feito`);

  // The two assumed ones: a higher priority, the same for both.
  await page.goto(`/queue?q=${encodeURIComponent(unique)}`);
  for (const id of [ids[0], ids[2]]) await page.getByRole("checkbox", { name: `Marcar ${label(id)} para ação em lote` }).check();
  await batch.locator('select[name="action"]').selectOption("priority");
  await batch.locator('select[name="priority"]').selectOption("URGENT");
  await batch.getByRole("button", { name: "Aplicar às marcadas" }).click();
  await expect(batch.getByRole("status")).toContainText("Mudar a prioridade: 2 feitas, 0 recusadas.");

  // Each one has the history of the individual actions (CA-LOT-04).
  await page.goto(`/queue/${ids[0]}`);
  const history = page.locator("ol.history-list");
  await expect(history).toContainText("Diego Rocha");
  await expect(history).toContainText("Urgente");
});
