import type { RequestAttachmentSummary } from "@/modules/requests";

type RequestAttachmentsProps = {
  requestId: string;
  attachments: RequestAttachmentSummary[];
};

function formatSize(bytes: number): string {
  return bytes < 1024
    ? `${bytes} bytes`
    : `${(bytes / 1024).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} KiB`;
}

// Metadata and download links of the documents sent when the request was opened (SPEC
// 21.5). Links carry only identifiers; the route authorizes every download.
export function RequestAttachments({ requestId, attachments }: RequestAttachmentsProps) {
  if (attachments.length === 0) {
    return null;
  }

  return (
    <section className="surface-card content-section" aria-labelledby="attachments-heading">
      <p className="eyebrow">Documentos</p>
      <h2 id="attachments-heading">Documentos enviados</h2>
      <ul className="attachment-list">
        {attachments.map((attachment) => (
          <li key={attachment.id}>
            <p>
              {attachment.requirementNameSnapshot} (
              {attachment.requirementRequiredSnapshot ? "obrigatório" : "opcional"})
            </p>
            {attachment.removedAt ? (
              // SPEC 2026-11-02-auditoria-lgpd, 5.5.3: the file left with the anonymization.
              <p>Arquivo removido na anonimização</p>
            ) : (
              <>
                <a
                  href={`/api/requests/${requestId}/attachments/${attachment.id}`}
                  download={attachment.originalFilename}
                >
                  Baixar {attachment.originalFilename}
                </a>
                <p>
                  {attachment.detectedFormat} · {formatSize(attachment.sizeBytes)}
                </p>
              </>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
