// Thin wrapper around fetch(): auth header, JSON, error handling.
const BASE = "/api/v1";

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const getToken = () => localStorage.getItem("lms_token");

export function qs(params = {}) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") sp.set(k, v);
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

async function toError(res) {
  let detail;
  try {
    detail = (await res.json()).detail;
  } catch {
    /* body was not JSON */
  }
  if (Array.isArray(detail)) {
    detail = detail
      .map((d) => `${(d.loc || []).slice(1).join(".") || "field"}: ${d.msg}`)
      .join("; ");
  }
  return new ApiError(res.status, detail || res.statusText || "Request failed");
}

async function request(path, { method = "GET", body, form } = {}) {
  const headers = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  let payload;
  if (form) {
    payload = form; // FormData: the browser sets the multipart boundary
  } else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }

  let res;
  try {
    res = await fetch(BASE + path, { method, headers, body: payload });
  } catch {
    throw new ApiError(0, "Cannot reach the server. Check your connection and try again.");
  }

  // An expired/invalid session anywhere except the login form sends the user back to sign in.
  if (res.status === 401 && token && !path.startsWith("/auth/login")) {
    localStorage.removeItem("lms_token");
    localStorage.removeItem("lms_user");
    location.href = "/login.html?expired=1";
    throw new ApiError(401, "Your session has expired");
  }
  if (!res.ok) throw await toError(res);
  return res;
}

export async function api(path, options) {
  const res = await request(path, options);
  if (res.status === 204) return null;
  const type = res.headers.get("content-type") || "";
  return type.includes("json") ? res.json() : res.text();
}

// Files need the Authorization header, so we fetch them as a blob and save that.
export async function download(path, filename) {
  const res = await request(path);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename || "download";
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
