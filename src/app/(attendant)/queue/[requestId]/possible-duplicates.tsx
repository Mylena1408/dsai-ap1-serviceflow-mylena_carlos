import Link from "next/link";
import { POSSIBLE_DUPLICATE_DAYS, type PossibleDuplicateView } from "@/modules/requests";
import { REQUEST_STATUS_LABELS } from "@/app/_components/request-status";
import { requestShortCode } from "@/shared/requests";
import { linkRequestAction } from "../link-actions";

// SPEC 2026-11-08-atendimento-dia-a-dia, 13.5 item 1 (SF-232; decision J9): for the team, the requests of the same
// requester and service opened close to this one and still open, with a shortcut to link this one as their duplicate
// (the links' rules decide; the page shows their refusal as for the links form).

const openedAt = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" });

export function PossibleDuplicates({
  requestId,
  suggestions,
  canLink,
}: {
  requestId: string;
  suggestions: readonly PossibleDuplicateView[];
  /** Whether this request may still become a duplicate: open or in progress, without an original yet. */
  canLink: boolean;
}) {
  if (suggestions.length === 0) return null;
  return (
    <section aria-labelledby="possible-duplicates-title" className="surface-card content-section">
      <h2 id="possible-duplicates-title">Possíveis duplicadas</h2>
      <p>
        Do mesmo solicitante e do mesmo serviço, abertas até {POSSIBLE_DUPLICATE_DAYS} dias antes ou depois desta e ainda não
        encerradas.
      </p>
      <ul aria-label="Possíveis duplicadas" className="content-list">
        {suggestions.map((suggestion) => {
          const code = requestShortCode(suggestion.id);
          return (
            <li key={suggestion.id}>
              {suggestion.readable ? <Link href={`/queue/${suggestion.id}`}>#{code}</Link> : <>#{code}</>} ·{" "}
              {suggestion.serviceName} · {REQUEST_STATUS_LABELS[suggestion.status]} · Setor: {suggestion.sectorName} · aberta
              em {openedAt.format(suggestion.createdAt)}
              {canLink && suggestion.readable ? (
                <form action={linkRequestAction} className="inline-form">
                  <input name="requestId" type="hidden" value={requestId} />
                  <input name="code" type="hidden" value={code} />
                  <input name="kind" type="hidden" value="DUPLICATE_OF" />
                  <button type="submit">Vincular esta como duplicada de #{code}</button>
                </form>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
