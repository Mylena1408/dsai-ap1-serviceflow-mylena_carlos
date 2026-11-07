import Link from "next/link";
import { LINK_ROLE_LABELS, type RequestLinkView } from "@/modules/requests";
import { requestShortCode } from "@/shared/requests";
import { REQUEST_STATUS_LABELS } from "./request-status";

// "Vínculos" of a request (SPEC 2026-11-07-operacao-e-automacao, 3.3 item 1): the related requests,
// the original or the duplicates, with code, service, sector and status. The link to the other
// request appears only when the reader may open it; the form and "Remover" only for the team.

type RedirectAction = (formData: FormData) => Promise<never>;

type RequestLinksProps = {
  requestId: string;
  links: readonly RequestLinkView[];
  /** Where the reader opens another request (queue, own requests or approvals). */
  hrefFor: (requestId: string) => string;
  /** Present for the attendants of the request's sector. */
  edit?: { linkAction: RedirectAction; unlinkAction: RedirectAction };
};

/** "Duplicada de #AB12CD34 · Reparo · TI · Aberta". */
export function linkSummary(link: RequestLinkView): string {
  const { other } = link;
  return `${LINK_ROLE_LABELS[link.role]} #${requestShortCode(other.id)} · ${other.serviceName} · ${other.sectorName} · ${REQUEST_STATUS_LABELS[other.status]}`;
}

export function RequestLinks({ requestId, links, hrefFor, edit }: RequestLinksProps) {
  if (links.length === 0 && !edit) return null;

  return (
    <section className="surface-card content-section" aria-labelledby="links-heading">
      <h2 id="links-heading">Vínculos</h2>
      {links.length === 0 ? <p className="section-description">Nenhuma solicitação vinculada.</p> : null}
      <ul className="content-list request-links">
        {links.map((link) => (
          <li key={link.id}>
            {link.other.readable ? <Link href={hrefFor(link.other.id)}>{linkSummary(link)}</Link> : <span>{linkSummary(link)}</span>}
            {edit ? (
              <form action={edit.unlinkAction} className="inline-form">
                <input name="requestId" type="hidden" value={requestId} />
                <input name="linkId" type="hidden" value={link.id} />
                <button className="button-secondary" type="submit" aria-label={`Remover vínculo com #${requestShortCode(link.other.id)}`}>
                  Remover
                </button>
              </form>
            ) : null}
          </li>
        ))}
      </ul>
      {edit ? (
        <form action={edit.linkAction} aria-label="Vincular solicitação" className="create-form link-form">
          <input name="requestId" type="hidden" value={requestId} />
          <label>
            Código da outra solicitação
            <input maxLength={9} name="code" placeholder="#AB12CD34" required />
          </label>
          <label>
            Tipo
            <select defaultValue="RELATED" name="kind">
              <option value="RELATED">Relacionada a</option>
              <option value="DUPLICATE_OF">Esta é duplicada de</option>
            </select>
          </label>
          <button type="submit">Vincular</button>
        </form>
      ) : null}
    </section>
  );
}
