import { atLimit, type SectorLoad } from "@/modules/requests";
import { DISTRIBUTION_MODE_LABELS } from "@/modules/sectors";

// "Carga da equipe" (SPEC 2026-11-07-operacao-e-automacao, 4.3 item 8): one table per sector with each
// active attendant's open and in-progress requests, the sector's limit and today's absences.

/** "Rodízio · até 5 por atendente · 3 na fila sem responsável". */
export function sectorLoadSummary(load: SectorLoad): string {
  const mode = `Distribuição: ${DISTRIBUTION_MODE_LABELS[load.mode]}`;
  const limit = load.maxActivePerAttendant === null ? "sem limite" : `até ${load.maxActivePerAttendant} por atendente`;
  const queue = load.unassigned === 1 ? "1 na fila sem responsável" : `${load.unassigned} na fila sem responsável`;
  return load.mode === "NONE" ? `${mode} · ${queue}` : `${mode} · ${limit} · ${queue}`;
}

/** "Ausente hoje", "No limite" or "Disponível". */
export function memberSituation(member: SectorLoad["members"][number], load: SectorLoad): string {
  if (member.absentToday) return "Ausente hoje";
  if (atLimit(member, load)) return "No limite";
  return "Disponível";
}

export function TeamLoad({ loads }: { loads: readonly SectorLoad[] | null }) {
  if (!loads || loads.length === 0) return null;

  return (
    <section className="surface-card content-section" aria-labelledby="team-load-heading">
      <h2 id="team-load-heading">Carga da equipe</h2>
      {loads.map((load) => (
        <div className="team-load" key={load.sectorId}>
          {loads.length > 1 ? <h3>{load.sectorName}</h3> : null}
          <p className="metadata">{sectorLoadSummary(load)}</p>
          {load.members.length === 0 ? (
            <p>Nenhum atendente ativo.</p>
          ) : (
            <table className="data-table">
              <caption>Carga de {load.sectorName}</caption>
              <thead>
                <tr>
                  <th scope="col">Atendente</th>
                  <th scope="col">Solicitações ativas</th>
                  <th scope="col">Situação</th>
                </tr>
              </thead>
              <tbody>
                {load.members.map((member) => (
                  <tr key={member.id}>
                    <td>{member.name}</td>
                    <td>{member.activeRequests}</td>
                    <td>{memberSituation(member, load)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ))}
    </section>
  );
}
