import { MAX_SATISFACTION_COMMENT_LENGTH, SATISFACTION_RATINGS, type RequestSatisfactionView } from "@/modules/requests";

// Satisfaction survey screens (SPEC 2026-11-06-pesquisa-satisfacao, 2 and 4): the form and the
// result for the requester, and the rating as the sector's team and the manager read it.

export const RATING_LABELS: Record<number, string> = {
  1: "Muito insatisfeito",
  2: "Insatisfeito",
  3: "Neutro",
  4: "Satisfeito",
  5: "Muito satisfeito",
};

function day(value: Date): string {
  return value.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

function moment(value: Date): string {
  return value.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });
}

function Stars({ rating }: { rating: number }) {
  return (
    <span className="rating-stars" aria-hidden="true">
      {"★".repeat(rating)}
      <span className="rating-stars-empty">{"★".repeat(5 - rating)}</span>
    </span>
  );
}

function RatingResult({ view, own }: { view: RequestSatisfactionView; own: boolean }) {
  const current = view.current!;
  return (
    <div className="satisfaction-result">
      <p>
        <Stars rating={current.rating} />{" "}
        <strong>
          {current.rating} de 5 · {RATING_LABELS[current.rating]}
        </strong>{" "}
        <span className="metadata">
          {own ? "você avaliou" : "avaliado"} em {day(current.ratedAt)}
        </span>
      </p>
      {current.comment ? <p className="request-description">{current.comment}</p> : null}
      {view.history.length > 1 ? (
        <details>
          <summary>Avaliações anteriores</summary>
          <ul className="content-list">
            {view.history.slice(0, -1).map((entry) => (
              <li key={entry.occurredAt.toISOString()}>
                {entry.rating} de 5 em {moment(entry.occurredAt)}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

/** The requester's own block: the form while available, then the result (4.1 to 4.3). */
export function RequesterSatisfaction({
  requestId,
  view,
  action,
}: {
  requestId: string;
  view: RequestSatisfactionView;
  action: (formData: FormData) => Promise<never>;
}) {
  if (view.availability === "not_completed" && !view.current) return null;
  const ratedNow = view.availability === "rated";

  return (
    <section className="surface-card content-section" aria-labelledby="satisfaction-heading">
      <h2 id="satisfaction-heading">Como foi o atendimento?</h2>
      {ratedNow || (view.current && view.availability !== "available") ? <RatingResult view={view} own /> : null}
      {view.availability === "available" ? (
        <form action={action} className="satisfaction-form">
          <input type="hidden" name="requestId" value={requestId} />
          {view.current ? (
            <p className="metadata">
              A solicitação foi concluída de novo. A sua avaliação anterior foi {view.current.rating} de 5; a nova vai substituí-la.
            </p>
          ) : null}
          <fieldset>
            <legend>Sua nota (obrigatória)</legend>
            <div className="rating-options">
              {SATISFACTION_RATINGS.map((rating) => (
                <label key={rating}>
                  <input type="radio" name="rating" value={rating} required />
                  <span>
                    {rating} · {RATING_LABELS[rating]}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          <label htmlFor="satisfaction-comment">Quer contar mais? (opcional)</label>
          <textarea id="satisfaction-comment" name="comment" maxLength={MAX_SATISFACTION_COMMENT_LENGTH} rows={3} />
          <button type="submit">Enviar avaliação</button>
          {view.deadline ? <p className="metadata">Você pode avaliar até {day(view.deadline)}. Só a equipe do setor vê o comentário.</p> : null}
        </form>
      ) : null}
      {view.availability === "expired" && !view.current && view.deadline ? (
        <p className="metadata">O prazo para avaliar terminou em {day(view.deadline)}.</p>
      ) : null}
    </section>
  );
}

/** The rating as the sector's team or a manager sees it (4.6). */
export function TeamSatisfaction({ view }: { view: RequestSatisfactionView }) {
  if (!view.current) return null;
  return (
    <section className="surface-card content-section" aria-labelledby="satisfaction-team-heading">
      <h2 id="satisfaction-team-heading">Avaliação do solicitante</h2>
      <RatingResult view={view} own={false} />
    </section>
  );
}
