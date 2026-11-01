"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AdminCreateForm } from "./create-form";
import type { AdminUpdateState } from "./actions";

// Attendance flow of a service (SPEC 2026-11-01-fluxos-configuraveis, 5.1 and 5.6).

type FormAction = (
  previousState: AdminUpdateState,
  formData: FormData,
) => Promise<AdminUpdateState>;

type RedirectAction = (formData: FormData) => Promise<never>;

export type AdminServiceStage = {
  id: string;
  name: string;
  isActive: boolean;
};

type ServiceStagesEditorProps = {
  serviceId: string;
  // Active stages in flow order, followed by inactive ones.
  stages: AdminServiceStage[];
  maxActive: number;
  createAction: FormAction;
  renameAction: FormAction;
  moveAction: RedirectAction;
  deactivateAction: RedirectAction;
  reactivateAction: RedirectAction;
};

const initialState: AdminUpdateState = {
  status: "error",
  message: "",
};

function NameInput({ defaultValue }: { defaultValue?: string }) {
  return (
    <label>
      Nome da etapa
      <input defaultValue={defaultValue} maxLength={60} name="name" required />
    </label>
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

function RenameForm({
  stage,
  action,
  onDone,
}: {
  stage: AdminServiceStage;
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
      <input name="id" type="hidden" value={stage.id} />
      <div className="editor-fields">
        <NameInput defaultValue={stage.name} />
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

function ActiveStage({
  stage,
  position,
  isFirst,
  isLast,
  renameAction,
  moveAction,
  deactivateAction,
}: {
  stage: AdminServiceStage;
  position: number;
  isFirst: boolean;
  isLast: boolean;
  renameAction: FormAction;
  moveAction: RedirectAction;
  deactivateAction: RedirectAction;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <li className="requirement-item">
        <RenameForm
          action={renameAction}
          onDone={(saved) => {
            setEditing(false);
            if (saved) router.refresh();
          }}
          stage={stage}
        />
      </li>
    );
  }

  return (
    <li className="requirement-item">
      <div className="entity-summary">
        <strong>{stage.name}</strong>
        <span className="status-badge">Etapa {position}</span>
      </div>
      <div className="entity-actions requirement-actions">
        <button className="button-secondary" onClick={() => setEditing(true)} type="button">
          Renomear
        </button>
        {!isFirst ? (
          <form action={moveAction}>
            <HiddenTarget id={stage.id} />
            <input name="direction" type="hidden" value="up" />
            <button className="button-secondary" type="submit">Subir</button>
          </form>
        ) : null}
        {!isLast ? (
          <form action={moveAction}>
            <HiddenTarget id={stage.id} />
            <input name="direction" type="hidden" value="down" />
            <button className="button-secondary" type="submit">Descer</button>
          </form>
        ) : null}
        <form action={deactivateAction}>
          <HiddenTarget id={stage.id} />
          <button className="button-danger" type="submit">Desativar</button>
        </form>
      </div>
    </li>
  );
}

export function ServiceStagesEditor({
  serviceId,
  stages,
  maxActive,
  createAction,
  renameAction,
  moveAction,
  deactivateAction,
  reactivateAction,
}: ServiceStagesEditorProps) {
  const active = stages.filter((stage) => stage.isActive);
  const inactive = stages.filter((stage) => !stage.isActive);

  return (
    <section aria-label="Etapas do atendimento" className="requirements-panel">
      <h3>Etapas do atendimento</h3>
      <p className="section-description">
        {active.length} de {maxActive} ativas. Solicitações já em atendimento seguem as etapas do momento em que
        começaram.
      </p>
      {active.length === 0 ? (
        <p className="section-description">Nenhuma etapa: o atendimento segue sem etapas, de Aberta a Concluída.</p>
      ) : (
        <ol className="requirement-list">
          {active.map((stage, index) => (
            <ActiveStage
              deactivateAction={deactivateAction}
              isFirst={index === 0}
              isLast={index === active.length - 1}
              key={stage.id}
              moveAction={moveAction}
              position={index + 1}
              renameAction={renameAction}
              stage={stage}
            />
          ))}
        </ol>
      )}
      {active.length < maxActive ? (
        <AdminCreateForm action={createAction} submitLabel="Adicionar etapa">
          <input name="serviceId" type="hidden" value={serviceId} />
          <NameInput />
        </AdminCreateForm>
      ) : (
        <p className="section-description">Limite de {maxActive} etapas ativas atingido.</p>
      )}
      {inactive.length > 0 ? (
        <>
          <h4>Etapas inativas</h4>
          <ul className="requirement-list">
            {inactive.map((stage) => (
              <li className="requirement-item is-inactive" key={stage.id}>
                <div className="entity-summary">
                  <strong>{stage.name}</strong>
                  <span className="status-badge is-inactive">Inativa</span>
                </div>
                <div className="entity-actions requirement-actions">
                  <form action={reactivateAction}>
                    <HiddenTarget id={stage.id} />
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
