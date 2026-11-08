// Attendance checklists (SPEC 2026-11-08-atendimento-dia-a-dia, part B): the rules (SF-200).
export {
  MAX_ACTIVE_CHECKLIST_ITEMS,
  MAX_CHECKLIST_CONDITION_LENGTH,
  MAX_CHECKLIST_NOTE_LENGTH,
  MAX_CHECKLIST_TEXT_LENGTH,
  assertChecklistAllowsCompletion,
  assertChecklistRoom,
  checklistItemInputSchema,
  checklistMarkInputSchema,
  checklistProgress,
  checklistProgressLabel,
  pendingRequiredItems,
  planChecklistCopy,
  planChecklistMark,
  planModelCopy,
} from "./domain/checklist";
export type {
  ChecklistAnswer,
  ChecklistItemInput,
  ChecklistMarkInput,
  ChecklistMarkPlan,
  ChecklistRequestStatus,
  ChecklistTemplateItem,
  RequestChecklistItemRecord,
} from "./domain/checklist";
