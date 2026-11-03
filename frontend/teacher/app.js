import { api, download } from "/js/api.js";
import { profilePage } from "/js/profile.js";
import { bootApp } from "/js/shell.js";
import {
  avatar, backLink, badge, card, confirmDialog, courseCard, dueInfo, emptyState, first, fmtDate,
  fmtDateTime, formModal, h, icon, modal, pageHead, progressBar, renderContent, section,
  statCard, statusBadge, table, timeAgo, toast, withBusy,
} from "/js/ui.js";

const fmtScore = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
const CATEGORIES = ["General", "Programming", "Web", "Mathematics", "Science", "Computer Science", "Languages", "Business", "Arts"];

async function remove({ title, message, path, done }) {
  const ok = await confirmDialog({ title, message, confirmText: "Delete", danger: true });
  if (!ok) return;
  try {
    await api(path, { method: "DELETE" });
    toast("Deleted", "success");
    done();
  } catch (err) {
    toast(err.message, "error");
  }
}

const courseFields = (c = {}) => [
  { name: "title", label: "Course title", required: true, value: c.title, placeholder: "e.g. Introduction to Biology" },
  { name: "category", label: "Category", type: "select", value: c.category || "General", options: [...new Set([...(c.category ? [c.category] : []), ...CATEGORIES])].map((v) => ({ value: v, label: v })) },
  { name: "description", label: "Description", type: "textarea", rows: 5, value: c.description, hint: "Shown to students in the catalog." },
];

// ====================================================================
// Dashboard
// ====================================================================
async function dashboard(_, ctx) {
  const d = await api("/teacher/summary");
  const s = d.stats;

  const queue = card(
    h("h3", { class: "card-title" }, "Waiting to be graded"),
    d.ungraded.length
      ? h("div", { class: "list" }, d.ungraded.map((u) =>
          h("div", { class: "list-item" },
            avatar(u.student, "sm"),
            h("div", { class: "grow" },
              h("a", { class: "title", href: `#/assignment/${u.assignment_id}` }, u.assignment_title),
              h("div", { class: "small muted" }, `${u.student} · ${u.course_title} · ${timeAgo(u.submitted_at)}`)),
            h("a", { class: "btn small", href: `#/assignment/${u.assignment_id}` }, "Grade"))))
      : h("p", { class: "muted" }, "All caught up. Nothing is waiting for a grade."));

  return h("div", {},
    pageHead(`Hello, ${first(ctx.user.name)}`, "Here's what's happening in your classes.",
      h("button", { class: "btn primary", type: "button", onclick: () => newCourse(ctx) }, icon("plus", 16), "New course")),
    h("div", { class: "grid stats" },
      statCard("My courses", s.courses, `${s.published} published`, "accent"),
      statCard("Students", s.students, "across your courses"),
      statCard("To grade", s.ungraded, "submissions", s.ungraded ? "warn" : "")),
    h("div", { class: "grid two", style: { marginTop: "30px" } },
      queue,
      card(
        h("h3", { class: "card-title" }, "Recent courses"),
        d.courses.length
          ? h("div", { class: "list" }, d.courses.map((c) =>
              h("div", { class: "list-item" },
                h("div", { class: "grow" }, h("a", { class: "title", href: `#/course/${c.id}` }, c.title),
                  h("div", { class: "small muted" }, `${c.lesson_count} lessons · ${c.student_count} students`)),
                statusBadge(c.status))))
          : h("p", { class: "muted" }, "You haven't created a course yet."))));
}

function newCourse(ctx) {
  formModal({
    title: "Create a course",
    fields: courseFields(),
    submitText: "Create course",
    onSubmit: async (v) => {
      const c = await api("/courses", { method: "POST", body: { title: v.title, category: v.category, description: v.description } });
      toast("Course created. Add some lessons next.", "success");
      ctx.navigate(`course/${c.id}`);
    },
  });
}

// ====================================================================
// Courses list
// ====================================================================
async function courses(_, ctx) {
  const list = await api("/teacher/courses");
  return h("div", {},
    pageHead("My courses", `${list.length} course${list.length === 1 ? "" : "s"}`,
      h("button", { class: "btn primary", type: "button", onclick: () => newCourse(ctx) }, icon("plus", 16), "New course")),
    list.length
      ? h("div", { class: "grid cards" }, list.map((c) => courseCard(c, { href: `#/course/${c.id}`, footer: h("div", { class: "row cta" }, statusBadge(c.status)) })))
      : emptyState("Create your first course", "Build lessons, assignments and quizzes, then submit it for review to publish it to students.",
          h("button", { class: "btn primary", type: "button", onclick: () => newCourse(ctx) }, "New course")));
}

// ====================================================================
// Course editor (lessons / assignments / quizzes / students / announcements)
// ====================================================================
async function courseEditor({ id }, ctx) {
  const course = await api(`/courses/${id}`);
  if (!course.can_manage) throw Object.assign(new Error("You can only manage your own courses."), { status: 403 });

  let tab = ctx.query.tab || "lessons";
  let roster = null;
  const root = h("div");
  const reload = () => ctx.refresh();

  // ----------------------------------------------------------- lessons
  const lessonForm = (l = {}) => [
    { name: "title", label: "Lesson title", required: true, value: l.title },
    { name: "video_url", label: "Video link (optional)", type: "url", value: l.video_url, placeholder: "https://www.youtube.com/watch?v=…", hint: "YouTube and Vimeo links play inside the lesson." },
    { name: "content", label: "Lesson content", type: "textarea", rows: 10, value: l.content, hint: "Supports # headings, - lists, ``` code blocks, `inline code` and **bold**." },
  ];

  function addLesson() {
    formModal({
      title: "New lesson", wide: true, fields: lessonForm(), submitText: "Add lesson",
      onSubmit: async (v) => {
        await api(`/courses/${course.id}/lessons`, { method: "POST", body: { title: v.title, content: v.content, video_url: v.video_url } });
        toast("Lesson added", "success");
        reload();
      },
    });
  }

  function editLesson(l) {
    formModal({
      title: "Edit lesson", wide: true, fields: lessonForm(l), initial: l,
      onSubmit: async (v) => {
        await api(`/lessons/${l.id}`, { method: "PUT", body: { title: v.title, content: v.content, video_url: v.video_url } });
        toast("Lesson saved", "success");
        reload();
      },
    });
  }

  function manageFiles(l) {
    const listBox = h("div", { class: "list" });
    const draw = () => {
      listBox.replaceChildren(
        ...(l.materials.length
          ? l.materials.map((m) =>
              h("div", { class: "list-item" },
                icon("file", 18),
                h("button", { class: "btn ghost small grow", type: "button", style: { justifyContent: "flex-start" }, onclick: (e) => withBusy(e.currentTarget, () => download(`/materials/${m.id}/download`, m.filename)) }, m.filename),
                h("button", {
                  class: "icon-btn sm danger", type: "button", "aria-label": `Delete ${m.filename}`,
                  onclick: async () => {
                    try {
                      await api(`/materials/${m.id}`, { method: "DELETE" });
                      l.materials = l.materials.filter((x) => x.id !== m.id);
                      draw();
                    } catch (err) { toast(err.message, "error"); }
                  },
                }, icon("trash", 16))))
          : [h("p", { class: "muted" }, "No files attached yet.")]));
    };
    draw();
    const input = h("input", { type: "file", id: "mat-file" });
    const btn = h("button", { class: "btn primary", type: "button" }, icon("upload", 16), "Upload");
    btn.addEventListener("click", () => {
      if (!input.files[0]) return toast("Choose a file first", "error");
      withBusy(btn, async () => {
        const fd = new FormData();
        fd.append("file", input.files[0]);
        const m = await api(`/lessons/${l.id}/materials`, { method: "POST", form: fd });
        l.materials.push(m);
        input.value = "";
        draw();
        toast("File uploaded", "success");
      });
    });
    modal({
      title: `Files · ${l.title}`, onClose: reload,
      body: h("div", { class: "stack" }, listBox,
        h("div", { class: "field" }, h("label", { for: "mat-file" }, "Add a file"), input, h("small", { class: "hint" }, "Max 10 MB. Students can download these from the lesson.")), btn),
    });
  }

  async function move(index, delta) {
    const ids = course.lessons.map((l) => l.id);
    const target = index + delta;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    try {
      await api(`/courses/${course.id}/lessons/reorder`, { method: "POST", body: { ids } });
      reload();
    } catch (err) { toast(err.message, "error"); }
  }

  function lessonsTab() {
    const add = h("button", { class: "btn primary", type: "button", onclick: addLesson }, icon("plus", 16), "Add lesson");
    if (!course.lessons.length) return emptyState("No lessons yet", "Add your first lesson to start building the course.", add);
    return h("div", {},
      h("div", { class: "row between", style: { marginBottom: "14px" } }, h("p", { class: "muted", style: { margin: 0 } }, "Use the arrows to reorder lessons."), add),
      card(h("div", { class: "list" }, course.lessons.map((l, i) =>
        h("div", { class: "list-item" },
          h("span", { class: "badge" }, String(i + 1)),
          h("div", { class: "grow" }, h("div", { class: "title" }, l.title),
            h("div", { class: "small muted" }, `${l.materials.length} file${l.materials.length === 1 ? "" : "s"}${l.video_url ? " · video" : ""}`)),
          h("div", { class: "list-actions" },
            h("button", { class: "icon-btn sm", type: "button", "aria-label": "Move up", disabled: i === 0, onclick: () => move(i, -1) }, icon("up", 16)),
            h("button", { class: "icon-btn sm", type: "button", "aria-label": "Move down", disabled: i === course.lessons.length - 1, onclick: () => move(i, 1) }, icon("down", 16)),
            h("button", { class: "icon-btn sm", type: "button", "aria-label": "Files", title: "Files", onclick: () => manageFiles(l) }, icon("upload", 16)),
            h("button", { class: "icon-btn sm", type: "button", "aria-label": "Edit lesson", title: "Edit", onclick: () => editLesson(l) }, icon("edit", 16)),
            h("button", { class: "icon-btn sm danger", type: "button", "aria-label": "Delete lesson", title: "Delete", onclick: () => remove({ title: "Delete lesson?", message: `"${l.title}" and its files will be permanently deleted.`, path: `/lessons/${l.id}`, done: reload }) }, icon("trash", 16))))))));
  }

  // ------------------------------------------------------- assignments
  const assignmentFields = (a = {}) => [
    { name: "title", label: "Title", required: true, value: a.title },
    { name: "description", label: "Instructions", type: "textarea", rows: 6, value: a.description },
    { name: "due_date", label: "Due date", type: "datetime", value: a.due_date || "", hint: "Leave empty for no deadline." },
    { name: "max_score", label: "Maximum score", type: "number", min: 1, max: 1000, required: true, value: a.max_score || 100 },
  ];
  const assignmentBody = (v) => ({ title: v.title, description: v.description, due_date: v.due_date, max_score: v.max_score || 100 });

  function assignmentsTab() {
    const add = h("button", {
      class: "btn primary", type: "button",
      onclick: () => formModal({ title: "New assignment", fields: assignmentFields(), submitText: "Create", onSubmit: async (v) => {
        await api(`/courses/${course.id}/assignments`, { method: "POST", body: assignmentBody(v) });
        toast("Assignment created", "success");
        reload();
      } }),
    }, icon("plus", 16), "New assignment");
    if (!course.assignments.length) return emptyState("No assignments yet", "Create an assignment for students to submit work.", add);
    return h("div", {},
      h("div", { class: "row between", style: { marginBottom: "14px" } }, h("span", {}), add),
      card(h("div", { class: "list" }, course.assignments.map((a) => {
        const due = dueInfo(a.due_date);
        return h("div", { class: "list-item" },
          h("div", { class: "grow" },
            h("a", { class: "title", href: `#/assignment/${a.id}` }, a.title),
            h("div", { class: `small tone-${due.tone}` }, due.text)),
          h("span", { class: "small muted" }, `${a.submission_count} submitted`),
          a.ungraded_count ? badge(`${a.ungraded_count} to grade`, "warn") : null,
          h("div", { class: "list-actions" },
            h("a", { class: "btn small", href: `#/assignment/${a.id}` }, "Submissions"),
            h("button", { class: "icon-btn sm", type: "button", "aria-label": "Edit", onclick: () => formModal({ title: "Edit assignment", fields: assignmentFields(a), submitText: "Save", onSubmit: async (v) => {
              await api(`/assignments/${a.id}`, { method: "PUT", body: assignmentBody(v) });
              toast("Assignment saved", "success");
              reload();
            } }) }, icon("edit", 16)),
            h("button", { class: "icon-btn sm danger", type: "button", "aria-label": "Delete", onclick: () => remove({ title: "Delete assignment?", message: `"${a.title}" and all of its submissions will be permanently deleted.`, path: `/assignments/${a.id}`, done: reload }) }, icon("trash", 16))));
      }))));
  }

  // ----------------------------------------------------------- quizzes
  function quizBuilder() {
    const questions = [{ text: "", options: ["", ""], correct: 0 }];
    const title = h("input", { required: true, placeholder: "e.g. Chapter 1 quiz" });
    const box = h("div");

    const draw = () => box.replaceChildren(...questions.map((q, qi) =>
      h("div", { class: "builder-q" },
        h("div", { class: "row between", style: { marginBottom: "8px" } },
          h("strong", {}, `Question ${qi + 1}`),
          questions.length > 1 ? h("button", { class: "icon-btn sm danger", type: "button", "aria-label": "Remove question", onclick: () => { questions.splice(qi, 1); draw(); } }, icon("trash", 15)) : null),
        h("input", { value: q.text, placeholder: "Question text", "aria-label": `Question ${qi + 1} text`, oninput: (e) => (q.text = e.target.value) }),
        q.options.map((opt, oi) =>
          h("div", { class: "builder-opt" },
            h("input", { type: "radio", name: `correct-${qi}`, checked: q.correct === oi, "aria-label": "Mark as correct answer", title: "Correct answer", onchange: () => (q.correct = oi) }),
            h("input", { value: opt, placeholder: `Option ${oi + 1}`, "aria-label": `Question ${qi + 1} option ${oi + 1}`, oninput: (e) => (q.options[oi] = e.target.value) }),
            q.options.length > 2 ? h("button", { class: "icon-btn sm", type: "button", "aria-label": "Remove option", onclick: () => { q.options.splice(oi, 1); if (q.correct >= q.options.length) q.correct = 0; else if (q.correct > oi) q.correct--; draw(); } }, icon("x", 14)) : null)),
        q.options.length < 6 ? h("button", { class: "btn small", type: "button", style: { marginTop: "10px" }, onclick: () => { q.options.push(""); draw(); } }, icon("plus", 14), "Add option") : null)));
    draw();

    const submit = h("button", { class: "btn primary", type: "submit" }, "Create quiz");
    const form = h("form", { class: "form", onsubmit: (e) => {
      e.preventDefault();
      const payload = questions.map((q) => ({ text: q.text.trim(), options: q.options.map((o) => o.trim()), correct_index: q.correct }));
      if (payload.some((q) => !q.text)) return toast("Every question needs text", "error");
      if (payload.some((q) => q.options.some((o) => !o))) return toast("Fill in or remove empty options", "error");
      withBusy(submit, async () => {
        await api(`/courses/${course.id}/quizzes`, { method: "POST", body: { title: title.value.trim(), questions: payload } });
        toast("Quiz created", "success");
        m.close();
        reload();
      });
    } },
      h("div", { class: "field" }, h("label", {}, "Quiz title"), title),
      h("p", { class: "small muted", style: { margin: 0 } }, "Select the radio button next to the correct answer."),
      box,
      h("button", { class: "btn", type: "button", onclick: () => { questions.push({ text: "", options: ["", ""], correct: 0 }); draw(); } }, icon("plus", 16), "Add question"),
      h("div", { class: "modal-foot inline" }, h("button", { class: "btn", type: "button", onclick: () => m.close() }, "Cancel"), submit));
    const m = modal({ title: "New quiz", body: form, wide: true });
  }

  async function showAttempts(q) {
    try {
      const data = await api(`/quizzes/${q.id}/attempts`);
      modal({
        title: `Results · ${data.quiz.title}`, wide: true,
        body: table(
          [
            { label: "Student", render: (r) => r.student.name },
            { label: "Score", render: (r) => `${r.score} / ${r.total}` },
            { label: "Taken", render: (r) => fmtDateTime(r.taken_at) },
          ],
          data.attempts, { empty: "No attempts yet." }),
      });
    } catch (err) { toast(err.message, "error"); }
  }

  function quizzesTab() {
    const add = h("button", { class: "btn primary", type: "button", onclick: quizBuilder }, icon("plus", 16), "New quiz");
    if (!course.quizzes.length) return emptyState("No quizzes yet", "Multiple-choice quizzes are graded automatically.", add);
    return h("div", {},
      h("div", { class: "row between", style: { marginBottom: "14px" } }, h("span", {}), add),
      card(h("div", { class: "list" }, course.quizzes.map((q) =>
        h("div", { class: "list-item" },
          h("div", { class: "grow" }, h("div", { class: "title" }, q.title), h("div", { class: "small muted" }, `${q.question_count} questions · ${q.attempt_count} attempts`)),
          h("div", { class: "list-actions" },
            h("button", { class: "btn small", type: "button", onclick: () => showAttempts(q) }, "Results"),
            h("button", { class: "icon-btn sm danger", type: "button", "aria-label": "Delete quiz", onclick: () => remove({ title: "Delete quiz?", message: `"${q.title}" and all attempts will be permanently deleted.`, path: `/quizzes/${q.id}`, done: reload }) }, icon("trash", 16))))))));
  }

  // ---------------------------------------------------------- students
  function studentsTab() {
    const holder = h("div");
    const fill = (rows) => holder.replaceChildren(table(
      [
        { label: "Student", render: (r) => h("div", { class: "cell-user" }, avatar(r.name, "sm"), h("div", {}, r.name, h("small", {}, r.email))) },
        { label: "Enrolled", render: (r) => fmtDate(r.enrolled_at) },
        { label: "Progress", render: (r) => h("div", { style: { minWidth: "150px" } }, progressBar(r.progress)) },
      ],
      rows, { empty: "No students have enrolled yet." }));
    if (roster) fill(roster);
    else {
      holder.append(h("p", { class: "muted" }, "Loading…"));
      api(`/courses/${course.id}/students`).then((r) => { roster = r; fill(r); }).catch((e) => holder.replaceChildren(h("p", { class: "tone-danger" }, e.message)));
    }
    return holder;
  }

  // ----------------------------------------------------- announcements
  function newsTab() {
    const text = h("textarea", { rows: 3, placeholder: "Share an update with everyone enrolled…", "aria-label": "Announcement" });
    const btn = h("button", { class: "btn primary", type: "submit" }, "Post announcement");
    const form = h("form", { class: "form", onsubmit: (e) => {
      e.preventDefault();
      if (!text.value.trim()) return;
      withBusy(btn, async () => {
        await api(`/courses/${course.id}/announcements`, { method: "POST", body: { message: text.value.trim() } });
        toast("Announcement posted", "success");
        reload();
      });
    } }, text, h("div", {}, btn));
    return h("div", { class: "stack" },
      card(form),
      course.announcements.length
        ? card(h("div", { class: "list" }, course.announcements.map((a) =>
            h("div", { class: "list-item" },
              h("div", { class: "grow" }, h("div", { class: "small muted" }, `${a.author.name} · ${fmtDateTime(a.created_at)}`), h("p", { style: { margin: "4px 0 0" } }, a.message)),
              h("button", { class: "icon-btn sm danger", type: "button", "aria-label": "Delete announcement", onclick: () => remove({ title: "Delete announcement?", message: "This announcement will be removed for everyone.", path: `/announcements/${a.id}`, done: reload }) }, icon("trash", 16))))))
        : null);
  }

  // ---------------------------------------------------------- settings
  function settingsTab() {
    const submitReview = () =>
      withBusy(document.getElementById("review-btn"), async () => {
        await api(`/courses/${course.id}/submit-review`, { method: "POST" });
        toast("Submitted for review", "success");
        reload();
      });

    const status = {
      draft: h("div", { class: "note" }, "This course is a draft and is only visible to you. Add at least one lesson, then submit it for review to publish it to students.",
        h("div", { style: { marginTop: "12px" } }, h("button", { id: "review-btn", class: "btn primary", type: "button", disabled: !course.lessons.length, onclick: submitReview }, "Submit for review"))),
      pending: h("div", { class: "note warn" }, "Waiting for an administrator to review and publish this course."),
      published: h("div", { class: "note ok" }, "This course is published and visible in the student catalog."),
      archived: h("div", { class: "note warn" }, "This course is archived. Existing students keep access, but it is hidden from the catalog."),
    }[course.status];

    return h("div", { class: "stack" },
      card(h("div", { class: "row between" }, h("h3", {}, "Publishing"), statusBadge(course.status)), h("div", { style: { marginTop: "14px" } }, status)),
      card(h("h3", { class: "card-title" }, "Course details"),
        h("button", { class: "btn", type: "button", onclick: () => formModal({ title: "Edit course", fields: courseFields(course), submitText: "Save", onSubmit: async (v) => {
          await api(`/courses/${course.id}`, { method: "PUT", body: { title: v.title, category: v.category, description: v.description } });
          toast("Course saved", "success");
          reload();
        } }) }, icon("edit", 16), "Edit title, category and description")),
      h("div", { class: "card danger-zone" }, h("h3", { class: "card-title" }, "Danger zone"),
        h("p", { class: "muted" }, "Deleting a course removes its lessons, files, assignments, submissions and quizzes permanently."),
        h("button", { class: "btn danger", type: "button", onclick: () => remove({ title: "Delete this course?", message: `"${course.title}" and everything in it will be permanently deleted.`, path: `/courses/${course.id}`, done: () => ctx.navigate("courses") }) }, icon("trash", 16), "Delete course")));
  }

  // -------------------------------------------------------------- draw
  const tabs = [
    ["lessons", "Lessons", course.lessons.length, lessonsTab],
    ["assignments", "Assignments", course.assignments.length, assignmentsTab],
    ["quizzes", "Quizzes", course.quizzes.length, quizzesTab],
    ["students", "Students", course.student_count, studentsTab],
    ["news", "Announcements", course.announcements.length, newsTab],
    ["settings", "Settings", 0, settingsTab],
  ];
  if (!tabs.some((t) => t[0] === tab)) tab = "lessons";

  function draw() {
    const active = tabs.find((t) => t[0] === tab);
    root.replaceChildren(
      backLink("#/courses", "My courses"),
      h("div", { class: "course-hero" },
        h("div", {}, h("div", { class: "row" }, h("h1", {}, course.title), statusBadge(course.status)),
          h("p", { class: "muted", style: { margin: "6px 0 0" } }, `${course.category} · ${course.teacher.name}`))),
      h("div", { class: "tabs", role: "tablist" }, tabs.map(([key, label, count]) =>
        h("button", { class: `tab${tab === key ? " active" : ""}`, type: "button", role: "tab", "aria-selected": String(tab === key),
          onclick: () => { tab = key; history.replaceState(null, "", `#/course/${course.id}?tab=${key}`); draw(); } },
          label, count ? h("span", { class: "count" }, count) : null))),
      active[3]());
  }

  draw();
  return root;
}

// ====================================================================
// Submissions and grading
// ====================================================================
async function assignmentPage({ id }, ctx) {
  const data = await api(`/assignments/${id}/submissions`);
  const a = data.assignment;
  const due = dueInfo(a.due_date);

  function openGrade(s) {
    const score = h("input", { type: "number", min: 0, max: a.max_score, step: "0.5", required: true, id: "g-score", value: s.score ?? "" });
    const feedback = h("textarea", { rows: 4, id: "g-fb", placeholder: "Feedback for the student…", value: s.feedback || "" });
    const err = h("div", { class: "form-error", hidden: true, role: "alert" });
    const btn = h("button", { class: "btn primary", type: "submit" }, "Save grade");
    const fileBtn = s.filename
      ? h("button", { class: "btn small", type: "button", onclick: (e) => withBusy(e.currentTarget, () => download(`/submissions/${s.id}/file`, s.filename)) }, icon("download", 15), s.filename)
      : null;
    const form = h("form", { class: "form", onsubmit: async (e) => {
      e.preventDefault();
      err.hidden = true;
      btn.disabled = true;
      try {
        await api(`/submissions/${s.id}/grade`, { method: "PUT", body: { score: Number(score.value), feedback: feedback.value.trim() } });
        toast("Grade saved", "success");
        m.close();
        ctx.refresh();
      } catch (ex) { err.textContent = ex.message; err.hidden = false; btn.disabled = false; }
    } },
      h("div", { class: "row" }, avatar(s.student.name), h("div", {}, h("strong", {}, s.student.name), h("div", { class: "small muted" }, `Submitted ${fmtDateTime(s.submitted_at)}${s.late ? " (late)" : ""}`))),
      s.text ? h("div", { class: "pre-text" }, s.text) : h("p", { class: "muted" }, "No written answer."),
      fileBtn,
      h("div", { class: "field" }, h("label", { for: "g-score" }, `Score (out of ${a.max_score})`), score),
      h("div", { class: "field" }, h("label", { for: "g-fb" }, "Feedback"), feedback),
      err,
      h("div", { class: "modal-foot inline" }, h("button", { class: "btn", type: "button", onclick: () => m.close() }, "Cancel"), btn));
    const m = modal({ title: s.score === null ? "Grade submission" : "Edit grade", body: form, wide: true });
  }

  return h("div", {},
    backLink(`#/course/${a.course.id}?tab=assignments`, a.course.title),
    pageHead(a.title, `${a.max_score} points`),
    h("div", { class: "row", style: { marginBottom: "20px" } }, h("span", { class: `small tone-${due.tone}` }, due.text), badge(`${data.submissions.length} submitted`, "info"), data.not_submitted ? badge(`${data.not_submitted} not yet submitted`, "muted") : null),
    a.description ? card(h("h3", { class: "card-title" }, "Instructions"), renderContent(a.description)) : null,
    section("Submissions", table(
      [
        { label: "Student", render: (s) => h("div", { class: "cell-user" }, avatar(s.student.name, "sm"), h("div", {}, s.student.name, h("small", {}, s.student.email))) },
        { label: "Submitted", render: (s) => h("span", {}, fmtDateTime(s.submitted_at), s.late ? h("span", {}, " ", badge("late", "warn")) : null) },
        { label: "Status", render: (s) => (s.score === null ? badge("Needs grading", "warn") : badge(`${fmtScore(s.score)} / ${a.max_score}`, "ok")) },
        { label: "", class: "actions", render: (s) => h("button", { class: `btn small${s.score === null ? " primary" : ""}`, type: "button", onclick: () => openGrade(s) }, s.score === null ? "Grade" : "Edit grade") },
      ],
      data.submissions, { empty: "No submissions yet." })));
}

// ====================================================================
bootApp({
  role: "teacher",
  nav: [
    { id: "dashboard", label: "Dashboard", icon: "home" },
    { id: "courses", label: "My courses", icon: "book", also: ["course", "assignment"] },
    { id: "profile", label: "Profile", icon: "user" },
  ],
  routes: {
    dashboard,
    courses,
    "course/:id": courseEditor,
    "assignment/:id": assignmentPage,
    profile: (_, ctx) => profilePage(ctx.user),
  },
});
