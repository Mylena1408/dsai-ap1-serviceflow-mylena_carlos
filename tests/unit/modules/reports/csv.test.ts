import { describe, expect, it } from "vitest";
import {
  REPORT_CSV_COLUMNS,
  REPORT_CSV_MAX_ROWS,
  assertReportCsvSize,
  buildRequestsCsv,
  csvField,
  reportCsvFileName,
  type ReportCsvRow,
} from "@/modules/reports/domain/csv";
import { ValidationError } from "@/server/errors";

// SPEC 2026-11-02-painel-relatorios, 5.4 (SF-097; CA-DASH-08 and CA-DASH-09).

const completed: ReportCsvRow = {
  id: "3f2a9c1e-0000-4000-8000-000000000001",
  serviceName: "Reparo elétrico",
  categoryName: "Manutenção",
  sectorName: "Infraestrutura",
  status: "COMPLETED",
  priority: "HIGH",
  approvalState: "APPROVED",
  stageName: "Execução",
  assigneeName: "Diego Rocha",
  createdAt: new Date("2026-10-30T12:05:00.000Z"),
  completedAt: new Date("2026-11-01T02:59:00.000Z"),
  cancelledAt: null,
  dueAt: new Date("2026-11-01T12:05:00.000Z"),
  slaSituation: "completed_on_time",
  completedLate: false,
};

const open: ReportCsvRow = {
  id: "a1b2c3d4-0000-4000-8000-000000000002",
  serviceName: "Declaração de vínculo",
  categoryName: "Documentos",
  sectorName: "Recursos humanos",
  status: "OPEN",
  priority: "NORMAL",
  approvalState: null,
  stageName: null,
  assigneeName: null,
  createdAt: new Date("2026-11-02T13:00:00.000Z"),
  completedAt: null,
  cancelledAt: null,
  dueAt: null,
  slaSituation: "none",
  completedLate: null,
};

function lines(csv: string): string[] {
  return csv.slice(1).split("\r\n");
}

describe("CSV of the dashboard requests (CA-DASH-08)", () => {
  it("starts with a byte order mark and has the columns of 5.4, in order, separated by semicolons", () => {
    const csv = buildRequestsCsv([]);

    expect(csv.startsWith("﻿")).toBe(true);
    expect(lines(csv)).toEqual([REPORT_CSV_COLUMNS.join(";"), ""]);
    expect(REPORT_CSV_COLUMNS).toEqual([
      "Código",
      "Serviço",
      "Categoria",
      "Setor",
      "Status",
      "Prioridade",
      "Aprovação",
      "Etapa atual",
      "Responsável",
      "Aberta em",
      "Concluída em",
      "Cancelada em",
      "Vencimento",
      "Situação do prazo",
      "Concluída no prazo",
    ]);
  });

  it("writes each request with Portuguese names and São Paulo dates", () => {
    const [, first, second, end] = lines(buildRequestsCsv([completed, open]));

    expect(first).toBe(
      "3F2A9C1E;Reparo elétrico;Manutenção;Infraestrutura;Concluída;Alta;Aprovada;Execução;Diego Rocha;" +
        "2026-10-30 09:05;2026-10-31 23:59;;2026-11-01 09:05;Concluída no prazo;Sim",
    );
    expect(second).toBe("A1B2C3D4;Declaração de vínculo;Documentos;Recursos humanos;Aberta;Normal;;;;2026-11-02 10:00;;;;Sem prazo;");
    expect(end).toBe("");
  });

  it("says whether a completed request with a due date finished on time, and nothing otherwise", () => {
    const late = { ...completed, slaSituation: "completed_late" as const, completedLate: true };
    const overdue = { ...completed, status: "IN_PROGRESS" as const, completedAt: null, slaSituation: "overdue" as const, completedLate: null };
    const cancelled = { ...open, status: "CANCELLED" as const, cancelledAt: new Date("2026-11-02T14:00:00.000Z") };

    const [, lateLine, overdueLine, cancelledLine] = lines(buildRequestsCsv([late, overdue, cancelled]));
    expect(lateLine.endsWith(";Concluída com atraso;Não")).toBe(true);
    expect(overdueLine.endsWith(";Vencido;")).toBe(true);
    expect(cancelledLine).toContain(";Cancelada;");
    expect(cancelledLine.endsWith(";2026-11-02 11:00;;Sem prazo;")).toBe(true);
  });

  it("neutralizes values a spreadsheet would run as formulas", () => {
    expect(csvField("=HYPERLINK(\"http://x\")")).toBe("\"'=HYPERLINK(\"\"http://x\"\")\"");
    expect(csvField("+55 91")).toBe("'+55 91");
    expect(csvField("-1")).toBe("'-1");
    expect(csvField("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(csvField("\tcmd")).toBe("'\tcmd");
    expect(csvField("Reparo - sala 2")).toBe("Reparo - sala 2");

    const [, line] = lines(buildRequestsCsv([{ ...open, serviceName: "=1+1", assigneeName: "@Ana" }]));
    expect(line).toContain(";'=1+1;");
    expect(line).toContain(";'@Ana;");
  });

  it("quotes values with the separator, quotes or line breaks", () => {
    expect(csvField("TI; suporte")).toBe("\"TI; suporte\"");
    expect(csvField("Sala \"A\"")).toBe("\"Sala \"\"A\"\"\"");
    expect(csvField("linha 1\nlinha 2")).toBe("\"linha 1\nlinha 2\"");
    expect(csvField("Simples")).toBe("Simples");
  });

  it("accepts up to 10,000 rows and refuses more", () => {
    expect(REPORT_CSV_MAX_ROWS).toBe(10_000);
    expect(() => assertReportCsvSize(10_000)).not.toThrow();
    expect(() => assertReportCsvSize(10_001)).toThrow(ValidationError);
    expect(() => buildRequestsCsv(Array.from({ length: 10_001 }, () => open))).toThrow(ValidationError);
  });

  it("names the file after the period", () => {
    expect(reportCsvFileName({ firstDay: "2026-10-04", lastDay: "2026-11-02" })).toBe(
      "serviceflow-solicitacoes-2026-10-04-a-2026-11-02.csv",
    );
  });
});

describe("what never reaches the CSV (CA-DASH-09)", () => {
  it("writes only the minimal columns, even if a row carries more data by mistake", () => {
    const leaky = {
      ...open,
      description: "Senha do Wi-Fi anotada aqui",
      requesterName: "Carla Mendes",
      requesterEmail: "carla.mendes@exemplo.test",
      comments: ["nota interna"],
    } as ReportCsvRow;

    const csv = buildRequestsCsv([leaky]);
    for (const secret of ["Senha do Wi-Fi", "Carla Mendes", "carla.mendes", "nota interna"]) {
      expect(csv).not.toContain(secret);
    }
    expect(lines(csv)[1].split(";")).toHaveLength(REPORT_CSV_COLUMNS.length);
  });
});
