import { API_BASE } from "./session";

const unexpectedResponse = "The service catalogue returned an unexpected response. Please try again.";

function validateServices(data) {
  if (!Array.isArray(data)) throw new Error(unexpectedResponse);
  const ids = new Set();
  for (const service of data) {
    if (
      !service || typeof service !== "object" || Array.isArray(service) ||
      !Number.isSafeInteger(service.ServiceID) || service.ServiceID < 1 || service.ServiceID > 2147483647 ||
      ids.has(service.ServiceID) ||
      typeof service.ServiceName !== "string" || !service.ServiceName.trim() ||
      (service.Description !== null && typeof service.Description !== "string") ||
      !Number.isFinite(service.UnitPrice) || service.UnitPrice < 0 ||
      ![true, false, 1, 0].includes(service.IsActive)
    ) {
      throw new Error(unexpectedResponse);
    }
    ids.add(service.ServiceID);
  }
  return data.filter((service) => service.IsActive === true || service.IsActive === 1);
}

export async function loadServiceCatalogue(signal) {
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
    response = await fetch(`${API_BASE}/services`, {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: controller.signal,
    });
    data = await response.json();
  } catch (error) {
    if (signal?.aborted) throw new DOMException("Request cancelled", "AbortError");
    if (timedOut) throw new Error("The service catalogue took too long to respond. Please try again.");
    if (error instanceof SyntaxError) throw new Error(unexpectedResponse);
    throw new Error("The service catalogue is unavailable. Please try again.");
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
  }

  if (signal?.aborted) throw new DOMException("Request cancelled", "AbortError");
  if (!response.ok) {
    throw new Error(
      typeof data?.error === "string" && data.error.trim()
        ? data.error
        : "Unable to load the service catalogue. Please try again.",
    );
  }
  return validateServices(data);
}
