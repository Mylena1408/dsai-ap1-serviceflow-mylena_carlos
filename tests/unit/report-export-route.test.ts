import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthenticationError, AuthorizationError, ValidationError } from "@/server/errors";

const reports = vi.hoisted(() => ({ exportDashboardCsv: vi.fn() }));
vi.mock("@/modules/reports", () => reports);

import { GET } from "@/app/api/reports/requests.csv/route";

// SPEC 2026-11-02-painel-relatorios, 5.4 (SF-100; CA-DASH-08).

const call = (query = "") => GET(new Request(`http://localhost:3100/api/reports/requests.csv${query}`));

describe("CSV export route (SF-100)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("downloads the file with its name, never cached", async () => {
    reports.exportDashboardCsv.mockResolvedValue({
      fileName: "serviceflow-solicitacoes-2026-10-01-a-2026-10-31.csv",
      content: "﻿Código;Serviço\r\n",
    });

    const response = await call("?period=custom&from=2026-10-01&to=2026-10-31&sector=s1&q=ignored");

    expect(reports.exportDashboardCsv).toHaveBeenCalledWith({
      period: "custom",
      from: "2026-10-01",
      to: "2026-10-31",
      sector: "s1",
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    expect(response.headers.get("Content-Disposition")).toBe(
      'attachment; filename="serviceflow-solicitacoes-2026-10-01-a-2026-10-31.csv"',
    );
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(new Uint8Array(await response.arrayBuffer()).slice(0, 3)).toEqual(new Uint8Array([0xef, 0xbb, 0xbf]));
  });

  it("passes no parameter that was not in the URL", async () => {
    reports.exportDashboardCsv.mockResolvedValue({ fileName: "f.csv", content: "" });

    await call();

    expect(reports.exportDashboardCsv).toHaveBeenCalledWith({});
  });

  it.each([
    [new AuthenticationError(), 401, "Entre no ServiceFlow para exportar."],
    [new AuthorizationError(), 403, "Você não tem acesso a esta exportação."],
    [
      new ValidationError([{ path: ["period"], code: "too_big" }]),
      400,
      "A exportação passa de 10.000 solicitações. Escolha um período menor.",
    ],
    [
      new ValidationError([{ path: ["period"], code: "invalid_value" }]),
      400,
      "Período inválido. Volte ao painel e escolha outro período.",
    ],
    [
      new ValidationError([{ path: ["sector"], code: "invalid_value" }]),
      400,
      "Setor não encontrado. Volte ao painel e escolha outro setor.",
    ],
  ])("answers a refusal with a short message (%s)", async (error, status, message) => {
    reports.exportDashboardCsv.mockRejectedValue(error);

    const response = await call();

    expect(response.status).toBe(status);
    expect(response.headers.get("Content-Type")).toBe("text/plain; charset=utf-8");
    expect(await response.text()).toBe(message);
  });

  it("does not hide unexpected errors", async () => {
    reports.exportDashboardCsv.mockRejectedValue(new Error("database down"));

    await expect(call()).rejects.toThrow("database down");
  });
});
