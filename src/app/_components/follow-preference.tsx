// "Seguir automaticamente as solicitações em que comento" (SPEC 2026-11-08-atendimento-dia-a-dia, 13.3 item 2; decision
// J7): on by default; the attendant turns it off here.

export function FollowPreferenceForm({
  autoFollowOnComment,
  action,
  saved,
}: {
  autoFollowOnComment: boolean;
  action: (formData: FormData) => Promise<never>;
  saved: boolean;
}) {
  return (
    <section aria-labelledby="follow-preference-heading" className="surface-card content-section">
      <h2 id="follow-preference-heading">Acompanhar ao comentar</h2>
      {saved ? (
        <p className="feedback" role="status">
          Preferência de acompanhamento salva.
        </p>
      ) : null}
      <form action={action} className="inline-form">
        <label className="checkbox-field">
          <input defaultChecked={autoFollowOnComment} name="autoFollowOnComment" type="checkbox" />
          Seguir automaticamente as solicitações em que comento
        </label>
        <button type="submit">Salvar</button>
        <p className="section-description wide-field">
          Quem acompanha recebe os avisos da equipe sobre a solicitação. Você pode deixar de acompanhar em cada solicitação.
        </p>
      </form>
    </section>
  );
}
