import { sendToSectorAction } from "../actions";

type SectorTransferFormProps = {
  requestId: string;
  destinations: Array<{ id: string; name: string }>;
};

// "Encaminhar para outro setor" (SPEC 2026-11-03-transferencia-entre-setores, 5.1 and 5.2). The
// list only mirrors the rules; the server checks the sector and the reason again.
export function SectorTransferForm({ requestId, destinations }: SectorTransferFormProps) {
  return (
    <section className="surface-card content-section" aria-labelledby="sector-transfer-heading">
      <p className="eyebrow">Encaminhamento</p>
      <h2 id="sector-transfer-heading">Encaminhar para outro setor</h2>
      <p>
        Use quando a solicitação chegou ao setor errado. O novo setor recebe todo o histórico, os comentários e as notas
        internas; o responsável sai, e o prazo e a prioridade continuam os mesmos.
      </p>
      <form action={sendToSectorAction} className="create-form">
        <input type="hidden" name="requestId" value={requestId} />
        <label htmlFor="sector-transfer-target">Setor de destino</label>
        <select id="sector-transfer-target" name="sectorId" required defaultValue="">
          <option value="" disabled>
            Escolha um setor
          </option>
          {destinations.map((sector) => (
            <option key={sector.id} value={sector.id}>
              {sector.name}
            </option>
          ))}
        </select>
        <label htmlFor="sector-transfer-note">Justificativa</label>
        <textarea id="sector-transfer-note" name="note" maxLength={1000} required rows={3} />
        <button type="submit">Encaminhar</button>
      </form>
    </section>
  );
}
