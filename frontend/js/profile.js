import { api } from "./api.js";
import { avatar, card, h, pageHead, roleBadge, toast, withBusy } from "./ui.js";

/** Profile page shared by all three roles. */
export function profilePage(user) {
  const nameInput = h("input", { id: "pf-name", value: user.name, required: true, minlength: 2, maxlength: 120 });
  const saveName = h("button", { class: "btn primary", type: "submit" }, "Save changes");
  const detailsForm = h("form", {
    class: "form",
    onsubmit: (e) => {
      e.preventDefault();
      withBusy(saveName, async () => {
        const updated = await api("/auth/me", { method: "PUT", body: { name: nameInput.value.trim() } });
        localStorage.setItem("lms_user", JSON.stringify(updated));
        toast("Profile updated", "success");
        setTimeout(() => location.reload(), 500);
      });
    },
  },
    h("div", { class: "field" }, h("label", { for: "pf-name" }, "Full name"), nameInput),
    h("div", { class: "field" }, h("label", { for: "pf-email" }, "Email"), h("input", { id: "pf-email", value: user.email, disabled: true })),
    h("div", {}, saveName));

  const current = h("input", { id: "pw-cur", type: "password", required: true, autocomplete: "current-password" });
  const next = h("input", { id: "pw-new", type: "password", required: true, minlength: 6, autocomplete: "new-password" });
  const again = h("input", { id: "pw-again", type: "password", required: true, minlength: 6, autocomplete: "new-password" });
  const savePw = h("button", { class: "btn primary", type: "submit" }, "Update password");
  const pwForm = h("form", {
    class: "form",
    onsubmit: (e) => {
      e.preventDefault();
      if (next.value !== again.value) return toast("The new passwords do not match", "error");
      withBusy(savePw, async () => {
        await api("/auth/change-password", { method: "POST", body: { current_password: current.value, new_password: next.value } });
        pwForm.reset();
        toast("Password updated", "success");
      });
    },
  },
    h("div", { class: "field" }, h("label", { for: "pw-cur" }, "Current password"), current),
    h("div", { class: "field" }, h("label", { for: "pw-new" }, "New password"), next, h("small", { class: "hint" }, "At least 6 characters")),
    h("div", { class: "field" }, h("label", { for: "pw-again" }, "Repeat new password"), again),
    h("div", {}, savePw));

  return h("div", {},
    pageHead("Your profile", "Manage your account details and password."),
    h("div", { class: "grid two" },
      card(h("div", { class: "profile-id" }, avatar(user.name, "lg"), h("div", {}, h("h3", {}, user.name), roleBadge(user.role))), detailsForm),
      card(h("h3", { class: "card-title" }, "Change password"), pwForm)));
}
