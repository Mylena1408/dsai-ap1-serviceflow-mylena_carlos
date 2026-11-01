"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AdminCreateForm } from "./create-form";
import type { AdminUpdateState } from "./actions";

// Custom fields of a service (SPEC 2026-11-01-campos-personalizados, 5.1 and 5.2).

type FormAction = (
  previousState: AdminUpdateState,
  formData: FormData,
) => Promise<AdminUpdateState>;

type RedirectAction = (formData: FormData) => Promise<never>;

type FieldType = "SHORT_TEXT" | "LONG_TEXT" | "INTEGER" | "DATE" | "SELECT" | "YES_NO";

export type AdminServiceField = {
  id: string;
  label: string;
  helpText: string | null;
  type: FieldType;
  isRequired: boolean;
  options: string[];
  minValue: number | null;
  maxValue: number | null;
  isActive: boolean;
};

type ServiceFieldsEditorProps = {
  serviceId: string;
  // Active fields in display order, followed by inactive ones.
  fields: AdminServiceField[];
  maxActive: number;
  createAction: FormAction;
  updateAction: FormAction;
  moveAction: RedirectAction;
  deactivateAction: RedirectAction;
  reactivateAction: RedirectAction;
};

export const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  SHORT_TEXT: "Texto curto",
  LONG_TEXT: "Texto longo",
  INTEGER: "Número inteiro",
  DATE: "Data",
  SELECT: "Lista de opções",
  YES_NO: "Sim ou não",
};

const initialState: AdminUpdateState = {
  status: "error",
  message: "",
};

function fieldSummary(field: AdminServiceField): string | null {
  if (field.type === "SELECT") return `Opções: ${field.options.join(", ")}`;
  if (field.type !== "INTEGER") return null;
  if (field.minValue !== null && field.maxValue !== null) return `De ${field.minValue} a ${field.maxValue}`;
  if (field.minValue !== null) return `Mínimo ${field.minValue}`;
  if (field.maxValue !== null) return `Máximo ${field.maxValue}`;
  return null;
}

// The type is chosen only on creation (section 5.1); editing keeps it in a hidden input.
function FieldInputs({ field }: { field?: AdminServiceField }) {
  const [type, setType] = useState<FieldType>(field?.type ?? "SHORT_TEXT");
  const typeSelect = useRef<HTMLSelectElement>(null);

  // React resets the form after each action; the select goes back to its first option, so the
  // fields shown must follow it instead of keeping the type chosen before.
  useEffect(() => {
    const form = typeSelect.current?.form;
    if (!form) return;
    const onReset = () => setType("SHORT_TEXT");
    form.addEventListener("reset", onReset);
    return () => form.removeEventListener("reset", onReset);
  }, []);

  return (
    <>
      <label>
        Rótulo
        <input defaultValue={field?.label} maxLength={80} name="label" required />
      </label>
      {field ? (
        <p className="field-type-fixed">
          Tipo: {FIELD_TYPE_LABELS[field.type]}
          <input name="type" type="hidden" value={field.type} />
        </p>
      ) : (
        <label>
          Tipo
          <select
            defaultValue="SHORT_TEXT"
            name="type"
            onChange={(event) => setType(event.target.value as FieldType)}
            ref={typeSelect}
          >
            {Object.entries(FIELD_TYPE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </label>
      )}
      <label>
        Obrigatoriedade
        <select defaultValue={field?.isRequired === false ? "false" : "true"} name="isRequired">
          <option value="true">Obrigatório</option>
          <option value="false">Opcional</option>
        </select>
      </label>
      <label className="wide-field">
        Texto de ajuda (opcional)
        <input defaultValue={field?.helpText ?? ""} maxLength={200} name="helpText" />
      </label>
      {type === "SELECT" ? (
        <label className="wide-field">
          Opções (uma por linha, de 2 a 20)
          <textarea defaultValue={field?.options.join("\n")} name="options" required rows={4} />
        </label>
      ) : null}
      {type === "INTEGER" ? (
        <>
          <label>
            Mínimo (opcional)
            <input defaultValue={field?.minValue ?? ""} name="minValue" step={1} type="number" />
          </label>
          <label>
            Máximo (opcional)
            <input defaultValue={field?.maxValue ?? ""} name="maxValue" step={1} type="number" />
          </label>
        </>
      ) : null}
    </>
  );
}

function FieldEditForm({
  field,
  action,
  onDone,
}: {
  field: AdminServiceField;
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
      <input name="id" type="hidden" value={field.id} />
      <div className="editor-fields">
        <FieldInputs field={field} />
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
        <button className="button-secondary" disabled={isPending} onClick={() => onDone(false)} type="button">
          Cancelar
        </button>
      </div>
    </form>
  );
}

function HiddenTarget({ id }: { id: string }) {
  return (
    <>
      <input name="id" type="hidden" value={id} />
      <input name="section" type="hidden" value="services" />
    </>
  );
}

function ActiveField({
  field,
  isFirst,
  isLast,
  updateAction,
  moveAction,
  deactivateAction,
}: {
  field: AdminServiceField;
  isFirst: boolean;
  isLast: boolean;
  updateAction: FormAction;
  moveAction: RedirectAction;
  deactivateAction: RedirectAction;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const summary = fieldSummary(field);

  if (editing) {
    return (
      <li className="requirement-item">
        <FieldEditForm
          action={updateAction}
          field={field}
          onDone={(saved) => {
            setEditing(false);
            if (saved) router.refresh();
          }}
        />
      </li>
    );
  }

  return (
    <li className="requirement-item">
      <div className="entity-summary">
        <strong>{field.label}</strong>
        <span className="status-badge">{field.isRequired ? "Obrigatório" : "Opcional"}</span>
      </div>
      <div className="entity-details">
        <span>Tipo: {FIELD_TYPE_LABELS[field.type]}</span>
        {summary ? <span>{summary}</span> : null}
        {field.helpText ? <span>Ajuda: {field.helpText}</span> : null}
      </div>
      <div className="entity-actions requirement-actions">
        <button className="button-secondary" onClick={() => setEditing(true)} type="button">
          Editar
        </button>
        {!isFirst ? (
          <form action={moveAction}>
            <HiddenTarget id={field.id} />
            <input name="direction" type="hidden" value="up" />
            <button className="button-secondary" type="submit">Subir</button>
          </form>
        ) : null}
        {!isLast ? (
          <form action={moveAction}>
            <HiddenTarget id={field.id} />
            <input name="direction" type="hidden" value="down" />
            <button className="button-secondary" type="submit">Descer</button>
          </form>
        ) : null}
        <form action={deactivateAction}>
          <HiddenTarget id={field.id} />
          <button className="button-danger" type="submit">Desativar</button>
        </form>
      </div>
    </li>
  );
}

export function ServiceFieldsEditor({
  serviceId,
  fields,
  maxActive,
  createAction,
  updateAction,
  moveAction,
  deactivateAction,
  reactivateAction,
}: ServiceFieldsEditorProps) {
  const active = fields.filter((field) => field.isActive);
  const inactive = fields.filter((field) => !field.isActive);

  return (
    <section aria-label="Campos do formulário" className="requirements-panel">
      <h3>Campos do formulário</h3>
      <p className="section-description">
        {active.length} de {maxActive} ativos. Alterações valem apenas para novas solicitações.
      </p>
      {active.length === 0 ? (
        <p className="section-description">Nenhum campo: a solicitação é aberta só com a descrição.</p>
      ) : (
        <ol className="requirement-list">
          {active.map((field, index) => (
            <ActiveField
              deactivateAction={deactivateAction}
              field={field}
              isFirst={index === 0}
              isLast={index === active.length - 1}
              key={field.id}
              moveAction={moveAction}
              updateAction={updateAction}
            />
          ))}
        </ol>
      )}
      {active.length < maxActive ? (
        <AdminCreateForm action={createAction} submitLabel="Adicionar campo">
          <input name="serviceId" type="hidden" value={serviceId} />
          <FieldInputs />
        </AdminCreateForm>
      ) : (
        <p className="section-description">Limite de {maxActive} campos ativos atingido.</p>
      )}
      {inactive.length > 0 ? (
        <>
          <h4>Campos inativos</h4>
          <ul className="requirement-list">
            {inactive.map((field) => (
              <li className="requirement-item is-inactive" key={field.id}>
                <div className="entity-summary">
                  <strong>{field.label}</strong>
                  <span className="status-badge is-inactive">Inativo</span>
                </div>
                <div className="entity-details">
                  <span>Tipo: {FIELD_TYPE_LABELS[field.type]}</span>
                  <span>{field.isRequired ? "Obrigatório" : "Opcional"}</span>
                </div>
                <div className="entity-actions requirement-actions">
                  <form action={reactivateAction}>
                    <HiddenTarget id={field.id} />
                    <button className="button-secondary" type="submit">Reativar</button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}
