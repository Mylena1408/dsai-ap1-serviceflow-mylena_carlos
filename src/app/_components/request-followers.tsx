import { MAX_COLLEAGUE_FOLLOWERS, type RequestFollowersView } from "@/modules/followers";
import { addColleagueAction, followRequestAction, removeFollowerAction } from "./follower-actions";

// Who follows a request (SPEC 2026-11-08-atendimento-dia-a-dia, 6.3 items 1 and 4 and 13.3 item 3): the names, without
// contact data; the requester adds colleagues by e-mail and removes them; an attendant of the sector follows and stops
// following; a colleague who follows stops following; the manager only reads.

const MESSAGES: Record<string, { text: string; error: boolean }> = {
  "follow-added": { text: "Colega incluído. Ele passa a receber os avisos desta solicitação.", error: false },
  "follow-removed": { text: "Colega retirado.", error: false },
  "follow-following": { text: "Você passou a acompanhar esta solicitação.", error: false },
  "follow-stopped": { text: "Você deixou de acompanhar a solicitação.", error: false },
  "follow-invalid": {
    text: "Não foi possível incluir: confira o e-mail. Só colegas com conta ativa de solicitante podem acompanhar.",
    error: true,
  },
  "follow-limit": { text: `A solicitação já tem ${MAX_COLLEAGUE_FOLLOWERS} colegas acompanhando.`, error: true },
  "follow-conflict": { text: "Essa pessoa já acompanha, ou deixou de acompanhar enquanto você agia.", error: true },
  "follow-missing": { text: "A solicitação não está disponível para você.", error: true },
};

export function followMessage(code: string | undefined): { text: string; error: boolean } | null {
  return code ? (MESSAGES[code] ?? null) : null;
}

type Area = "requester" | "queue" | "following" | "manager";

export function RequestFollowers({
  requestId,
  view,
  area,
  message,
}: {
  requestId: string;
  view: RequestFollowersView;
  area: Area;
  message?: string;
}) {
  const feedback = followMessage(message);
  const canAct = area !== "manager";

  return (
    <section aria-labelledby="followers-heading" className="surface-card content-section" id="followers">
      <h2 id="followers-heading">Acompanham</h2>
      {feedback ? (
        <p className={`feedback${feedback.error ? " feedback-error" : ""}`} role={feedback.error ? "alert" : "status"}>
          {feedback.text}
        </p>
      ) : null}
      {view.followers.length === 0 ? (
        <p className="section-description">Ninguém acompanha esta solicitação além de quem a abriu.</p>
      ) : (
        <ul aria-label="Quem acompanha" className="entity-list">
          {view.followers.map((follower) => (
            <li key={follower.userId}>
              {follower.name} <span className="section-description">({follower.kind === "colleague" ? "colega" : "equipe"})</span>
              {canAct && view.removableIds.includes(follower.userId) ? (
                <form action={removeFollowerAction}>
                  <input name="area" type="hidden" value={area} />
                  <input name="requestId" type="hidden" value={requestId} />
                  <input name="userId" type="hidden" value={follower.userId} />
                  <button aria-label={`Retirar ${follower.name}`} className="button-secondary" type="submit">
                    Retirar
                  </button>
                </form>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {canAct && view.canAddColleague ? (
        <form action={addColleagueAction} aria-label="Incluir colega" className="inline-form">
          <input name="area" type="hidden" value={area} />
          <input name="requestId" type="hidden" value={requestId} />
          <label>
            E-mail do colega
            <input autoComplete="off" name="email" required type="email" />
          </label>
          <button type="submit">Incluir colega</button>
          <p className="section-description wide-field">
            O colega lê a solicitação e recebe os mesmos avisos que você, sem poder agir nela nem ver as notas internas da equipe.
          </p>
        </form>
      ) : null}
      {canAct && view.canFollowSelf ? (
        <form action={followRequestAction}>
          <input name="area" type="hidden" value={area} />
          <input name="requestId" type="hidden" value={requestId} />
          <button type="submit">Acompanhar</button>
        </form>
      ) : null}
      {canAct && view.canStopFollowing ? (
        <form action={removeFollowerAction}>
          <input name="area" type="hidden" value={area} />
          <input name="requestId" type="hidden" value={requestId} />
          <input name="userId" type="hidden" value={view.viewerId} />
          <input name="self" type="hidden" value="true" />
          <button className="button-secondary" type="submit">
            Deixar de acompanhar
          </button>
        </form>
      ) : null}
    </section>
  );
}
