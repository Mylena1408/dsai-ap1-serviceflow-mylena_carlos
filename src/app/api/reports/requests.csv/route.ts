import { exportDashboardCsv } from "@/modules/reports";
import { ApplicationError, AuthenticationError, AuthorizationError, ValidationError } from "@/server/errors";

// CSV export of the dashboard (SPEC 2026-11-02-painel-relatorios, 5.4). Same scope and period as
// the dashboard, checked again here; a refusal answers with a short message in Portuguese,
// because the person opened the link from the dashboard.

const NO_STORE = "private, no-store";

function refusal(error: ApplicationError): Response {
  let message = "Não foi possível exportar. Volte ao painel e tente de novo.";

  if (error instanceof AuthenticationError) {
    message = "Entre no ServiceFlow para exportar.";
  } else if (error instanceof AuthorizationError) {
    message = "Você não tem acesso a esta exportação.";
  } else if (error instanceof ValidationError) {
    const issue = error.issues[0];
    message =
      issue?.code === "too_big"
        ? "A exportação passa de 10.000 solicitações. Escolha um período menor."
        : issue?.path.includes("sector")
          ? "Setor não encontrado. Volte ao painel e escolha outro setor."
          : "Período inválido. Volte ao painel e escolha outro período.";
  }

  return new Response(message, {
    status: error.status,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": NO_STORE,
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const params = Object.fromEntries(
    ["period", "from", "to", "sector"].flatMap((name) => {
      const value = url.searchParams.get(name);
      return value === null ? [] : [[name, value]];
    }),
  );

  try {
    const csv = await exportDashboardCsv(params);

    return new Response(csv.content, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${csv.fileName}"`,
        "Cache-Control": NO_STORE,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof ApplicationError) {
      return refusal(error);
    }

    throw error;
  }
}
