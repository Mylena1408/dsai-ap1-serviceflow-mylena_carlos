"use client";

import { useActionState, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import type { AdminUpdateState } from "./actions";
import { PRIORITY_LABELS, type PriorityValue } from "@/app/_components/request-priority";
import { ServiceSlaFields } from "./service-sla-fields";

type UpdateAction = (
  previousState: AdminUpdateState,
  formData: FormData,
) => Promise<AdminUpdateState>;

type ToggleAction = (formData: FormData) => Promise<never>;

type Choice = {
  id: string;
  name: string;
  isActive: boolean;
};

type EditableRecord =
  | {
      kind: "sector" | "category";
      id: string;
      name: string;
      isActive: boolean;
    }
  | {
      kind: "user";
      id: string;
      name: string;
      email: string;
      role: "ADMIN" | "REQUESTER" | "ATTENDANT" | "MANAGER";
      sectorId: string | null;
      isActive: boolean;
    }
  | {
      kind: "service";
      id: string;
      name: string;
      description: string;
      categoryId: string;
      sectorId: string;
      isActive: boolean;
      defaultPriority: PriorityValue;
      slaHours: number | null;
    };

type RecordEditorProps = {
  record: EditableRecord;
  updateAction: UpdateAction;
  toggleAction: ToggleAction;
  section?: string;
  sectors?: Choice[];
  categories?: Choice[];
  // Extra record content shown below the details while not editing.
  children?: ReactNode;
};

const initialState: AdminUpdateState = {
  status: "error",
  message: "",
};

const roleLabels = {
  ADMIN: "Administrador",
  REQUESTER: "Solicitante",
  ATTENDANT: "Atendente",
  MANAGER: "Gestor",
} as const;

function EditorForm({
  record,
  action,
  sectors,
  categories,
  onSaved,
}: {
  record: EditableRecord;
  action: UpdateAction;
  sectors: Choice[];
  categories: Choice[];
  onSaved: (message: string) => void;
}) {
  const [state, formAction, isPending] = useActionState(action, initialState);

  useEffect(() => {
    if (state.message && state.status === "success") {
      onSaved(state.message);
    }
  }, [onSaved, state.message, state.status]);

  return (
    <form action={formAction} className="entity-editor-form">
      <input name="id" type="hidden" value={record.id} />
      <div className="editor-fields">
        <label>
          Nome
          <input
            autoFocus
            defaultValue={record.name}
            maxLength={record.kind === "sector" || record.kind === "category" ? 200 : undefined}
            name="name"
            required
          />
        </label>
        {record.kind === "user" ? (
          <>
            <label>
              E-mail
              <input defaultValue={record.email} name="email" required type="email" />
            </label>
            <label>
              Nova senha (opcional)
              <input autoComplete="new-password" name="password" type="password" />
            </label>
            <label>
              Perfil
              <select defaultValue={record.role} name="role" required>
                <option value="ADMIN">Administrador</option>
                <option value="REQUESTER">Solicitante</option>
                <option value="ATTENDANT">Atendente</option>
              </select>
            </label>
            <label>
              Setor da equipe
              <select defaultValue={record.sectorId ?? ""} name="sectorId">
                <option value="">Selecione se for atendente</option>
                {sectors.map((sector) => (
                  <option key={sector.id} value={sector.id}>
                    {sector.name}{sector.isActive ? "" : " (inativo)"}
                  </option>
                ))}
              </select>
            </label>
          </>
        ) : null}
        {record.kind === "service" ? (
          <>
            <label className="wide-field">
              Descrição
              <textarea defaultValue={record.description} name="description" required />
            </label>
            <label>
              Categoria
              <select defaultValue={record.categoryId} name="categoryId" required>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}{category.isActive ? "" : " (inativa)"}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Setor
              <select defaultValue={record.sectorId} name="sectorId" required>
                {sectors.map((sector) => (
                  <option key={sector.id} value={sector.id}>
                    {sector.name}{sector.isActive ? "" : " (inativo)"}
                  </option>
                ))}
              </select>
            </label>
            <ServiceSlaFields defaultPriority={record.defaultPriority} slaHours={record.slaHours} />
          </>
        ) : null}
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
          onClick={() => onSaved("")}
          type="button"
        >
          Cancelar
        </button>
      </div>
    </form>
  );
}

export function AdminRecordEditor({
  record,
  updateAction,
  toggleAction,
  section = "overview",
  sectors = [],
  categories = [],
  children,
}: RecordEditorProps) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [feedback, setFeedback] = useState("");

  const finishEditing = useCallback((message: string) => {
    setEditing(false);
    setFeedback(message);
    if (message) router.refresh();
  }, [router]);

  function description() {
    if (record.kind === "user") {
      return (
        <>
          <span>{record.email}</span>
          <span>{roleLabels[record.role]}</span>
          {record.sectorId ? (
            <span>{sectors.find((sector) => sector.id === record.sectorId)?.name ?? "Setor associado"}</span>
          ) : null}
        </>
      );
    }

    if (record.kind === "service") {
      return (
        <>
          <span>{record.description}</span>
          <span>Categoria: {categories.find((category) => category.id === record.categoryId)?.name}</span>
          <span>Setor: {sectors.find((sector) => sector.id === record.sectorId)?.name}</span>
          <span>Prioridade padrão: {PRIORITY_LABELS[record.defaultPriority]}</span>
          <span>{record.slaHours === null ? "Sem prazo" : `Prazo-base: ${record.slaHours} h`}</span>
        </>
      );
    }

    return null;
  }

  return (
    <li className="entity-item">
      <div className="entity-record-content">
        {editing ? (
          <EditorForm
            action={updateAction}
            categories={categories}
            onSaved={finishEditing}
            record={record}
            sectors={sectors}
          />
        ) : (
          <>
            <div className="entity-summary">
              <strong>{record.name}</strong>
              <span className={`status-badge${record.isActive ? "" : " is-inactive"}`}>
                {record.isActive ? "Ativo" : "Inativo"}
              </span>
            </div>
            <div className="entity-details">{description()}</div>
            <div className="entity-view-actions">
              <button
                className="button-secondary"
                onClick={() => {
                  setFeedback("");
                  setEditing(true);
                }}
                type="button"
              >
                Editar
              </button>
              {feedback ? (
                <span className="editor-success" role="status">{feedback}</span>
              ) : null}
            </div>
            {children}
          </>
        )}
      </div>
      {!editing ? (
        <form action={toggleAction} className="entity-actions">
          <input name="id" type="hidden" value={record.id} />
          <input name="isActive" type="hidden" value={String(!record.isActive)} />
          <input name="section" type="hidden" value={section} />
          <button
            className={record.isActive ? "button-danger" : "button-secondary"}
            type="submit"
          >
            {record.isActive ? "Desativar" : "Reativar"}
          </button>
        </form>
      ) : null}
    </li>
  );
}
