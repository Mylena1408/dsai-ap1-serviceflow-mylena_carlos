import Link from "next/link";
import { groupProgressText, type GroupBlock } from "@/modules/requests";
import { requestShortCode } from "@/shared/requests";
import { REQUEST_STATUS_LABELS } from "./request-status";

// The "Pacote" block of a request for whoever attends or reads it (SPEC 2026-11-07-operacao-e-automacao,
// 3.3 item 4, decision H4): the other requests of the bundle with code, service, sector and status,
// never their content; the link only to the ones the reader may open.

/** "#AB12CD34 · Mesa · Facilities · Aberta". */
export function groupMemberSummary(member: GroupBlock["others"][number]): string {
  return `#${requestShortCode(member.id)} · ${member.serviceName} · ${member.sectorName} · ${REQUEST_STATUS_LABELS[member.status]}`;
}

export function RequestGroupBlock({ block, hrefFor }: { block: GroupBlock | null; hrefFor: (requestId: string) => string }) {
  if (!block) return null;

  return (
    <section className="surface-card content-section" aria-labelledby="group-heading">
      <h2 id="group-heading">Pacote: {block.bundleName}</h2>
      <p className="metadata">
        Esta solicitação faz parte de um pacote aberto pelo solicitante. Andamento: {groupProgressText(block.progress)}.
      </p>
      <ul className="content-list">
        {block.others.map((member) => (
          <li key={member.id}>
            {member.readable ? <Link href={hrefFor(member.id)}>{groupMemberSummary(member)}</Link> : <span>{groupMemberSummary(member)}</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}
