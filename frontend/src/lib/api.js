// Default: the local FastAPI dev server — no .env file needed for local
// development. Override with NEXT_PUBLIC_API_URL if the backend runs elsewhere.
const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api";

const TOKEN_KEY = "aida_token";

export function getToken() {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

export function setToken(token) {
  window.localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  window.localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function request(path, options = {}) {
  const token = getToken();
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });

  if (response.status === 401 && typeof window !== "undefined") {
    clearToken();
    if (!window.location.pathname.startsWith("/login")) {
      window.location.href = "/login";
    }
    throw new ApiError(401, "Session expired");
  }

  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const data = await response.json();
      if (data && typeof data.detail === "string") message = data.detail;
    } catch {
      /* keep default message */
    }
    throw new ApiError(response.status, message);
  }

  if (response.status === 204) return null;
  return response.json();
}

export const api = {
  register: (body) =>
    request("/v1/auth/register", { method: "POST", body: JSON.stringify(body) }),
  login: (body) =>
    request("/v1/auth/login", { method: "POST", body: JSON.stringify(body) }),
  me: () => request("/v1/auth/me"),

  listDatasources: () => request("/v1/datasources"),
  createDatasource: (body) =>
    request("/v1/datasources", { method: "POST", body: JSON.stringify(body) }),
  testDatasource: (body) =>
    request("/v1/datasources/test", { method: "POST", body: JSON.stringify(body) }),
  getSchema: (id) => request(`/v1/datasources/${id}/schema`),
  deleteDatasource: (id) =>
    request(`/v1/datasources/${id}`, { method: "DELETE" }),

  listConversations: (datasourceId) =>
    request(
      `/v1/chat/conversations${datasourceId ? `?datasource_id=${datasourceId}` : ""}`
    ),
  getMessages: (conversationId) =>
    request(`/v1/chat/conversations/${conversationId}/messages`),
  deleteConversation: (conversationId) =>
    request(`/v1/chat/conversations/${conversationId}`, { method: "DELETE" }),

  overview: () => request("/v1/analytics/overview"),
  recentCharts: (limit = 8) =>
    request(`/v1/analytics/recent-charts?limit=${limit}`),
};

/**
 * POST /api/v1/chat/stream — Server-Sent Events stream of pipeline steps and
 * the final result. Calls `onEvent({ event, data })` for every SSE frame.
 */
export async function streamAsk(body, onEvent, signal) {
  const token = getToken();
  const response = await fetch(`${API_BASE}/v1/chat/stream`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok || !response.body) {
    let message = `Stream failed (${response.status})`;
    try {
      const data = await response.json();
      if (data && typeof data.detail === "string") message = data.detail;
    } catch {
      /* keep default message */
    }
    throw new ApiError(response.status, message);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() || "";
    for (const part of parts) {
      const line = part.split("\n").find((item) => item.startsWith("data:"));
      if (!line) continue;
      try {
        onEvent(JSON.parse(line.slice(5).trim()));
      } catch {
        /* ignore malformed frame */
      }
    }
  }
}
