import { approvalLevelText, type ApprovalLevelsView } from "@/modules/requests";

// "Níveis de aprovação" (SPEC 2026-11-06-aprofundamento-configurabilidade, 4.3.3 to 4.3.6): shown
// when the request has more than one level or a deadline; with one level and no deadline, the
// situation next to the status already says everything.

const dateTime = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "America/Sao_Paulo",
});

export function ApprovalLevels({ view }: { view: ApprovalLevelsView | null }) {
  if (!view || (view.levelCount < 2 && !view.lines.some((line) => line.dueAt))) {
    return null;
  }

  return (
    <section className="surface-card content-section" aria-labelledby="approval-levels-heading">
      <h2 id="approval-levels-heading">Níveis de aprovação</h2>
      <ol className="approval-levels">
        {view.lines.map((line) => (
          <li className={`approval-level approval-level-${line.situation}`} key={line.level}>
            <p>
              <strong>
                Nível {line.level} de {view.levelCount}: {line.sectorName}
              </strong>{" "}
              — {approvalLevelText(line)}
              {line.decidedAt ? ` em ${dateTime.format(line.decidedAt)}` : ""}
            </p>
            {line.dueAt ? (
              <p className="metadata">
                Prazo para decidir: {dateTime.format(line.dueAt)}
                {line.overdue ? " (atrasado)" : ""}
              </p>
            ) : null}
            {line.note ? <p className="metadata">Observação: {line.note}</p> : null}
          </li>
        ))}
      </ol>
    </section>
  );
}
