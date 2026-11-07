import { expect, test, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { seedDemoData } from "../../scripts/demo-data";
import { ENTRANCE } from "./entrance";

// SPEC 2026-11-06-aprofundamento-configurabilidade, section 8, part E (SF-174; CA-ESR-02 to 06
// through the screens): the administrator creates a rule in "Setores", a request two days overdue is
// processed by the protected daily job route, the rule raises it, hands it to the attendant and
// warns the manager; the detail shows the application and the history names the system.

const unique = `e2e-regra-${Date.now()}`;
const ruleName = `${unique} Atraso`;

async function enterAs(page: Page, profile: "Administrador" | "Gestor" | "Atendente") {
  await page.goto("/");
  await page.waitForLoadState("networkidle"); // buttons only work after hydration
  await page.getByRole("button", { name: `Entrar como ${profile}` }).click();
  await expect(page).not.toHaveURL(ENTRANCE);
}

async function signOut(page: Page) {
  await page.getByRole("button", { name: "Sair" }).click();
  await expect(page).toHaveURL(ENTRANCE);
}

test("an escalation rule raises, hands over and warns through the daily job", async ({ page, playwright }) => {
  test.setTimeout(240_000);
  const database = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL, log: [] });
  let requestId = "";
  try {
    await seedDemoData(database);
    await database.sector.updateMany({ data: { escalateOverdue: false } });
    await database.sectorEscalationRule.deleteMany();
    // An open, unassigned request of the sector, two days overdue, with a NORMAL priority.
    const request = await database.request.findFirstOrThrow({
      where: { status: "OPEN", approvalState: null, assigneeId: null, sector: { name: "Central de Serviços" } },
    });
    await database.requestEscalation.deleteMany({ where: { requestId: request.id } });
    await database.request.update({
      where: { id: request.id },
      data: {
        priority: "NORMAL",
        slaHoursSnapshot: 8,
        dueAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000 - 60 * 60 * 1000),
        slaWarningNotifiedAt: null,
        slaBreachNotifiedAt: null,
        slaPausedAt: null,
      },
    });
    requestId = request.id;

    // The administrator creates the rule (CA-ESR-02).
    await enterAs(page, "Administrador");
    await page.goto("/admin?section=sectors");
    const panel = page.getByRole("region", { name: "Regras de escalonamento de Central de Serviços" });
    await panel.getByText("Nova regra").click();
    const form = panel.getByRole("form", { name: "Nova regra de Central de Serviços" });
    await form.locator('[name="name"]').fill(ruleName);
    await form.locator('[name="trigger"]').selectOption("OVERDUE_DAYS");
    await form.locator('[name="overdueDays"]').fill("1");
    // Nothing to do and nobody to warn: refused by the server.
    await form.getByRole("button", { name: "Criar regra" }).click();
    await expect(page.locator("p.feedback-error")).toHaveText("Escolha pelo menos uma ação ou uma pessoa para avisar.");

    await panel.getByText("Nova regra").click();
    await form.locator('[name="name"]').fill(ruleName);
    await form.locator('[name="trigger"]').selectOption("OVERDUE_DAYS");
    await form.locator('[name="overdueDays"]').fill("1");
    await form.getByLabel("Subir a prioridade um nível").check();
    await form.locator('[name="assignToId"]').selectOption({ label: "Diego Rocha" });
    await form.getByLabel(/Paulo Ribeiro \(gestor\)/).check();
    await form.getByRole("button", { name: "Criar regra" }).click();
    await expect(page.locator("p.feedback")).toHaveText("Regra de escalonamento criada.");
    await expect(panel).toContainText(`${ruleName}`);
    await expect(panel).toContainText("Vencida há 1 dia: Sobe a prioridade · Atribui a Diego Rocha · Avisa Paulo Ribeiro");

    // The audit trail records it (CA-ESR-02).
    await page.goto("/admin?section=audit&type=ESCALATION_RULE");
    await expect(page.getByRole("region", { name: "Auditoria" })).toContainText(`Criou · Regra de escalonamento · ${ruleName}`);
    await signOut(page);

    // The daily job runs as Vercel Cron calls it (CA-ESR-03).
    const api = await playwright.request.newContext({ baseURL: "http://127.0.0.1:3100" });
    const run = await api.get("/api/cron/daily", { headers: { authorization: `Bearer ${process.env.E2E_CRON_SECRET}` } });
    expect(run.status()).toBe(200);
    expect((await run.json()).escalationRules).toMatchObject({ status: "ok" });
    await api.dispose();

    // The attendant received the request from the system (CA-ESR-04, decision G17).
    await enterAs(page, "Atendente");
    await page.goto("/queue/notifications");
    await expect(page.getByText(/Uma solicitação foi transferida para você/).first()).toBeVisible();
    await page.goto(`/queue/${requestId}`);
    await expect(page.locator("ol.history-list")).toContainText("Atribuída a Diego Rocha pela regra de escalonamento");
    await expect(page.locator("ol.history-list")).toContainText("Sistema (regra de escalonamento)");
    // The detail shows the application with its trigger and actions (CA-ESR-06).
    await expect(page.getByRole("region", { name: "Escalonamentos" })).toContainText(
      `Regra "${ruleName}" (vencida há 1 dia): prioridade Normal → Alta · atribuída a Diego Rocha · 1 pessoa avisada.`,
    );
    await signOut(page);

    // The manager got the rule's warning (CA-ESR-05).
    await enterAs(page, "Gestor");
    await page.goto("/approvals/notifications");
    await expect(page.getByText(`Escalonamento "${ruleName}"`).first()).toBeVisible();
  } finally {
    // Later tests of the run start without rules.
    await database.sectorEscalationRule.deleteMany();
    await database.$disconnect();
  }
});
