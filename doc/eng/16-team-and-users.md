# 16 — Team & Users

Work with multiple translators using role-based access control,
a shared audit trail, and a review workflow.

---

## Table of Contents

- [Multi-user Mode](#multi-user-mode)
- [Enabling Multi-user Mode](#enabling-multi-user-mode)
- [Roles and Permissions](#roles-and-permissions)
  - [Status Transition Permissions by Role](#status-transition-permissions-by-role)
- [Managing Users](#managing-users)
- [Login and Session](#login-and-session)
- [Activity Log](#activity-log)
- [Review Workflow for Teams](#review-workflow-for-teams)

---

## Multi-user Mode

By default the tool runs in **single-user mode**: no login, no accounts,
anyone with access to the URL can do anything.

**Multi-user mode** activates accounts, login, roles, and the activity log.
Enable it when:

- Multiple people are translating the same mod.
- You want a reviewer to approve work done by translators.
- You need an audit trail of who changed what.

---

## Enabling Multi-user Mode

Set the following environment variable and restart the service:

```
MULTI_USER=true
```

When `MULTI_USER=true` is set:

- A **Login page** appears at `/login`. All other routes redirect to login until the user authenticates.
- A default **admin** account is created on first startup (check the server startup log for the initial credentials).
- The **Users** page (`/users`) becomes visible in the navigation bar (admin accounts only).
- Every string edit, import, export, approval, and user-management action is attributed to the logged-in user in the **Activity Log**.
- Role-based access control (RBAC) is enforced on all API endpoints.

See [Configuration](17-configuration.md) for the full environment variable reference.

---

## Roles and Permissions

| Role           | Can do                                                                    |
| -------------- | ------------------------------------------------------------------------- |
| **Admin**      | Everything: import mods, translate, approve, manage users, edit QA rules  |
| **Translator** | Import mods, translate strings, run LLM, export                           |
| **Reviewer**   | Read all strings, approve or reject translations, cannot import or export |

Roles are assigned at user creation and can be changed by an admin at any time via the Users page.

### Status Transition Permissions by Role

The status state machine enforces which roles may move a translation to which status.
This is checked on the server for every individual save and every bulk action.

| Target status | Translator | Reviewer | Admin | System (automated) |
| ------------- | :--------: | :------: | :---: | :----------------: |
| `draft`       |     ✅     |    ✅    |  ✅   |         ✅         |
| `tm`          |     ❌     |    ❌    |  ❌   |         ✅         |
| `fuzzy`       |     ❌     |    ❌    |  ❌   |         ✅         |
| `auto`        |     ❌     |    ❌    |  ❌   |         ✅         |
| `human`       |     ❌     |    ❌    |  ❌   |         ✅         |
| `reviewed`    |     ❌     |    ✅    |  ✅   |         ✅         |
| `rejected`    |     ❌     |    ✅    |  ✅   |         ✅         |

> `tm`, `fuzzy`, `auto`, and `human` are set exclusively by automated pipelines
> (TM engine, LLM batch translation, EET/CSV import). They cannot be assigned manually.

For the full transition rules, including which source states are required, see
[Status Badges — Status State Machine](03-editor.md#status-state-machine) in the Editor guide.

---

## Managing Users

Navigate to **Users** in the top navigation bar (route: `/users`).
This page is only visible to Admins and only when multi-user mode is enabled.

The Users table lists all accounts with the following columns:

| Column           | Description                                                    |
| ---------------- | -------------------------------------------------------------- |
| **ID**           | Internal numeric user ID                                       |
| **Username**     | Login name used on the login page                              |
| **Display Name** | Friendly name shown in the Activity Log and string attribution |
| **Role**         | Colour-coded badge: Admin / Translator / Reviewer              |
| **Status**       | Active (green) or Inactive (grey)                              |
| **Created**      | Account creation timestamp                                     |
| **Actions**      | Visible to admins only (see below)                             |

**Admin actions (per row):**

- **Toggle Active / Inactive** — deactivates the account without deleting it.
  An inactive user cannot log in but their history is preserved.
- **Change Password** — set a new password for any user (admin does not need the current password).

**Add User form (Admin only):**

Fields: Username, Display Name, temporary Password (minimum 4 characters), Role.
Click **Create User**. The new user can log in immediately with the temporary password.

> There is no permanent delete — deactivate inactive users instead.

---

## Login and Session

**Login page** (`/login`): enter your **username** and **password** (not an email address),
then click **Sign in**.

**Session behaviour:**

- Sessions are stored in the database and expire after **72 hours** by default
  (configurable via `SESSION_LIFETIME_HOURS` in `.env`).
- The browser receives an HTTP-only, SameSite=Strict session cookie. No local-storage tokens are used.
- There is no "remember me" option; all sessions expire at the configured TTL.

**Logout** — click your username in the top navigation bar then **Log out**.
The session is deleted from the server immediately and the cookie is cleared.

**Password change:**

- Any user can change their own password via the Users page (password icon on their own row).
- Admins can change any user’s password without knowing the current one.

> Note: OAuth / SSO (Google, GitHub, etc.) is not implemented in the current version.

---

## Activity Log

Navigate to **Activity** in the top navigation bar (route: `/activity`).

The Activity Log records every significant action taken in the system:

- String translations saved
- Status changes (Approved, Reset)
- Mod imports started/completed
- Export actions
- User management actions (add/remove/role change)

### Filtering the Log

The Activity Log supports one filter:

| Filter          | Options                                                                                                    |
| --------------- | ---------------------------------------------------------------------------------------------------------- |
| **Action type** | All / login / logout / translate / import / approve / export / create_user / update_user / change_password |

Results are paginated at **50 entries per page**. Each row shows:

| Column      | Description                                                   |
| ----------- | ------------------------------------------------------------- |
| **Time**    | Timestamp of the action (browser-localised)                   |
| **User**    | Display name of the actor                                     |
| **Action**  | Action type badge                                             |
| **Entity**  | Affected record type and ID (e.g. `user #5`, `string #1042`)  |
| **Details** | Additional context as a JSON snippet (new role, mod ID, etc.) |

> Note: date-range, user, and mod filters are not available in the current version.
> Use the Action filter or your browser’s in-page search (`Ctrl+F`) to narrow results.

### Using the Log for Accountability

- **Track daily translator output** — filter by action type `translate` to see how many
  strings each team member has worked on today.
- **Resolve disputes** — look up `translate` or `approve` events for a specific time period
  to see who changed a string and when.
- **Audit imports** — filter by `import` to see when each mod version was brought in and by whom.

> Note: the log cannot currently be exported as CSV from the UI.
> For bulk reporting, query the `activity_log` table in PostgreSQL directly.

---

## Review Workflow for Teams

A typical translation project workflow with a team:

```
Admin imports mod
    ↓
Translator translates (Draft / LLM Auto)
    ↓
Reviewer checks Review Queue → Approves or flags for correction
    ↓
Translator corrects flagged strings
    ↓
Admin exports final translation
```

After the Translator’s LLM or manual translation run, the Reviewer opens the
[Review Queue](15-review-queue.md) and works through strings with **Auto**, **Fuzzy**,
or **TM** status — approving correct ones and resetting incorrect ones for re-translation.

**There are no automated email notifications.**
Coordinate handoffs through your existing communication tools (chat, issue tracker, etc.).

Typical handoff signals:

- Translator announces: “LLM run complete — 300 Auto strings ready for review.”
- Reviewer opens Review Queue, filters by **Auto**, works through the batch.
- Reviewer announces: “Done — 280 approved, 20 reset. Please re-check resets.”

---

← [Review Queue](15-review-queue.md) | [Home](README.md) | **Next: [Configuration →](17-configuration.md)**
