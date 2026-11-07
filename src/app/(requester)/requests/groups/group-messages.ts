// Messages of the bundle page (SPEC 2026-11-07-operacao-e-automacao, 3.3 item 4).

const plural = (count: number, one: string, many: string) => (count === 1 ? `1 ${one}` : `${count} ${many}`);

/** After cancelling the bundle: how many were cancelled and how many stay as they are. */
export function cancellationMessage(cancelled: number, kept: number): string {
  const done = cancelled === 0 ? "Nenhuma solicitação foi cancelada." : `${plural(cancelled, "solicitação cancelada", "solicitações canceladas")}.`;
  if (kept === 0) return done;
  return `${done} ${plural(kept, "solicitação continua", "solicitações continuam")} como estava${kept === 1 ? "" : "m"}, porque já ${kept === 1 ? "está" : "estão"} em atendimento ou encerrada${kept === 1 ? "" : "s"}.`;
}

export function groupErrorMessage(error: string | undefined): string | null {
  if (error === "missing") return "Este pacote não está disponível.";
  if (error === "unexpected") return "Não foi possível cancelar o pacote. Tente novamente.";
  return null;
}

/** Reads a non-negative count from the address, or null. */
export function countParam(value: string | undefined): number | null {
  return value !== undefined && /^\d{1,2}$/.test(value) ? Number(value) : null;
}
