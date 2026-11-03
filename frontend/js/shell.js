// App shell shared by the student, teacher and admin apps:
// sidebar + top bar + a tiny hash router (#/route/:param?query=1).
import { requireRole, logout } from "./auth.js";
import { avatar, errorState, h, icon, roleBadge, spinner } from "./ui.js";

const ROLE_LABEL = { student: "Student", teacher: "Teacher", admin: "Administrator" };

export function currentTheme() {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

export function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem("lms_theme", theme);
  } catch {
    /* storage unavailable */
  }
}

export function themeToggle() {
  const btn = h("button", { class: "icon-btn", type: "button", "aria-label": "Toggle dark mode", title: "Toggle dark mode" });
  const paint = () => btn.replaceChildren(icon(currentTheme() === "dark" ? "sun" : "moon"));
  btn.addEventListener("click", () => {
    setTheme(currentTheme() === "dark" ? "light" : "dark");
    paint();
  });
  paint();
  return btn;
}

/**
 * nav:    [{ id, label, icon, also?: [routeNames that keep this item highlighted] }]
 * routes: { "course/:id": async (params, ctx) => Node }
 */
export async function bootApp({ role, nav, routes, home = "dashboard" }) {
  const user = await requireRole(role);
  document.body.dataset.role = role;

  const root = document.getElementById("app");
  root.replaceChildren();

  const view = h("main", { class: "page", id: "view", tabindex: "-1" });
  const links = nav.map((item) =>
    h("a", { href: `#/${item.id}`, "data-id": item.id }, icon(item.icon), h("span", {}, item.label))
  );

  const closeMenu = () => root.classList.remove("menu-open");
  const sidebar = h("aside", { class: "sidebar", "aria-label": "Main navigation" },
    h("div", { class: "brand" }, h("span", { class: "logo" }, icon("cap", 20)), h("span", {}, "Lumen")),
    h("div", { class: "role-chip" }, ROLE_LABEL[role]),
    h("nav", { class: "nav" }, links),
    h("div", { class: "sidebar-foot" },
      h("div", { class: "user-card" }, avatar(user.name),
        h("div", { class: "user-meta" }, h("strong", {}, user.name), h("small", {}, user.email))),
      h("button", { class: "btn ghost block", type: "button", onclick: logout }, icon("logout", 16), "Sign out")));

  const topbar = h("header", { class: "topbar" },
    h("button", { class: "icon-btn menu-btn", type: "button", "aria-label": "Open menu", onclick: () => root.classList.toggle("menu-open") }, icon("menu")),
    h("span", { class: "topbar-title" }, "Lumen ", h("span", { class: "muted" }, "· " + ROLE_LABEL[role])),
    h("div", { class: "topbar-right" }, roleBadge(role), themeToggle(), h("a", { href: "#/profile", class: "topbar-user", "aria-label": "Your profile" }, avatar(user.name, "sm"))));

  root.append(sidebar, h("div", { class: "scrim", onclick: closeMenu }), h("div", { class: "main" }, topbar, view));

  // ---------------- router
  const table = Object.entries(routes).map(([pattern, handler]) => ({ segs: pattern.split("/"), handler }));
  const match = (pattern, actual) => {
    if (pattern.length !== actual.length) return null;
    const params = {};
    for (let i = 0; i < pattern.length; i++) {
      if (pattern[i].startsWith(":")) params[pattern[i].slice(1)] = actual[i];
      else if (pattern[i] !== actual[i]) return null;
    }
    return params;
  };

  let renderToken = 0;
  async function render() {
    const raw = location.hash.replace(/^#\/?/, "");
    const [pathPart, queryPart = ""] = raw.split("?");
    const segs = (pathPart || home).split("/").map(decodeURIComponent);
    const query = Object.fromEntries(new URLSearchParams(queryPart));
    const mine = ++renderToken;

    closeMenu();
    nav.forEach((item, i) => {
      const active = item.id === segs[0] || (item.also || []).includes(segs[0]);
      links[i].classList.toggle("active", active);
      if (active) links[i].setAttribute("aria-current", "page");
      else links[i].removeAttribute("aria-current");
    });

    let found = null;
    for (const entry of table) {
      const params = match(entry.segs, segs);
      if (params) {
        found = { handler: entry.handler, params };
        break;
      }
    }

    view.replaceChildren(spinner());
    const ctx = { user, query, view, refresh: render, navigate: (to) => { location.hash = `#/${to}`; } };
    try {
      const node = found
        ? await found.handler(found.params, ctx)
        : errorState({ status: 404, message: "That page doesn't exist." });
      if (mine !== renderToken) return; // user navigated away while loading
      view.replaceChildren(node);
    } catch (err) {
      if (mine !== renderToken) return;
      console.error(err);
      view.replaceChildren(errorState(err));
    }
    window.scrollTo(0, 0);
  }

  window.addEventListener("hashchange", render);
  await render();
  return { user };
}
