// Fictitious demonstration data (SPEC 2026-09-30, sections 22.6, 22.7 and 25). The data and the
// loader live in src/modules/demo; this file keeps the entry point used by the seed command and
// by the tests.
export {
  DEMO_CATALOG,
  DEMO_DOCUMENT_REQUIREMENTS,
  DEMO_REQUESTS,
  DEMO_SERVICE_FIELDS,
  loadDemoData as seedDemoData,
} from "../src/modules/demo";
export type { DemoDataSummary } from "../src/modules/demo";
