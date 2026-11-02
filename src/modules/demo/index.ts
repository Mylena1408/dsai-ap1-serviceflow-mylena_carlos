// Public API of the demo module: fictitious data for the demonstration mode (SPEC 2026-09-30,
// sections 22 and 25). The product never depends on these records.
export {
  DEMO_CATALOG,
  DEMO_DOCUMENT_REQUIREMENTS,
  DEMO_EXTRA_REQUESTERS,
  DEMO_NOTIFICATIONS,
  DEMO_REQUESTS,
  DEMO_SERVICE_FIELDS,
  DEMO_SERVICE_SETTINGS,
  demoScenarioProblems,
  demoTimeline,
} from "./domain/demo-data";
export type { DemoRequestScenario, DemoServiceName } from "./domain/demo-data";
export { ensureDemoDataLoaded, loadDemoData } from "./infrastructure/prisma-demo-data";
export type { DemoDataSummary } from "./infrastructure/prisma-demo-data";
