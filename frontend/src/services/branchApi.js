import { API_BASE } from "./session";

const unexpectedResponse = "The branch service returned an unexpected response. Please try again.";

function validateBranches(data) {
  if (!Array.isArray(data)) throw new Error(unexpectedResponse);
  const ids = new Set();
  return data.map((branch) => {
    if (
      !branch || typeof branch !== "object" || Array.isArray(branch) ||
      !Number.isSafeInteger(branch.BranchID) || branch.BranchID < 1 || branch.BranchID > 2147483647 ||
      ids.has(branch.BranchID) ||
      typeof branch.Name !== "string" || !branch.Name.trim() ||
      (branch.Location != null && typeof branch.Location !== "string") ||
      (branch.ContactNumber != null && typeof branch.ContactNumber !== "string")
    ) {
      throw new Error(unexpectedResponse);
    }
    ids.add(branch.BranchID);
    return {
      id: branch.BranchID,
      name: branch.Name.trim(),
      location: branch.Location?.trim() || "",
      contactNumber: branch.ContactNumber?.trim() || "",
    };
  });
}

export async function loadBranches(signal) {
  if (signal?.aborted) throw new DOMException("Request cancelled", "AbortError");
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, 10000);

  let response;
  let data;
  try {
    response = await fetch(`${API_BASE}/branches`, {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: controller.signal,
    });
    data = await response.json();
  } catch (error) {
    if (signal?.aborted) throw new DOMException("Request cancelled", "AbortError");
    if (timedOut) throw new Error("The branch service took too long to respond. Please try again.");
    if (error instanceof SyntaxError) throw new Error(unexpectedResponse);
    throw new Error("We couldn’t load our branches. Please try again.");
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
  }

  if (signal?.aborted) throw new DOMException("Request cancelled", "AbortError");
  if (!response.ok) throw new Error("We couldn’t load our branches. Please try again.");
  return validateBranches(data);
}
