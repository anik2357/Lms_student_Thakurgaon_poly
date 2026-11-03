import { api, download, qs } from "/js/api.js";
import { profilePage } from "/js/profile.js";
import { bootApp } from "/js/shell.js";
import {
  backLink, badge, card, confirmDialog, courseCard, dueInfo, emptyState, errorState, first, fmtDate,
  fmtDateTime, h, icon, pageHead, pagination, progressBar, renderContent, section, spinner, statCard,
  table, timeAgo, toast, videoEmbed, withBusy,
} from "/js/ui.js";

const fmtScore = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
const pctTone = (p) => (p >= 75 ? "ok" : p >= 50 ? "warn" : "danger");

// ====================================================================
// Dashboard
// ====================================================================
async function dashboard(_, { user }) {
  const d = await api("/me/dashboard");
  const s = d.stats;

  const deadlines = card(
    h("h3", { class: "card-title" }, "Upcoming deadlines"),
    d.deadlines.length
      ? h("div", { class: "list" }, d.deadlines.map((a) => {
          const due = dueInfo(a.due_date);
          return h("div", { class: "list-item" },
            h("div", { class: "grow" },
              h("a", { class: "title", href: `#/assignment/${a.assignment_id}` }, a.title),
              h("div", { class: "small muted" }, a.course_title)),
            h("span", { class: `small tone-${due.tone}` }, due.text));
        }))
      : h("p", { class: "muted" }, "Nothing due. Enjoy the breathing room."));

  const news = card(
    h("h3", { class: "card-title" }, "Latest announcements"),
    d.announcements.length
      ? h("div", { class: "list" }, d.announcements.map((a) =>
          h("div", { class: "list-item" },
            h("div", { class: "grow" },
              h("div", { class: "row" }, badge(a.course_title, "accent"), h("span", { class: "small muted" }, `${a.author.name} · ${timeAgo(a.created_at)}`)),
              h("p", { style: { margin: "6px 0 0" } }, a.message)))))
      : h("p", { class: "muted" }, "No announcements yet."));

  return h("div", {},
    pageHead(`Welcome back, ${first(user.name)}`, "Pick up where you left off."),
    h("div", { class: "grid stats" },
      statCard("Enrolled courses", s.enrolled, null, "accent"),
      statCard("Average progress", `${s.avg_progress}%`),
      statCard("To do", s.pending_assignments, "assignments not submitted", s.pending_assignments ? "warn" : ""),
      statCard("Average grade", s.avg_grade == null ? "-" : `${s.avg_grade}%`, "assignments and quizzes")),
    section(
      "Continue learning",
      d.courses.length
        ? h("div", { class: "grid cards" }, d.courses.map((c) => courseCard(c, { href: `#/course/${c.id}`, footer: progressBar(c.progress) })))
        : emptyState("No courses yet", "Browse the catalog to find your first course.", h("a", { class: "btn primary", href: "#/catalog" }, "Browse courses")),
      d.courses.length ? h("a", { class: "btn small", href: "#/my-courses" }, "All my courses") : null),
    h("div", { class: "grid two", style: { marginTop: "34px" } }, deadlines, news));
}

// ====================================================================
// Catalog and my courses
// ====================================================================
async function catalog(_, ctx) {
  const categories = await api("/categories");
  const state = { search: "", category: "", page: 1 };
  const results = h("div");

  const search = h("input", { type: "search", placeholder: "Search courses…", "aria-label": "Search courses" });
  const select = h("select", { "aria-label": "Category" },
    h("option", { value: "" }, "All categories"), categories.map((c) => h("option", { value: c }, c)));

  let timer;
  search.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(() => { state.search = search.value.trim(); state.page = 1; load(); }, 300);
  });
  select.addEventListener("change", () => { state.category = select.value; state.page = 1; load(); });

  async function load() {
    results.replaceChildren(spinner());
    try {
      const data = await api("/courses" + qs({ search: state.search, category: state.category, page: state.page, limit: 12 }));
      if (!data.items.length) {
        results.replaceChildren(emptyState("No courses found", "Try a different search or category."));
        return;
      }
      const grid = h("div", { class: "grid cards" }, data.items.map((c) =>
        courseCard(c, {
          href: `#/course/${c.id}`,
          footer: h("div", { class: "row cta" },
            c.enrolled
              ? h("a", { class: "btn small", href: `#/course/${c.id}` }, "Continue")
              : h("button", {
                  class: "btn primary small", type: "button",
                  onclick: (e) => withBusy(e.currentTarget, async () => {
                    await api(`/courses/${c.id}/enroll`, { method: "POST" });
                    toast("Enrolled. Happy learning!", "success");
                    ctx.navigate(`course/${c.id}`);
                  }),
                }, "Enroll"),
            h("a", { class: "small", href: `#/course/${c.id}` }, "Details")),
        })));
      results.replaceChildren(grid, pagination({ page: data.page, limit: data.limit, total: data.total, onPage: (p) => { state.page = p; load(); } }));
    } catch (err) {
      results.replaceChildren(errorState(err));
    }
  }

  load();
  return h("div", {},
    pageHead("Browse courses", "Find something new to learn."),
    h("div", { class: "filters" }, h("div", { class: "search" }, icon("search", 16), search), select),
    results);
}

async function myCourses() {
  const courses = await api("/me/courses");
  return h("div", {},
    pageHead("My courses", `${courses.length} enrolled`, h("a", { class: "btn primary", href: "#/catalog" }, icon("plus", 16), "Find more courses")),
    courses.length
      ? h("div", { class: "grid cards" }, courses.map((c) => courseCard(c, { href: `#/course/${c.id}`, footer: progressBar(c.progress) })))
      : emptyState("You haven't enrolled in anything yet", "Browse the catalog and enroll in a course to get started.", h("a", { class: "btn primary", href: "#/catalog" }, "Browse courses")));
}

// ====================================================================
// Course page (preview for non-enrolled, learning view for enrolled)
// ====================================================================
async function coursePage({ id }, ctx) {
  const data = await api(`/courses/${id}`);
  return data.has_access ? learningView(data, ctx) : previewView(data, ctx);
}

function previewView(data, ctx) {
  return h("div", {},
    backLink("#/catalog", "All courses"),
    h("div", { class: "grid two" },
      card(
        h("div", { class: "row" }, badge(data.category, "accent")),
        h("h1", { style: { margin: "10px 0 6px" } }, data.title),
        h("p", { class: "muted" }, `Taught by ${data.teacher.name}`),
        renderContent(data.description || "No description yet."),
        h("button", {
          class: "btn primary", type: "button",
          onclick: (e) => withBusy(e.currentTarget, async () => {
            await api(`/courses/${data.id}/enroll`, { method: "POST" });
            toast("Enrolled. Happy learning!", "success");
            ctx.refresh();
          }),
        }, "Enroll in this course")),
      card(
        h("h3", { class: "card-title" }, "What you'll learn"),
        data.lessons.length
          ? h("ol", { class: "prose", style: { paddingLeft: "1.2em", margin: 0 } }, data.lessons.map((l) => h("li", {}, l.title)))
          : h("p", { class: "muted" }, "Lessons will appear here soon."),
        h("p", { class: "small muted", style: { marginTop: "14px" } }, `${data.lesson_count} lessons · ${data.student_count} students enrolled`))));
}

function learningView(data, ctx) {
  let tab = "lessons";
  let currentId = (data.lessons.find((l) => !l.done) || data.lessons[0] || {}).id;
  const root = h("div");

  const tabDefs = () => [
    ["lessons", "Lessons", data.lessons.length],
    ["assignments", "Assignments", data.assignments.length],
    ["quizzes", "Quizzes", data.quizzes.length],
    ["news", "Announcements", data.announcements.length],
  ];

  async function setDone(lesson, done) {
    const r = await api(`/lessons/${lesson.id}/complete`, { method: done ? "POST" : "DELETE" });
    lesson.done = done;
    data.progress = r.progress;
    if (done) {
      const next = data.lessons[data.lessons.findIndex((l) => l.id === lesson.id) + 1];
      toast(next ? "Lesson complete. On to the next one!" : "Lesson complete!", "success");
      if (next) currentId = next.id;
    }
    draw();
  }

  function lessonsTab() {
    if (!data.lessons.length) return emptyState("No lessons yet", "Your teacher hasn't added lessons to this course.");
    const idx = Math.max(0, data.lessons.findIndex((l) => l.id === currentId));
    const lesson = data.lessons[idx];
    const prev = data.lessons[idx - 1];
    const next = data.lessons[idx + 1];

    const nav = h("div", { class: "card lesson-nav" }, data.lessons.map((l, i) =>
      h("button", {
        type: "button", class: `lesson-link${l.id === lesson.id ? " active" : ""}${l.done ? " done" : ""}`,
        onclick: () => { currentId = l.id; draw(); },
      }, h("span", { class: "dot" }, l.done ? icon("check", 13) : String(i + 1)), h("span", {}, l.title))));

    const materials = lesson.materials.length
      ? h("div", { class: "materials" }, lesson.materials.map((m) =>
          h("button", {
            class: "btn small", type: "button",
            onclick: (e) => withBusy(e.currentTarget, () => download(`/materials/${m.id}/download`, m.filename)),
          }, icon("download", 15), m.filename)))
      : null;

    const body = card(h("div", { class: "lesson-body" },
      h("h2", {}, lesson.title),
      videoEmbed(lesson.video_url),
      lesson.content ? renderContent(lesson.content) : h("p", { class: "muted" }, "This lesson has no written content."),
      materials,
      h("div", { class: "lesson-foot" },
        h("div", { class: "row" },
          h("button", { class: "btn small", type: "button", disabled: !prev, onclick: () => { currentId = prev.id; draw(); } }, icon("arrowLeft", 14), "Previous"),
          h("button", { class: "btn small", type: "button", disabled: !next, onclick: () => { currentId = next.id; draw(); } }, "Next", icon("arrowRight", 14))),
        lesson.done
          ? h("button", { class: "btn", type: "button", onclick: (e) => withBusy(e.currentTarget, () => setDone(lesson, false)) }, icon("check", 16), "Completed · undo")
          : h("button", { class: "btn primary", type: "button", onclick: (e) => withBusy(e.currentTarget, () => setDone(lesson, true)) }, "Mark as complete"))));

    return h("div", { class: "learn" }, nav, body);
  }

  function assignmentsTab() {
    if (!data.assignments.length) return emptyState("No assignments", "Nothing to submit in this course yet.");
    return card(h("div", { class: "list" }, data.assignments.map((a) => {
      const sub = a.submission;
      const due = dueInfo(a.due_date);
      let status;
      if (sub && sub.score !== null) status = badge(`Graded ${fmtScore(sub.score)} / ${a.max_score}`, "ok");
      else if (sub) status = badge(sub.late ? "Submitted late" : "Submitted", "info");
      else status = badge("Not submitted", due.tone === "danger" ? "danger" : "muted");
      return h("div", { class: "list-item" },
        h("div", { class: "grow" },
          h("a", { class: "title", href: `#/assignment/${a.id}` }, a.title),
          h("div", { class: `small tone-${due.tone}` }, due.text)),
        status);
    })));
  }

  function quizzesTab() {
    if (!data.quizzes.length) return emptyState("No quizzes", "There are no quizzes in this course yet.");
    return card(h("div", { class: "list" }, data.quizzes.map((q) => {
      const a = q.attempt;
      return h("div", { class: "list-item" },
        h("div", { class: "grow" },
          h("div", { class: "title" }, q.title),
          h("div", { class: "small muted" }, `${q.question_count} questions${a ? ` · ${a.count} attempt${a.count === 1 ? "" : "s"}` : ""}`)),
        a ? badge(`Best ${a.best} / ${a.total}`, pctTone((a.best / a.total) * 100)) : null,
        h("a", { class: `btn small${a ? "" : " primary"}`, href: `#/quiz/${q.id}` }, a ? "Retake" : "Take quiz"));
    })));
  }

  function newsTab() {
    if (!data.announcements.length) return emptyState("No announcements", "Your teacher hasn't posted anything yet.");
    return card(h("div", { class: "list" }, data.announcements.map((a) =>
      h("div", { class: "list-item" },
        h("div", { class: "grow" },
          h("div", { class: "small muted" }, `${a.author.name} · ${fmtDateTime(a.created_at)}`),
          h("p", { style: { margin: "4px 0 0" } }, a.message))))));
  }

  function draw() {
    const views = { lessons: lessonsTab, assignments: assignmentsTab, quizzes: quizzesTab, news: newsTab };
    root.replaceChildren(
      backLink("#/my-courses", "My courses"),
      h("div", { class: "course-hero" },
        h("div", {}, h("h1", {}, data.title), h("p", { class: "muted", style: { margin: "6px 0 0" } }, `${data.teacher.name} · ${data.category}`)),
        h("div", { class: "stack" },
          progressBar(data.progress),
          h("button", {
            class: "btn ghost small", type: "button",
            onclick: async () => {
              const ok = await confirmDialog({ title: "Leave this course?", message: "Your progress and submissions are kept if you enroll again.", confirmText: "Leave course", danger: true });
              if (!ok) return;
              try {
                await api(`/courses/${data.id}/enroll`, { method: "DELETE" });
                toast("You left the course");
                ctx.navigate("my-courses");
              } catch (err) { toast(err.message, "error"); }
            },
          }, "Leave course"))),
      h("div", { class: "tabs", role: "tablist" }, tabDefs().map(([key, label, count]) =>
        h("button", {
          class: `tab${tab === key ? " active" : ""}`, type: "button", role: "tab", "aria-selected": String(tab === key),
          onclick: () => { tab = key; draw(); },
        }, label, count ? h("span", { class: "count" }, count) : null))),
      views[tab]());
  }

  draw();
  return root;
}

// ====================================================================
// Assignment
// ====================================================================
async function assignmentPage({ id }, ctx) {
  const a = await api(`/assignments/${id}`);
  const sub = a.submission;
  const due = dueInfo(a.due_date);
  const graded = sub && sub.score !== null;

  let submissionCard;
  if (graded) {
    const pct = Math.round((sub.score / a.max_score) * 100);
    submissionCard = card(
      h("h3", { class: "card-title" }, "Your grade"),
      h("div", { class: "row" }, h("span", { class: "stat-value" }, `${fmtScore(sub.score)} / ${a.max_score}`), badge(`${pct}%`, pctTone(pct))),
      sub.feedback ? h("div", { class: "note", style: { margin: "14px 0" } }, h("strong", {}, "Feedback: "), sub.feedback) : null,
      h("p", { class: "small muted" }, `Submitted ${fmtDateTime(sub.submitted_at)}. Graded work can't be changed.`),
      sub.text ? h("div", { class: "pre-text" }, sub.text) : null,
      sub.filename ? h("button", { class: "btn small", style: { marginTop: "12px" }, type: "button", onclick: (e) => withBusy(e.currentTarget, () => download(`/submissions/${sub.id}/file`, sub.filename)) }, icon("download", 15), sub.filename) : null);
  } else {
    const text = h("textarea", { rows: 9, placeholder: "Type your answer or paste your code…", value: sub ? sub.text : "" });
    const file = h("input", { type: "file", id: "sub-file" });
    const btn = h("button", { class: "btn primary", type: "submit" }, sub ? "Update submission" : "Submit assignment");
    const form = h("form", {
      class: "form",
      onsubmit: (e) => {
        e.preventDefault();
        if (!text.value.trim() && !file.files[0] && !(sub && sub.filename)) return toast("Write an answer or attach a file first", "error");
        withBusy(btn, async () => {
          const fd = new FormData();
          fd.append("text", text.value);
          if (file.files[0]) fd.append("file", file.files[0]);
          await api(`/assignments/${a.id}/submit`, { method: "POST", form: fd });
          toast(sub ? "Submission updated" : "Submitted. Good luck!", "success");
          ctx.refresh();
        });
      },
    },
      sub ? h("div", { class: `note ${sub.late ? "warn" : "ok"}` }, `Submitted ${fmtDateTime(sub.submitted_at)}${sub.late ? " (late)" : ""}. You can still update it until it is graded.`) : null,
      sub && sub.filename ? h("p", { class: "small" }, "Attached: ", h("button", { class: "btn small", type: "button", onclick: (e) => withBusy(e.currentTarget, () => download(`/submissions/${sub.id}/file`, sub.filename)) }, icon("download", 14), sub.filename)) : null,
      h("div", { class: "field" }, h("label", { for: "sub-text" }, "Your answer"), Object.assign(text, { id: "sub-text" })),
      h("div", { class: "field" }, h("label", { for: "sub-file" }, "Attach a file (optional)"), file,
        h("small", { class: "hint" }, sub && sub.filename ? "Choosing a new file replaces the current one. Max 10 MB." : "PDF, Office documents, images, text, code or ZIP. Max 10 MB.")),
      due.tone === "danger" && !sub ? h("div", { class: "note warn" }, "This assignment is past its due date. You can still submit, but it will be marked late.") : null,
      h("div", {}, btn));
    submissionCard = card(h("h3", { class: "card-title" }, sub ? "Your submission" : "Submit your work"), form);
  }

  return h("div", {},
    backLink(`#/course/${a.course.id}`, a.course.title),
    pageHead(a.title, null),
    h("div", { class: "row", style: { marginBottom: "20px" } },
      badge(`${a.max_score} points`, "accent"),
      h("span", { class: `small tone-${due.tone}` }, icon("clock", 14), " ", due.text)),
    h("div", { class: "grid two" },
      card(h("h3", { class: "card-title" }, "Instructions"), a.description ? renderContent(a.description) : h("p", { class: "muted" }, "No instructions provided.")),
      submissionCard));
}

// ====================================================================
// Quiz
// ====================================================================
async function quizPage({ id }) {
  const quiz = await api(`/quizzes/${id}`);
  const answers = quiz.questions.map(() => -1);
  const root = h("div");

  function drawForm() {
    const btn = h("button", { class: "btn primary", type: "submit" }, "Submit answers");
    const form = h("form", {
      class: "form",
      onsubmit: (e) => {
        e.preventDefault();
        const unanswered = answers.filter((a) => a < 0).length;
        if (unanswered && !confirm(`${unanswered} question${unanswered === 1 ? " is" : "s are"} unanswered. Submit anyway?`)) return;
        withBusy(btn, async () => {
          const result = await api(`/quizzes/${quiz.id}/attempt`, { method: "POST", body: { answers } });
          drawResult(result);
        });
      },
    },
      quiz.questions.map((q, qi) =>
        h("fieldset", { class: "question", style: { border: 0, padding: 0, margin: "0 0 22px" } },
          h("legend", { style: { fontWeight: "600", padding: "0", marginBottom: "10px" } }, `${qi + 1}. ${q.text}`),
          q.options.map((opt, oi) => {
            const input = h("input", { type: "radio", name: `q${qi}`, value: String(oi) });
            const label = h("label", { class: "option" }, input, h("span", {}, opt));
            input.addEventListener("change", () => {
              answers[qi] = oi;
              label.parentElement.querySelectorAll(".option").forEach((el) => el.classList.remove("selected"));
              label.classList.add("selected");
            });
            return label;
          }))),
      h("div", {}, btn));
    root.replaceChildren(
      backLink(`#/course/${quiz.course.id}`, quiz.course.title),
      pageHead(quiz.title, `${quiz.questions.length} question${quiz.questions.length === 1 ? "" : "s"}`),
      card(form));
    window.scrollTo(0, 0);
  }

  function drawResult(result) {
    const review = quiz.questions.map((q, qi) => {
      const r = result.results[qi];
      return h("div", { class: "question" },
        h("h3", {}, `${qi + 1}. ${q.text}`),
        q.options.map((opt, oi) => {
          let cls = "option";
          let mark = null;
          if (oi === r.correct_index) { cls += " correct"; mark = badge("Correct answer", "ok"); }
          else if (oi === r.chosen) { cls += " wrong"; mark = badge("Your answer", "danger"); }
          return h("div", { class: cls }, h("span", { style: { flex: 1 } }, opt), mark);
        }),
        r.chosen < 0 ? h("p", { class: "small muted" }, "You skipped this question.") : null);
    });
    root.replaceChildren(
      backLink(`#/course/${quiz.course.id}`, quiz.course.title),
      pageHead(quiz.title, "Results"),
      card(
        h("div", { class: "row", style: { gap: "24px", marginBottom: "24px" } },
          h("div", { class: "score-ring", style: { "--p": String(result.percent) } }, h("span", {}, `${result.percent}%`)),
          h("div", {},
            h("h2", {}, `${result.score} of ${result.total} correct`),
            h("p", { class: "muted", style: { margin: "6px 0 12px" } }, result.percent >= 75 ? "Great work!" : result.percent >= 50 ? "Good effort. Review the answers below." : "Keep practising. Review the answers below and try again."),
            h("div", { class: "row" },
              h("button", { class: "btn primary", type: "button", onclick: () => { answers.fill(-1); drawForm(); } }, "Try again"),
              h("a", { class: "btn", href: `#/course/${quiz.course.id}` }, "Back to course")))),
        review));
    window.scrollTo(0, 0);
  }

  drawForm();
  return root;
}

// ====================================================================
// Grades
// ====================================================================
async function grades() {
  const g = await api("/me/grades");
  const assignmentTable = table(
    [
      { label: "Assignment", render: (r) => h("div", {}, h("a", { href: `#/assignment/${r.assignment_id}` }, r.title), h("div", { class: "small muted" }, r.course_title)) },
      { label: "Submitted", render: (r) => h("span", {}, fmtDate(r.submitted_at), r.late ? h("span", {}, " ", badge("late", "warn")) : null) },
      { label: "Score", render: (r) => r.score === null ? badge("Awaiting grade", "muted") : h("span", {}, `${fmtScore(r.score)} / ${r.max_score} `, badge(`${Math.round((r.score / r.max_score) * 100)}%`, pctTone((r.score / r.max_score) * 100))) },
      { label: "Feedback", render: (r) => h("span", { class: "small" }, r.feedback || "") },
    ],
    g.assignments,
    { empty: "You haven't submitted any assignments yet." });

  const quizTable = table(
    [
      { label: "Quiz", render: (r) => h("a", { href: `#/quiz/${r.quiz_id}` }, r.title) },
      { label: "Course", render: (r) => r.course_title },
      { label: "Best score", render: (r) => h("span", {}, `${r.best} / ${r.total} `, badge(`${Math.round((r.best / r.total) * 100)}%`, pctTone((r.best / r.total) * 100))) },
      { label: "Attempts", render: (r) => String(r.count) },
      { label: "Last attempt", render: (r) => fmtDate(r.last_taken) },
    ],
    g.quizzes,
    { empty: "You haven't taken any quizzes yet." });

  return h("div", {},
    pageHead("Grades", "Your results across all courses."),
    section("Assignments", assignmentTable),
    section("Quizzes", quizTable));
}

// ====================================================================
bootApp({
  role: "student",
  nav: [
    { id: "dashboard", label: "Dashboard", icon: "home" },
    { id: "my-courses", label: "My courses", icon: "book", also: ["course", "assignment", "quiz"] },
    { id: "catalog", label: "Browse courses", icon: "search" },
    { id: "grades", label: "Grades", icon: "award" },
    { id: "profile", label: "Profile", icon: "user" },
  ],
  routes: {
    dashboard,
    "my-courses": myCourses,
    catalog,
    "course/:id": coursePage,
    "assignment/:id": assignmentPage,
    "quiz/:id": quizPage,
    grades,
    profile: (_, ctx) => profilePage(ctx.user),
  },
});
