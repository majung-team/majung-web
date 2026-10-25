export class AccountError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

// Provider credentials and access tokens are never accepted by this client.
// The browser carries only its HttpOnly session cookie; CSRF stays in page memory.
export function createAccountClient(fetcher = globalThis.fetch) {
  let csrfToken = null;
  return async function accountRequest(path, { method = "GET", body } = {}) {
    if (!/^\/(auth\/session|auth\/logout|accounts\/me|accounts\/search(?:\?.*)?|connections(?:\?.*|\/[a-f0-9-]+\/(?:accept|reject|cancel|disconnect))?)$/.test(path)) {
      throw new Error("Unknown account endpoint");
    }
    const headers = { Accept: "application/json" };
    if (method !== "GET") {
      if (!csrfToken) throw new AccountError(403, "CSRF_REQUIRED", "페이지를 다시 연 뒤 시도해주세요.");
      headers["X-CSRF-TOKEN"] = csrfToken;
    }
    if (body !== undefined) headers["Content-Type"] = "application/json";
    let response;
    try {
      response = await fetcher(`/api/v1${path}`, {
        method, headers, credentials: "same-origin", cache: "no-store", redirect: "error",
        referrerPolicy: "no-referrer", signal: AbortSignal.timeout(8000),
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new AccountError(0, "NETWORK_ERROR", method === "GET"
        ? "연결을 확인한 뒤 다시 불러와주세요."
        : "처리 결과를 확인하지 못했어요. 목록을 새로 확인한 뒤 다시 시도해주세요.");
    }
    let data = null;
    if (response.status !== 204) {
      try { data = await response.json(); }
      catch { throw new AccountError(response.status, "INVALID_RESPONSE", "응답을 확인하지 못했어요. 잠시 후 다시 불러와주세요."); }
    }
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) csrfToken = null;
      // Show only this service's stable error envelope, never provider or proxy HTML.
      const message = typeof data?.code === "string" && typeof data?.message === "string"
        ? data.message : "요청을 처리하지 못했어요. 잠시 후 다시 시도해주세요.";
      throw new AccountError(response.status, data?.code, message);
    }
    if (path === "/auth/session") csrfToken = data?.csrfToken || null;
    if (path === "/auth/logout") csrfToken = null;
    return data;
  };
}
