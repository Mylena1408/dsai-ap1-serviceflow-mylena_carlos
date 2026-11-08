import Link from "next/link";
import {
  MAX_VIEWS_PER_LIST,
  MAX_VIEW_NAME_LENGTH,
  normalizedCriteria,
  viewHref,
  type SavedViewList,
  type SavedViewRecord,
} from "@/modules/saved-views";
import { deleteViewAction, renameViewAction, saveViewAction } from "./saved-view-actions";
import type { SearchParams } from "./request-search-url";

// "Minhas visões" (SPEC 2026-11-07-operacao-e-automacao, 7.3 item 1), under the search of the queue and of
// "Minhas solicitações": each view opens the list with its criteria; the current search can be saved under a
// name. Only the person sees their views.

const MESSAGES: Record<string, { text: string; error: boolean }> = {
  "view-saved": { text: "Visão salva.", error: false },
  "view-renamed": { text: "Visão renomeada.", error: false },
  "view-deleted": { text: "Visão apagada.", error: false },
  "view-taken": { text: "Você já tem uma visão com esse nome nesta lista.", error: true },
  "view-name": { text: `Dê um nome de 1 a ${MAX_VIEW_NAME_LENGTH} caracteres.`, error: true },
  "view-limit": { text: `Você já tem ${MAX_VIEWS_PER_LIST} visões nesta lista (ou a busca é longa demais). Apague alguma antes de salvar outra.`, error: true },
  "view-missing": { text: "A visão não está disponível para você.", error: true },
};

export function savedViewMessage(code: string | string[] | undefined): { text: string; error: boolean } | null {
  return typeof code === "string" ? (MESSAGES[code] ?? null) : null;
}

export function SavedViews({ list, views, params }: { list: SavedViewList; views: SavedViewRecord[]; params: SearchParams }) {
  const current = normalizedCriteria(list, params);
  const feedback = savedViewMessage(params.view);

  return (
    <section className="surface-card saved-views" aria-labelledby={`saved-views-${list}`}>
      <h2 id={`saved-views-${list}`}>Minhas visões</h2>
      {feedback ? (
        <p className={`feedback${feedback.error ? " feedback-error" : ""}`} role={feedback.error ? "alert" : "status"}>
          {feedback.text}
        </p>
      ) : null}
      {views.length === 0 ? (
        <p className="section-description">Salve uma busca para voltar a ela com um clique.</p>
      ) : (
        <ul aria-label="Visões salvas" className="plain-list">
          {views.map((view) => (
            <li key={view.id}>
              <Link aria-current={view.criteria === current ? "page" : undefined} href={viewHref(list, view.criteria)}>
                {view.name}
              </Link>
              <details>
                <summary>Renomear ou apagar</summary>
                <form action={renameViewAction} aria-label={`Renomear a visão ${view.name}`} className="inline-form">
                  <input name="list" type="hidden" value={list} />
                  <input name="back" type="hidden" value={current} />
                  <input name="viewId" type="hidden" value={view.id} />
                  <label>
                    Novo nome
                    <input defaultValue={view.name} maxLength={MAX_VIEW_NAME_LENGTH} name="name" required />
                  </label>
                  <button type="submit">Renomear</button>
                </form>
                <form action={deleteViewAction} aria-label={`Apagar a visão ${view.name}`}>
                  <input name="list" type="hidden" value={list} />
                  <input name="back" type="hidden" value={current} />
                  <input name="viewId" type="hidden" value={view.id} />
                  <button className="button-secondary" type="submit">
                    Apagar
                  </button>
                </form>
              </details>
            </li>
          ))}
        </ul>
      )}
      <form action={saveViewAction} aria-label="Salvar esta busca" className="inline-form">
        <input name="list" type="hidden" value={list} />
        <input name="back" type="hidden" value={current} />
        <label>
          Nome da visão
          <input maxLength={MAX_VIEW_NAME_LENGTH} name="name" required />
        </label>
        <button type="submit">Salvar esta busca</button>
      </form>
    </section>
  );
}
