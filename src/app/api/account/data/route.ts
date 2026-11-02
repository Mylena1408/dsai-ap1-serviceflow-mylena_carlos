import { exportPersonalData } from "@/modules/audit";
import { ApplicationError, AuthenticationError } from "@/server/errors";

// "Meus dados" download (SPEC 2026-11-02-auditoria-lgpd, 5.4): the signed-in person's own data,
// never cached. The identity comes from the session; the URL carries nothing.

const NO_STORE = "private, no-store";

export async function GET() {
  try {
    const file = await exportPersonalData();

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
          ? "Entre no ServiceFlow para baixar seus dados."
          : "Não foi possível gerar o arquivo. Tente de novo.";
      return new Response(message, {
        status: error.status,
        headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": NO_STORE, "X-Content-Type-Options": "nosniff" },
      });
    }

    throw error;
  }
}
