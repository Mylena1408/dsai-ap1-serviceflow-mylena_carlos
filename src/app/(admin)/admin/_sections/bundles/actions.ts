"use server";

import { createBundle, setBundleActive, updateBundle } from "@/modules/service-bundles";
import { activeState, field, finish, reportFailure } from "../../_shared/action-helpers";

// "Pacotes" of the administration (SPEC 2026-11-07-operacao-e-automacao, 3.3 item 2): only the
// administrator; the use cases record the audit trail.

function bundleInput(formData: FormData) {
  return {
    name: field(formData, "name"),
    description: field(formData, "description"),
    // One select per position; blanks are dropped by the use case.
    serviceIds: formData.getAll("serviceIds").filter((value): value is string => typeof value === "string"),
  };
}

export async function createBundleAction(formData: FormData): Promise<never> {
  try {
    await createBundle(bundleInput(formData));
  } catch (error) {
    reportFailure("bundles", "bundles", error);
  }
  return finish("bundles", "created", "bundles");
}

export async function updateBundleAction(formData: FormData): Promise<never> {
  try {
    await updateBundle(field(formData, "id"), bundleInput(formData));
  } catch (error) {
    reportFailure("bundles", "bundles", error);
  }
  return finish("bundles", "updated", "bundles");
}

export async function toggleBundleAction(formData: FormData): Promise<never> {
  try {
    await setBundleActive(field(formData, "id"), activeState(formData));
  } catch (error) {
    reportFailure("bundles", "bundles", error);
  }
  return finish("bundles", "status", "bundles");
}
