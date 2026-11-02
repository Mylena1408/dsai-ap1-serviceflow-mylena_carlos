import { describe, expect, it } from "vitest";
import { buildNotificationEmail, requestShortCode, type EmailContentSource } from "@/modules/notifications/domain/email-content";

// SPEC 2026-11-01-notificacoes-email-preferencias, 5.4 (SF-094; CA-MAIL-08).

const requestId = "3f2a9c1e-5b7d-4e2f-9a1b-0c8d7e6f5a4b";
const base: EmailContentSource = {
  type: "status.IN_PROGRESS",
  serviceName: "Troca de teclado",
  requestId,
  recipientRole: "REQUESTER",
};

describe("notification email content (SF-094)", () => {
  it("has the notification text, service, short code and both links (CA-MAIL-08)", () => {
    expect(buildNotificationEmail(base, "https://serviceflow.example/")).toEqual({
      subject: "[ServiceFlow] Atendimento iniciado: Troca de teclado",
      text: [
        "Atendimento iniciado: Troca de teclado",
        "",
        "Serviço: Troca de teclado",
        "Solicitação: 3F2A9C1E",
        `Abrir: https://serviceflow.example/requests/${requestId}`,
        "",
        "Os detalhes ficam no ServiceFlow, com as regras de acesso de sempre.",
        "Para escolher o que você recebe por e-mail: https://serviceflow.example/notifications/preferences",
      ].join("\n"),
    });
    expect(requestShortCode(requestId)).toBe("3F2A9C1E");
  });

  it("links to the area of the recipient", () => {
    const attendant = buildNotificationEmail({ ...base, type: "sla.breached", recipientRole: "ATTENDANT" }, "https://sf.example");
    expect(attendant.subject).toBe("[ServiceFlow] Prazo vencido: Troca de teclado");
    expect(attendant.text).toContain(`Abrir: https://sf.example/queue/${requestId}`);
    expect(attendant.text).toContain("https://sf.example/queue/notifications/preferences");

    const manager = buildNotificationEmail({ ...base, type: "approval.requested", recipientRole: "MANAGER" }, "https://sf.example");
    expect(manager.text).toContain(`Abrir: https://sf.example/approvals/${requestId}`);
    expect(manager.text).toContain("https://sf.example/approvals/notifications/preferences");
  });

  it("uses the stage name like the in-app list", () => {
    expect(buildNotificationEmail({ ...base, type: "stage.changed", stageName: "Execução" }, "https://sf.example").subject).toBe(
      "[ServiceFlow] Sua solicitação passou para a etapa Execução: Troca de teclado",
    );
  });

  it("never carries other data of the request, even if a caller passes it (CA-MAIL-08)", () => {
    const leaky = {
      ...base,
      type: "comment.internal",
      description: "Senha do Wi-Fi na descrição",
      body: "Texto da nota interna",
      answers: ["Resposta sigilosa"],
      remark: "Observação da aprovação",
    } as EmailContentSource;
    const email = buildNotificationEmail(leaky, "https://sf.example");

    expect(email.subject).toBe("[ServiceFlow] Nova nota interna em Troca de teclado");
    for (const secret of ["Wi-Fi", "nota interna\n", "Resposta sigilosa", "Observação da aprovação"]) {
      expect(`${email.subject}\n${email.text}`).not.toContain(secret);
    }
  });
});
