// Small UI toolkit. Everything is built with h() and text nodes, so user-supplied
// content is never interpreted as HTML (no XSS through innerHTML).

// ---------------------------------------------------------------- h()
export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  let value;
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "style" && typeof v === "object") {
      for (const [prop, val] of Object.entries(v)) {
        if (prop.startsWith("--")) el.style.setProperty(prop, val); // CSS custom property
        else el.style[prop] = val;
      }
    }
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === "value") value = v; // applied after children (needed for <select>)
    else el.setAttribute(k, v === true ? "" : v);
  }
  append(el, kids);
  if (value !== undefined) el.value = value;
  return el;
}

function append(el, kids) {
  for (const k of kids.flat(Infinity)) {
    if (k === undefined || k === null || k === false) continue;
    el.append(k.nodeType ? k : document.createTextNode(String(k)));
  }
}

export const $ = (sel, root = document) => root.querySelector(sel);

// -------------------------------------------------------------- icons
const ICONS = {
  home: '<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>',
  book: '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>',
  grid: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>',
  users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  clipboard: '<path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/>',
  award: '<circle cx="12" cy="8" r="7"/><polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>',
  moon: '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>',
  sun: '<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>',
  plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
  trash: '<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
  menu: '<line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  search: '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
  check: '<polyline points="20 6 9 17 4 12"/>',
  bell: '<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>',
  activity: '<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>',
  file: '<path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/>',
  help: '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
  x: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
  cap: '<path d="M22 10L12 5 2 10l10 5 10-5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/>',
  user: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  up: '<polyline points="18 15 12 9 6 15"/>',
  down: '<polyline points="6 9 12 15 18 9"/>',
  arrowLeft: '<line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>',
  arrowRight: '<line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>',
  clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  video: '<polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/>',
};

export function icon(name, size = 18) {
  const span = document.createElement("span");
  span.className = "icon";
  // ICONS holds only static, trusted markup defined above.
  span.innerHTML = `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ""}</svg>`;
  return span;
}

// ----------------------------------------------------------- formatting
export const first = (name = "") => name.split(" ")[0] || name;

export function initials(name = "") {
  const parts = name.replace(/^(Dr|Prof|Mr|Mrs|Ms)\.?\s+/i, "").split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] || "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase() || "?";
}

export function fmtDate(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

export function fmtDateTime(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleString(undefined, {
    day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit",
  });
}

export function timeAgo(iso) {
  if (!iso) return "";
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)} d ago`;
  return fmtDate(iso);
}

/** Human label + tone for a due date. */
export function dueInfo(iso) {
  if (!iso) return { text: "No due date", tone: "muted" };
  const ms = new Date(iso).getTime() - Date.now();
  const days = Math.ceil(ms / 86400000);
  if (ms < 0) return { text: `Overdue · ${fmtDate(iso)}`, tone: "danger" };
  if (days <= 2) return { text: `Due soon · ${fmtDateTime(iso)}`, tone: "warn" };
  return { text: `Due ${fmtDate(iso)}`, tone: "muted" };
}

export function toLocalInput(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function debounce(fn, ms = 300) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

// ----------------------------------------------------------- small parts
export const spinner = () => h("div", { class: "spinner-wrap" }, h("div", { class: "spinner", role: "status", "aria-label": "Loading" }));

export function badge(text, tone = "muted") {
  return h("span", { class: `badge ${tone}` }, text);
}

const STATUS_TONE = { draft: "muted", pending: "warn", published: "ok", archived: "muted" };
const STATUS_LABEL = { draft: "Draft", pending: "Pending review", published: "Published", archived: "Archived" };
export const statusBadge = (s) => badge(STATUS_LABEL[s] || s, STATUS_TONE[s] || "muted");

const ROLE_TONE = { student: "accent", teacher: "info", admin: "plum" };
export const roleBadge = (r) => badge(r[0].toUpperCase() + r.slice(1), ROLE_TONE[r] || "muted");

export function progressBar(pct, label = true) {
  return h(
    "div",
    { class: "progress-row" },
    h("div", { class: "progress", role: "progressbar", "aria-valuenow": pct, "aria-valuemin": 0, "aria-valuemax": 100 },
      h("span", { style: { width: `${pct}%` } })),
    label ? h("span", { class: "progress-label" }, `${pct}%`) : null
  );
}

export function avatar(name, size = "") {
  return h("span", { class: `avatar ${size}`, "aria-hidden": "true" }, initials(name));
}

export function emptyState(title, text, action) {
  return h("div", { class: "empty" }, h("div", { class: "empty-mark" }, icon("book", 26)), h("h3", {}, title), text ? h("p", {}, text) : null, action || null);
}

export function errorState(err) {
  const notFound = err.status === 404;
  return emptyState(notFound ? "Not found" : "Something went wrong", err.message || String(err),
    h("a", { class: "btn", href: "#/" }, "Back to start"));
}

export function pageHead(title, sub, actions) {
  return h("header", { class: "page-head" },
    h("div", {}, h("h1", {}, title), sub ? h("p", { class: "sub" }, sub) : null),
    actions ? h("div", { class: "page-actions" }, actions) : null);
}

export function section(title, content, action) {
  return h("section", { class: "section" },
    h("div", { class: "section-head" }, h("h2", {}, title), action || null), content);
}

export const card = (...kids) => h("div", { class: "card" }, ...kids);

export function statCard(label, value, hint, tone = "") {
  return h("div", { class: `stat ${tone}` },
    h("div", { class: "stat-label" }, label), h("div", { class: "stat-value" }, value),
    hint ? h("div", { class: "stat-hint" }, hint) : null);
}

export function backLink(href, text) {
  return h("a", { class: "back-link", href }, icon("arrowLeft", 16), text);
}

export function courseCover(course) {
  const hue = (course.id * 47) % 360;
  return h("div", { class: "cover", style: { "--h": String(hue) } },
    h("span", { class: "cover-cat" }, course.category),
    h("span", { class: "cover-mark" }, initials(course.title)));
}

export function courseCard(course, { href, footer } = {}) {
  const title = href ? h("a", { href }, course.title) : course.title;
  return h("article", { class: "course-card" },
    courseCover(course),
    h("div", { class: "course-body" },
      h("h3", {}, title),
      h("p", { class: "muted small" }, course.teacher.name),
      h("div", { class: "meta-row" },
        h("span", {}, icon("book", 14), `${course.lesson_count} lessons`),
        h("span", {}, icon("users", 14), `${course.student_count} students`)),
      footer || null));
}

// ------------------------------------------------------------- toasts
export function toast(message, type = "info") {
  let host = $(".toasts");
  if (!host) {
    host = h("div", { class: "toasts", "aria-live": "polite" });
    document.body.append(host);
  }
  const el = h("div", { class: `toast ${type}`, role: "status" }, message);
  host.append(el);
  setTimeout(() => {
    el.classList.add("out");
    setTimeout(() => el.remove(), 250);
  }, type === "error" ? 6000 : 3200);
}

// ------------------------------------------------------------- modals
export function modal({ title, body, actions = [], wide = false, onClose }) {
  const onKey = (e) => {
    if (e.key === "Escape") close();
  };
  const overlay = h("div", { class: "overlay", onmousedown: (e) => { if (e.target === overlay) close(); } });
  const box = h("div", { class: `modal${wide ? " wide" : ""}`, role: "dialog", "aria-modal": "true", "aria-label": title },
    h("div", { class: "modal-head" }, h("h3", {}, title),
      h("button", { class: "icon-btn", type: "button", "aria-label": "Close", onclick: () => close() }, icon("x"))),
    h("div", { class: "modal-body" }, body),
    actions.length ? h("div", { class: "modal-foot" }, actions) : null);
  overlay.append(box);
  document.body.append(overlay);
  document.addEventListener("keydown", onKey);
  function close() {
    document.removeEventListener("keydown", onKey);
    overlay.remove();
    if (onClose) onClose();
  }
  setTimeout(() => (box.querySelector("input:not([type=hidden]),textarea,select") || box).focus?.(), 30);
  return { close, el: box };
}

export function confirmDialog({ title, message, confirmText = "Confirm", danger = false }) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (v) => {
      if (!settled) {
        settled = true;
        resolve(v);
      }
    };
    const m = modal({
      title,
      body: h("p", {}, message),
      onClose: () => done(false),
      actions: [
        h("button", { class: "btn", type: "button", onclick: () => m.close() }, "Cancel"),
        h("button", { class: `btn ${danger ? "danger" : "primary"}`, type: "button", onclick: () => { done(true); m.close(); } }, confirmText),
      ],
    });
  });
}

let formCounter = 0;

/**
 * Modal with a form. fields: [{name,label,type,options,required,placeholder,hint,rows,accept,min,max}]
 * onSubmit(values) may throw: the message is shown inside the dialog.
 */
export function formModal({ title, fields, initial = {}, submitText = "Save", onSubmit, wide = false, intro }) {
  const inputs = {};
  const errorBox = h("div", { class: "form-error", role: "alert", hidden: true });
  const id = `f${++formCounter}`;

  const rows = fields.map((f) => {
    const value = initial[f.name] ?? f.value ?? "";
    const common = { id: `${id}-${f.name}`, name: f.name, required: f.required, placeholder: f.placeholder, min: f.min, max: f.max, autocomplete: f.autocomplete };
    let input;
    if (f.type === "textarea") input = h("textarea", { ...common, rows: f.rows || 4, value });
    else if (f.type === "select")
      input = h("select", { ...common, value }, f.options.map((o) => h("option", { value: o.value }, o.label)));
    else if (f.type === "file") input = h("input", { ...common, type: "file", accept: f.accept });
    else if (f.type === "checkbox") input = h("input", { ...common, type: "checkbox", checked: !!value });
    else if (f.type === "datetime") input = h("input", { ...common, type: "datetime-local", value: toLocalInput(value) });
    else input = h("input", { ...common, type: f.type || "text", value });
    inputs[f.name] = input;

    if (f.type === "checkbox")
      return h("label", { class: "check-row", for: common.id }, input, h("span", {}, f.label));
    return h("div", { class: "field" },
      h("label", { for: common.id }, f.label, f.required ? h("span", { class: "req" }, " *") : null),
      input, f.hint ? h("small", { class: "hint" }, f.hint) : null);
  });

  const cancel = h("button", { class: "btn", type: "button", onclick: () => m.close() }, "Cancel");
  const submit = h("button", { class: "btn primary", type: "submit" }, submitText);
  const form = h("form", {
    class: "form",
    novalidate: false,
    onsubmit: async (e) => {
      e.preventDefault();
      const values = {};
      for (const f of fields) {
        const el = inputs[f.name];
        if (f.type === "file") values[f.name] = el.files[0] || null;
        else if (f.type === "checkbox") values[f.name] = el.checked;
        else if (f.type === "number") values[f.name] = el.value === "" ? null : Number(el.value);
        else if (f.type === "datetime") values[f.name] = el.value ? new Date(el.value).toISOString() : null;
        else if (f.type === "password") values[f.name] = el.value;
        else values[f.name] = el.value.trim();
      }
      errorBox.hidden = true;
      submit.disabled = true;
      submit.classList.add("loading");
      try {
        await onSubmit(values);
        m.close();
      } catch (err) {
        errorBox.textContent = err.message || String(err);
        errorBox.hidden = false;
      } finally {
        submit.disabled = false;
        submit.classList.remove("loading");
      }
    },
  }, intro ? h("p", { class: "muted" }, intro) : null, rows, errorBox, h("div", { class: "modal-foot inline" }, cancel, submit));

  const m = modal({ title, body: form, wide });
  return m;
}

// ----------------------------------------------------- tables / paging
export function table(columns, rows, { empty = "Nothing here yet." } = {}) {
  if (!rows.length) return h("div", { class: "table-empty" }, empty);
  return h("div", { class: "table-wrap" },
    h("table", { class: "table" },
      h("thead", {}, h("tr", {}, columns.map((c) => h("th", { class: c.class || "" }, c.label)))),
      h("tbody", {}, rows.map((row) => h("tr", {}, columns.map((c) => h("td", { class: c.class || "", "data-label": c.label }, c.render(row))))))));
}

export function pagination({ page, limit, total, onPage }) {
  const pages = Math.max(1, Math.ceil(total / limit));
  if (pages <= 1) return h("div", {});
  return h("nav", { class: "pagination", "aria-label": "Pagination" },
    h("button", { class: "btn small", disabled: page <= 1, onclick: () => onPage(page - 1) }, icon("arrowLeft", 14), "Previous"),
    h("span", { class: "muted small" }, `Page ${page} of ${pages} · ${total} total`),
    h("button", { class: "btn small", disabled: page >= pages, onclick: () => onPage(page + 1) }, "Next", icon("arrowRight", 14)));
}

/** Show a busy state on a button while an async action runs; reports errors as toasts. */
export async function withBusy(button, action) {
  button.disabled = true;
  button.classList.add("loading");
  try {
    return await action();
  } catch (err) {
    toast(err.message || String(err), "error");
  } finally {
    button.disabled = false;
    button.classList.remove("loading");
  }
}

// ----------------------------------------------- lesson text + video
function inline(text) {
  return text.split(/(`[^`]+`|\*\*[^*]+\*\*)/).filter(Boolean).map((part) => {
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) return h("code", {}, part.slice(1, -1));
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) return h("strong", {}, part.slice(2, -2));
    return part;
  });
}

/** Tiny, safe text formatter: # headings, - lists, ``` code blocks, `code`, **bold**. */
export function renderContent(text = "") {
  const wrap = h("div", { class: "prose" });
  const lines = String(text).replace(/\r\n/g, "\n").split("\n");
  let para = [];
  let list = null;
  const flushPara = () => {
    if (para.length) wrap.append(h("p", {}, inline(para.join(" "))));
    para = [];
  };
  const flushList = () => {
    if (list) wrap.append(h("ul", {}, list.map((li) => h("li", {}, inline(li)))));
    list = null;
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim().startsWith("```")) {
      flushPara(); flushList();
      const code = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) code.push(lines[i++]);
      wrap.append(h("pre", {}, h("code", {}, code.join("\n"))));
      continue;
    }
    const heading = line.match(/^(#{1,3})\s+(.*)/);
    if (heading) {
      flushPara(); flushList();
      wrap.append(h(`h${heading[1].length + 2}`, {}, inline(heading[2])));
      continue;
    }
    const item = line.match(/^\s*[-*]\s+(.*)/);
    if (item) {
      flushPara();
      (list = list || []).push(item[1]);
      continue;
    }
    if (!line.trim()) {
      flushPara(); flushList();
      continue;
    }
    flushList();
    para.push(line.trim());
  }
  flushPara(); flushList();
  return wrap;
}

/** Returns an embedded player for YouTube/Vimeo links, or a plain link for other http(s) URLs. */
export function videoEmbed(rawUrl) {
  if (!rawUrl) return null;
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (!["http:", "https:"].includes(url.protocol)) return null;
  const host = url.hostname.replace(/^www\./, "");
  let src = null;
  if (host === "youtu.be") src = `https://www.youtube.com/embed/${url.pathname.slice(1)}`;
  else if (host.endsWith("youtube.com")) {
    const id = url.searchParams.get("v") || (url.pathname.match(/\/(?:embed|shorts)\/([\w-]+)/) || [])[1];
    if (id) src = `https://www.youtube.com/embed/${id}`;
  } else if (host === "vimeo.com") {
    const id = url.pathname.slice(1).split("/")[0];
    if (/^\d+$/.test(id)) src = `https://player.vimeo.com/video/${id}`;
  }
  if (src && /^https:\/\/[\w.]+\/(embed|video)\/[\w-]+$/.test(src))
    return h("div", { class: "video" }, h("iframe", { src, title: "Lesson video", allowfullscreen: true, loading: "lazy", referrerpolicy: "strict-origin-when-cross-origin" }));
  return h("a", { class: "btn", href: url.href, target: "_blank", rel: "noopener noreferrer" }, icon("video", 16), "Open lesson video");
}
