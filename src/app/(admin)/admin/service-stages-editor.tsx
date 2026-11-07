"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AdminCreateForm } from "./create-form";
import { useAdminSection } from "./section-context";
import type { AdminUpdateState } from "./actions";
import { keepValuesOnSubmit } from "@/app/_components/keep-values-on-submit";
import type { ApprovalConditionChoice } from "./service-approval-editor";

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
  /** SPEC 2026-11-06-aprofundamento-configurabilidade, 5.3. */
  assigneeId?: string | null;
  targetDays?: number | null;
  conditionFieldId?: string | null;
  conditionValue?: string | null;
};

/** What the stage's settings mean, as one line ("Responsável: Bia · Prazo: 2 dias · Só quando Tipo = Hardware"). */
export function stageSettingsSummary(
  stage: AdminServiceStage,
  assignees: ReadonlyArray<{ id: string; name: string }>,
  conditions: readonly ApprovalConditionChoice[],
): string | null {
  const parts: string[] = [];
  if (stage.assigneeId) parts.push(`Responsável: ${assignees.find((item) => item.id === stage.assigneeId)?.name ?? "atendente indisponível"}`);
  if (stage.targetDays) parts.push(`Prazo: ${stage.targetDays} ${stage.targetDays === 1 ? "dia" : "dias"}`);
  if (stage.conditionFieldId && stage.conditionValue !== null && stage.conditionValue !== undefined) {
    const field = conditions.find((item) => item.fieldId === stage.conditionFieldId);
    const value = field?.type === "YES_NO" ? (stage.conditionValue === "true" ? "Sim" : "Não") : stage.conditionValue;
    parts.push(`Só quando ${field?.label ?? "campo"} ${field?.type === "MULTI_SELECT" ? "contém" : "="} ${value}`);
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}

type ServiceStagesEditorProps = {
  serviceId: string;
  /** SPEC 2026-11-06-aprofundamento-configurabilidade, 5.3: active attendants of the service's sector. */
  assigneeChoices?: Array<{ id: string; name: string }>;
  /** Requester fields with choices, for the stage's condition. */
  conditionChoices?: ApprovalConditionChoice[];
  settingsAction?: FormAction;
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
  const section = useAdminSection();
  return (
    <>
      <input name="id" type="hidden" value={id} />
      <input name="section" type="hidden" value={section} />
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
    <form action={formAction} onSubmit={keepValuesOnSubmit(formAction)} className="entity-editor-form">
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

/** The stage's attendant, target and condition (SPEC 2026-11-06-aprofundamento-configurabilidade, 5.3). */
function SettingsForm({
  stage,
  action,
  assignees,
  conditions,
  onDone,
}: {
  stage: AdminServiceStage;
  action: FormAction;
  assignees: ReadonlyArray<{ id: string; name: string }>;
  conditions: readonly ApprovalConditionChoice[];
  onDone: (saved: boolean) => void;
}) {
  const [state, formAction, isPending] = useActionState(action, initialState);
  const currentCondition = stage.conditionFieldId ? `${stage.conditionFieldId}::${stage.conditionValue ?? ""}` : "";

  useEffect(() => {
    if (state.status === "success" && state.message) {
      onDone(true);
    }
  }, [onDone, state.message, state.status]);

  return (
    <form action={formAction} onSubmit={keepValuesOnSubmit(formAction)} className="stage-settings-form" aria-label={`Ajustes da etapa ${stage.name}`}>
      <input name="id" type="hidden" value={stage.id} />
      <div className="editor-fields">
        <label>
          Responsável ao entrar
          <select defaultValue={stage.assigneeId ?? ""} name="assigneeId">
            <option value="">Ninguém (mantém o responsável)</option>
            {assignees.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Prazo da etapa (dias)
          <input defaultValue={stage.targetDays ?? ""} max={30} min={1} name="targetDays" step={1} type="number" />
        </label>
        <label className="wide-field">
          Incluir a etapa só quando
          <select defaultValue={currentCondition} name="condition">
            <option value="">Sempre incluir</option>
            {conditions.flatMap((field) =>
              (field.type === "YES_NO" ? ["true", "false"] : field.options).map((value) => (
                <option key={`${field.fieldId}::${value}`} value={`${field.fieldId}::${value}`}>
                  {field.label} {field.type === "MULTI_SELECT" ? "contém" : "="} {field.type === "YES_NO" ? (value === "true" ? "Sim" : "Não") : value}
                </option>
              )),
            )}
          </select>
        </label>
      </div>
      {state.status === "error" && state.message ? (
        <p className="feedback feedback-error editor-feedback" role="alert">
          {state.message}
        </p>
      ) : null}
      <div className="editor-actions">
        <button className="editor-save-button" disabled={isPending} type="submit">
          {isPending ? "Salvando..." : "Salvar ajustes"}
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
  settingsAction,
  assignees = [],
  conditions = [],
}: {
  stage: AdminServiceStage;
  position: number;
  isFirst: boolean;
  isLast: boolean;
  renameAction: FormAction;
  moveAction: RedirectAction;
  deactivateAction: RedirectAction;
  settingsAction?: FormAction;
  assignees?: ReadonlyArray<{ id: string; name: string }>;
  conditions?: readonly ApprovalConditionChoice[];
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [configuring, setConfiguring] = useState(false);
  const summary = stageSettingsSummary(stage, assignees, conditions);

  if (configuring && settingsAction) {
    return (
      <li className="requirement-item">
        <SettingsForm
          action={settingsAction}
          assignees={assignees}
          conditions={conditions}
          onDone={(saved) => {
            setConfiguring(false);
            if (saved) router.refresh();
          }}
          stage={stage}
        />
      </li>
    );
  }

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
        {summary ? <span className="section-description">{summary}</span> : null}
      </div>
      <div className="entity-actions requirement-actions">
        <button className="button-secondary" onClick={() => setEditing(true)} type="button">
          Renomear
        </button>
        {settingsAction ? (
          <button className="button-secondary" onClick={() => setConfiguring(true)} type="button">
            Ajustes
          </button>
        ) : null}
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
  assigneeChoices,
  conditionChoices,
  settingsAction,
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
              assignees={assigneeChoices}
              conditions={conditionChoices}
              settingsAction={settingsAction}
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
