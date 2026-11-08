import { exportConfiguration } from "@/modules/configuration";
import { ApplicationError, AuthenticationError } from "@/server/errors";

// Download of the organization's configuration (SPEC 2026-11-07-operacao-e-automacao, 6.3 items 1 to 3):
// only the administrator, from the session; each download is an export and enters the audit trail. Never
// cached.

const NO_STORE = "private, no-store";

export async function GET() {
  try {
    const file = await exportConfiguration();

    return new Response(file.content, {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${file.fileName}"`,
        "Cache-Control": NO_STORE,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof ApplicationError) {
      const message =
        error instanceof AuthenticationError
          ? "Entre no ServiceFlow para exportar a configuração."
          : "Só o administrador exporta a configuração.";
      return new Response(message, {
        status: error.status,
        headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": NO_STORE, "X-Content-Type-Options": "nosniff" },
      });
    }

    throw error;
  }
}
