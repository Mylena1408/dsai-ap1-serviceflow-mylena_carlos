"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AdminCreateForm } from "./create-form";
import { useAdminSection } from "./section-context";
import type { AdminUpdateState } from "./actions";

type FormAction = (
  previousState: AdminUpdateState,
  formData: FormData,
) => Promise<AdminUpdateState>;

type RedirectAction = (formData: FormData) => Promise<never>;

type DocumentFormat = "PDF" | "DOCX" | "TXT";

export type AdminDocumentRequirement = {
  id: string;
  name: string;
  isRequired: boolean;
  acceptedFormats: DocumentFormat[];
  isActive: boolean;
};

type DocumentRequirementsEditorProps = {
  serviceId: string;
  // Active requirements in display order, followed by inactive ones.
  requirements: AdminDocumentRequirement[];
  maxActive: number;
  createAction: FormAction;
  updateAction: FormAction;
  moveAction: RedirectAction;
  deactivateAction: RedirectAction;
};

const FORMATS: DocumentFormat[] = ["PDF", "DOCX", "TXT"];

const initialState: AdminUpdateState = {
  status: "error",
  message: "",
};

function RequirementFields({ requirement }: { requirement?: AdminDocumentRequirement }) {
  return (
    <>
      <label>
        Nome do documento
        <input defaultValue={requirement?.name} maxLength={120} name="name" required />
      </label>
      <label>
        Obrigatoriedade
        <select defaultValue={requirement?.isRequired === false ? "false" : "true"} name="isRequired">
          <option value="true">Obrigatório</option>
          <option value="false">Opcional</option>
        </select>
      </label>
      <fieldset className="format-options wide-field">
        <legend>Formatos aceitos</legend>
        {FORMATS.map((format) => (
          <label key={format}>
            <input
              defaultChecked={requirement?.acceptedFormats.includes(format)}
              name="acceptedFormats"
              type="checkbox"
              value={format}
            />
            {format}
          </label>
        ))}
      </fieldset>
    </>
  );
}

function RequirementEditForm({
  requirement,
  action,
  onDone,
}: {
  requirement: AdminDocumentRequirement;
  action: FormAction;
  onDone: (saved: boolean) => void;
}) {
  const [state, formAction, isPending] = useActionState(action, initialState);

  useEffect(() => {
    if (state.status === "success" && state.message) {
      onDone(true);
    }
  }, [onDone, state.message, state.status]);

  return (
    <form action={formAction} className="entity-editor-form">
      <input name="id" type="hidden" value={requirement.id} />
      <div className="editor-fields">
        <RequirementFields requirement={requirement} />
      </div>
      {state.status === "error" && state.message ? (
        <p className="feedback feedback-error editor-feedback" role="alert">
          {state.message}
        </p>
      ) : null}
      <div className="editor-actions">
        <button className="editor-save-button" disabled={isPending} type="submit">
          {isPending ? "Salvando..." : "Salvar"}
        </button>
        <button
          className="button-secondary"
          disabled={isPending}
          onClick={() => onDone(false)}
          type="button"
        >
          Cancelar
        </button>
      </div>
    </form>
  );
}

function ActiveRequirement({
  requirement,
  isFirst,
  isLast,
  updateAction,
  moveAction,
  deactivateAction,
}: {
  requirement: AdminDocumentRequirement;
  isFirst: boolean;
  isLast: boolean;
  updateAction: FormAction;
  moveAction: RedirectAction;
  deactivateAction: RedirectAction;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const section = useAdminSection();

  if (editing) {
    return (
      <li className="requirement-item">
        <RequirementEditForm
          action={updateAction}
          onDone={(saved) => {
            setEditing(false);
            if (saved) router.refresh();
          }}
          requirement={requirement}
        />
      </li>
    );
  }

  return (
    <li className="requirement-item">
      <div className="entity-summary">
        <strong>{requirement.name}</strong>
        <span className="status-badge">{requirement.isRequired ? "Obrigatório" : "Opcional"}</span>
      </div>
      <div className="entity-details">
        <span>Formatos: {requirement.acceptedFormats.join(", ")}</span>
      </div>
      <div className="entity-actions requirement-actions">
        <button className="button-secondary" onClick={() => setEditing(true)} type="button">
          Editar
        </button>
        {!isFirst ? (
          <form action={moveAction}>
            <input name="id" type="hidden" value={requirement.id} />
            <input name="direction" type="hidden" value="up" />
            <input name="section" type="hidden" value={section} />
            <button className="button-secondary" type="submit">Subir</button>
          </form>
        ) : null}
        {!isLast ? (
          <form action={moveAction}>
            <input name="id" type="hidden" value={requirement.id} />
            <input name="direction" type="hidden" value="down" />
            <input name="section" type="hidden" value={section} />
            <button className="button-secondary" type="submit">Descer</button>
          </form>
        ) : null}
        <form action={deactivateAction}>
          <input name="id" type="hidden" value={requirement.id} />
          <input name="section" type="hidden" value={section} />
          <button className="button-danger" type="submit">Desativar</button>
        </form>
      </div>
    </li>
  );
}

export function DocumentRequirementsEditor({
  serviceId,
  requirements,
  maxActive,
  createAction,
  updateAction,
  moveAction,
  deactivateAction,
}: DocumentRequirementsEditorProps) {
  const active = requirements.filter((requirement) => requirement.isActive);
  const inactive = requirements.filter((requirement) => !requirement.isActive);

  return (
    <section aria-label="Documentos exigidos" className="requirements-panel">
      <h3>Documentos exigidos</h3>
      <p className="section-description">
        {active.length} de {maxActive} ativos. Alterações valem apenas para novas solicitações.
      </p>
      {active.length === 0 ? (
        <p className="section-description">
          Nenhum documento exigido: a solicitação é aberta sem anexos.
        </p>
      ) : (
        <ol className="requirement-list">
          {active.map((requirement, index) => (
            <ActiveRequirement
              deactivateAction={deactivateAction}
              isFirst={index === 0}
              isLast={index === active.length - 1}
              key={requirement.id}
              moveAction={moveAction}
              requirement={requirement}
              updateAction={updateAction}
            />
          ))}
        </ol>
      )}
      {active.length < maxActive ? (
        <AdminCreateForm action={createAction} submitLabel="Adicionar documento">
          <input name="serviceId" type="hidden" value={serviceId} />
          <RequirementFields />
        </AdminCreateForm>
      ) : (
        <p className="section-description">Limite de {maxActive} documentos ativos atingido.</p>
      )}
      {inactive.length > 0 ? (
        <>
          <h4>Histórico (inativos)</h4>
          <ul className="requirement-list">
            {inactive.map((requirement) => (
              <li className="requirement-item is-inactive" key={requirement.id}>
                <div className="entity-summary">
                  <strong>{requirement.name}</strong>
                  <span className="status-badge is-inactive">Inativo</span>
                </div>
                <div className="entity-details">
                  <span>{requirement.isRequired ? "Obrigatório" : "Opcional"}</span>
                  <span>Formatos: {requirement.acceptedFormats.join(", ")}</span>
                </div>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}
