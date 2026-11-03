import { api, getToken } from "./api.js";

const HOME = { student: "/student/", teacher: "/teacher/", admin: "/admin/" };

export const homeFor = (role) => HOME[role] || "/login.html";

export function saveSession({ access_token, user }) {
  localStorage.setItem("lms_token", access_token);
  localStorage.setItem("lms_user", JSON.stringify(user));
}

export function clearSession() {
  localStorage.removeItem("lms_token");
  localStorage.removeItem("lms_user");
}

export function logout() {
  clearSession();
  location.href = "/login.html";
}

const forever = () => new Promise(() => {}); // stop the page script while redirecting

/** Route guard: resolves with the current user, or redirects and never resolves. */
export async function requireRole(...roles) {
  if (!getToken()) {
    location.replace("/login.html");
    return forever();
  }
  let user;
  try {
    user = await api("/auth/me");
  } catch (err) {
    if (err.status !== 401) {
      document.body.textContent = err.message;
    }
    return forever();
  }
  if (!roles.includes(user.role)) {
    location.replace(homeFor(user.role));
    return forever();
  }
  localStorage.setItem("lms_user", JSON.stringify(user));
  return user;
}
