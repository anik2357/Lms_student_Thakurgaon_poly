import { api, qs } from "/js/api.js";
import { profilePage } from "/js/profile.js";
import { bootApp } from "/js/shell.js";
import {
  avatar, badge, card, confirmDialog, debounce, emptyState, errorState, first, fmtDate, fmtDateTime,
  formModal, h, icon, pageHead, pagination, roleBadge, section, spinner, statCard, statusBadge, table,
  timeAgo, toast,
} from "/js/ui.js";

// ====================================================================
// Overview
// ====================================================================
async function overview(_, ctx) {
  const s = await api("/admin/stats");
  const max = Math.max(1, ...s.signups.map((d) => d.count));
  const roleMax = Math.max(1, s.users.student, s.users.teacher, s.users.admin);
  const courseMax = Math.max(1, s.courses.published, s.courses.pending, s.courses.draft, s.courses.archived);

  const bars = (rows, total) =>
    h("div", { class: "bars" }, rows.map(([label, value]) =>
      h("div", { class: "bar-row" }, h("span", {}, label), h("div", { class: "bar-track" }, h("span", { style: { width: `${(value / total) * 100}%` } })), h("b", {}, String(value)))));

  const attention = [];
  if (s.users.pending_teachers) attention.push(h("div", { class: "note warn" }, h("strong", {}, `${s.users.pending_teachers} teacher account${s.users.pending_teachers === 1 ? "" : "s"}`), " waiting for approval. ", h("a", { href: "#/users?status=inactive&role=teacher" }, "Review")));
  if (s.courses.pending) attention.push(h("div", { class: "note warn" }, h("strong", {}, `${s.courses.pending} course${s.courses.pending === 1 ? "" : "s"}`), " waiting to be published. ", h("a", { href: "#/courses?status=pending" }, "Review")));

  return h("div", {},
    pageHead(`Hello, ${first(ctx.user.name)}`, "A snapshot of the whole platform."),
    attention.length ? h("div", { class: "stack", style: { marginBottom: "24px" } }, attention) : null,
    h("div", { class: "grid stats" },
      statCard("Users", s.users.total, `${s.users.student} students · ${s.users.teacher} teachers`, "accent"),
      statCard("Courses", s.courses.total, `${s.courses.published} published`),
      statCard("Enrollments", s.enrollments),
      statCard("Submissions", s.submissions, `${s.quiz_attempts} quiz attempts`)),
    h("div", { class: "grid two", style: { marginTop: "30px" } },
      card(h("h3", { class: "card-title" }, "New sign-ups, last 7 days"),
        h("div", { class: "columns", role: "img", "aria-label": `Sign-ups per day: ${s.signups.map((d) => d.count).join(", ")}` },
          s.signups.map((d) => h("div", { class: "col" }, h("b", {}, d.count || ""), h("i", { style: { height: `${(d.count / max) * 100}%` } }),
            h("span", {}, new Date(d.date + "T00:00:00").toLocaleDateString(undefined, { weekday: "short" })))))),
      card(h("h3", { class: "card-title" }, "Users by role"), bars([["Students", s.users.student], ["Teachers", s.users.teacher], ["Admins", s.users.admin]], roleMax))),
    h("div", { style: { marginTop: "18px" } },
      card(h("h3", { class: "card-title" }, "Courses by status"),
        bars([["Published", s.courses.published], ["Pending", s.courses.pending], ["Draft", s.courses.draft], ["Archived", s.courses.archived]], courseMax))));
}

// ====================================================================
// Users
// ====================================================================
const userFields = (u = {}, creating = false) => [
  { name: "name", label: "Full name", required: true, value: u.name },
  ...(creating ? [{ name: "email", label: "Email", type: "email", required: true }] : []),
  { name: "role", label: "Role", type: "select", value: u.role || "student", options: [{ value: "student", label: "Student" }, { value: "teacher", label: "Teacher" }, { value: "admin", label: "Administrator" }] },
  { name: "password", label: creating ? "Password" : "New password (optional)", type: "password", required: creating, autocomplete: "new-password", hint: creating ? "At least 6 characters" : "Leave empty to keep the current password." },
];

async function users(_, ctx) {
  const state = {
    search: ctx.query.search || "", role: ctx.query.role || "", status: ctx.query.status || "", page: 1,
  };
  const results = h("div");
  const search = h("input", { type: "search", placeholder: "Search name or email…", "aria-label": "Search users", value: state.search });
  const role = h("select", { "aria-label": "Role", value: state.role },
    h("option", { value: "" }, "All roles"), h("option", { value: "student" }, "Students"), h("option", { value: "teacher" }, "Teachers"), h("option", { value: "admin" }, "Admins"));
  const status = h("select", { "aria-label": "Status", value: state.status },
    h("option", { value: "" }, "Any status"), h("option", { value: "active" }, "Active"), h("option", { value: "inactive" }, "Inactive / pending"));

  search.addEventListener("input", debounce(() => { state.search = search.value.trim(); state.page = 1; load(); }));
  role.addEventListener("change", () => { state.role = role.value; state.page = 1; load(); });
  status.addEventListener("change", () => { state.status = status.value; state.page = 1; load(); });

  async function setActive(u, active) {
    try {
      await api(`/admin/users/${u.id}`, { method: "PUT", body: { is_active: active } });
      toast(active ? `${u.name} activated` : `${u.name} deactivated`, "success");
      load();
    } catch (err) { toast(err.message, "error"); }
  }

  function edit(u) {
    formModal({
      title: `Edit ${u.name}`, fields: userFields(u), initial: u, submitText: "Save",
      onSubmit: async (v) => {
        const body = { name: v.name, role: v.role };
        if (v.password) body.password = v.password;
        await api(`/admin/users/${u.id}`, { method: "PUT", body });
        toast("User updated", "success");
        load();
      },
    });
  }

  async function del(u) {
    const ok = await confirmDialog({
      title: "Delete this user?",
      message: `${u.name} (${u.email}) will be permanently deleted along with ${u.role === "teacher" ? "their courses, " : ""}their submissions and progress. This cannot be undone.`,
      confirmText: "Delete user", danger: true,
    });
    if (!ok) return;
    try {
      await api(`/admin/users/${u.id}`, { method: "DELETE" });
      toast("User deleted", "success");
      load();
    } catch (err) { toast(err.message, "error"); }
  }

  async function load() {
    results.replaceChildren(spinner());
    try {
      const data = await api("/admin/users" + qs({ search: state.search, role: state.role, status: state.status, page: state.page, limit: 15 }));
      const mine = ctx.user.id;
      results.replaceChildren(
        table([
          { label: "User", render: (u) => h("div", { class: "cell-user" }, avatar(u.name, "sm"), h("div", {}, u.name, u.id === mine ? h("span", {}, " ", badge("you", "muted")) : null, h("small", {}, u.email))) },
          { label: "Role", render: (u) => roleBadge(u.role) },
          { label: "Status", render: (u) => (u.is_active ? badge("Active", "ok") : badge(u.role === "teacher" ? "Pending approval" : "Deactivated", "warn")) },
          { label: "Joined", render: (u) => fmtDate(u.created_at) },
          { label: "", class: "actions", render: (u) => h("div", { class: "list-actions", style: { justifyContent: "flex-end" } },
            u.is_active
              ? (u.id !== mine ? h("button", { class: "btn small", type: "button", onclick: () => setActive(u, false) }, "Deactivate") : null)
              : h("button", { class: "btn small primary", type: "button", onclick: () => setActive(u, true) }, u.role === "teacher" ? "Approve" : "Activate"),
            h("button", { class: "icon-btn sm", type: "button", "aria-label": `Edit ${u.name}`, onclick: () => edit(u) }, icon("edit", 16)),
            u.id !== mine ? h("button", { class: "icon-btn sm danger", type: "button", "aria-label": `Delete ${u.name}`, onclick: () => del(u) }, icon("trash", 16)) : null) },
        ], data.items, { empty: "No users match these filters." }),
        pagination({ page: data.page, limit: data.limit, total: data.total, onPage: (p) => { state.page = p; load(); } }));
    } catch (err) {
      results.replaceChildren(errorState(err));
    }
  }

  load();
  return h("div", {},
    pageHead("Users", "Manage accounts, roles and teacher approvals.",
      h("button", { class: "btn primary", type: "button", onclick: () => formModal({
        title: "Add a user", fields: userFields({}, true), submitText: "Create user",
        onSubmit: async (v) => {
          await api("/admin/users", { method: "POST", body: { name: v.name, email: v.email, role: v.role, password: v.password } });
          toast("User created", "success");
          load();
        },
      }) }, icon("plus", 16), "Add user")),
    h("div", { class: "filters" }, h("div", { class: "search" }, icon("search", 16), search), role, status),
    results);
}

// ====================================================================
// Courses (moderation)
// ====================================================================
async function courses(_, ctx) {
  const state = { search: "", status: ctx.query.status || "", page: 1 };
  const results = h("div");
  const search = h("input", { type: "search", placeholder: "Search by title…", "aria-label": "Search courses" });
  const status = h("select", { "aria-label": "Status", value: state.status },
    h("option", { value: "" }, "All statuses"), h("option", { value: "pending" }, "Pending review"), h("option", { value: "published" }, "Published"),
    h("option", { value: "draft" }, "Draft"), h("option", { value: "archived" }, "Archived"));
  search.addEventListener("input", debounce(() => { state.search = search.value.trim(); state.page = 1; load(); }));
  status.addEventListener("change", () => { state.status = status.value; state.page = 1; load(); });

  async function setStatus(c, next, message) {
    try {
      await api(`/admin/courses/${c.id}/status`, { method: "PUT", body: { status: next } });
      toast(message, "success");
      load();
    } catch (err) { toast(err.message, "error"); }
  }

  async function del(c) {
    const ok = await confirmDialog({ title: "Delete this course?", message: `"${c.title}" and all of its lessons, files, submissions and quizzes will be permanently deleted.`, confirmText: "Delete course", danger: true });
    if (!ok) return;
    try {
      await api(`/courses/${c.id}`, { method: "DELETE" });
      toast("Course deleted", "success");
      load();
    } catch (err) { toast(err.message, "error"); }
  }

  const actions = (c) => {
    const out = [];
    if (c.status === "pending" || c.status === "draft")
      out.push(h("button", { class: "btn small primary", type: "button", onclick: () => setStatus(c, "published", "Course published") }, "Publish"));
    if (c.status === "pending")
      out.push(h("button", { class: "btn small", type: "button", onclick: () => setStatus(c, "draft", "Sent back to the teacher as a draft") }, "Send back"));
    if (c.status === "published")
      out.push(h("button", { class: "btn small", type: "button", onclick: () => setStatus(c, "archived", "Course archived") }, "Archive"));
    if (c.status === "archived")
      out.push(h("button", { class: "btn small", type: "button", onclick: () => setStatus(c, "published", "Course published") }, "Restore"));
    out.push(h("button", { class: "icon-btn sm danger", type: "button", "aria-label": `Delete ${c.title}`, onclick: () => del(c) }, icon("trash", 16)));
    return h("div", { class: "list-actions", style: { justifyContent: "flex-end" } }, out);
  };

  async function load() {
    results.replaceChildren(spinner());
    try {
      const data = await api("/admin/courses" + qs({ search: state.search, status: state.status, page: state.page, limit: 15 }));
      results.replaceChildren(
        table([
          { label: "Course", render: (c) => h("div", {}, h("strong", {}, c.title), h("div", { class: "small muted" }, c.category)) },
          { label: "Teacher", render: (c) => c.teacher.name },
          { label: "Status", render: (c) => statusBadge(c.status) },
          { label: "Content", render: (c) => h("span", { class: "small muted" }, `${c.lesson_count} lessons · ${c.student_count} students`) },
          { label: "", class: "actions", render: actions },
        ], data.items, { empty: "No courses match these filters." }),
        pagination({ page: data.page, limit: data.limit, total: data.total, onPage: (p) => { state.page = p; load(); } }));
    } catch (err) {
      results.replaceChildren(errorState(err));
    }
  }

  load();
  return h("div", {},
    pageHead("Courses", "Review submitted courses and moderate the catalog."),
    h("div", { class: "filters" }, h("div", { class: "search" }, icon("search", 16), search), status),
    results);
}

// ====================================================================
// Audit log
// ====================================================================
async function audit() {
  const state = { page: 1 };
  const results = h("div");

  const tone = (action) => (action.includes("delete") ? "danger" : action.includes("create") || action.includes("register") ? "ok" : action.includes("status") || action.includes("update") ? "info" : "muted");

  async function load() {
    results.replaceChildren(spinner());
    try {
      const data = await api("/admin/audit-log" + qs({ page: state.page, limit: 25 }));
      results.replaceChildren(
        table([
          { label: "When", render: (r) => h("span", { title: fmtDateTime(r.created_at) }, timeAgo(r.created_at)) },
          { label: "Who", render: (r) => r.actor },
          { label: "Action", render: (r) => badge(r.action, tone(r.action)) },
          { label: "Details", render: (r) => h("span", { class: "small" }, r.detail) },
        ], data.items, { empty: "No activity recorded yet." }),
        pagination({ page: data.page, limit: data.limit, total: data.total, onPage: (p) => { state.page = p; load(); } }));
    } catch (err) {
      results.replaceChildren(errorState(err));
    }
  }

  load();
  return h("div", {}, pageHead("Audit log", "A record of important changes across the platform."), results);
}

// ====================================================================
bootApp({
  role: "admin",
  nav: [
    { id: "overview", label: "Overview", icon: "grid" },
    { id: "users", label: "Users", icon: "users" },
    { id: "courses", label: "Courses", icon: "book" },
    { id: "audit", label: "Audit log", icon: "activity" },
    { id: "profile", label: "Profile", icon: "user" },
  ],
  home: "overview",
  routes: {
    overview,
    users,
    courses,
    audit,
    profile: (_, ctx) => profilePage(ctx.user),
  },
});
