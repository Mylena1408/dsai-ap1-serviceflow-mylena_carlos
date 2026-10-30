"use server";

// Public entry point of the administrative Server Actions. The implementations live
// in one file per entity under _sections/ (SF-042); names and path stay the same.
export {
  createSectorAction,
  toggleSectorAction,
  updateSectorAction,
} from "./_sections/sectors/actions";
export {
  createCategoryAction,
  toggleCategoryAction,
  updateCategoryAction,
} from "./_sections/categories/actions";
export {
  createUserAction,
  toggleUserAction,
  updateUserAction,
} from "./_sections/users/actions";
export {
  createDocumentRequirementAction,
  createServiceAction,
  deactivateDocumentRequirementAction,
  moveDocumentRequirementAction,
  toggleServiceAction,
  updateDocumentRequirementAction,
  updateServiceAction,
} from "./_sections/services/actions";
export type { AdminUpdateState } from "./_shared/action-helpers";
