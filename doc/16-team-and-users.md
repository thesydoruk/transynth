# 16 — Team & Users

Work with multiple translators using role-based access control,
a shared audit trail, and a review workflow.

---

## Table of Contents

- [Multi-user Mode](#multi-user-mode)
- [Enabling Multi-user Mode](#enabling-multi-user-mode)
- [Roles and Permissions](#roles-and-permissions)
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

> TODO: Describe what changes when multi-user mode is enabled:
> - Login page appears before accessing any other page.
> - Admin creates accounts for each team member.
> - Users page becomes visible in the navigation.
> Link to [Configuration](17-configuration.md) for full env variable reference.

---

## Roles and Permissions

| Role | Can do |
|------|--------|
| **Admin** | Everything: import mods, translate, approve, manage users, edit QA rules |
| **Translator** | Import mods, translate strings, run LLM, export |
| **Reviewer** | Read all strings, approve or reject translations, cannot import or export |

> TODO: Verify exact role names and permission matrix from
> `src/web/routes/users.ts` or auth middleware.
> Describe how to assign a role when creating a user.

---

## Managing Users

Navigate to **Users** in the top navigation bar (route: `/users`).
This page is only visible to Admins and only when multi-user mode is enabled.

> TODO: Describe the Users page:
> - List of users with name, email, role, last active date
> - "Add User" form (name, email, temporary password, role)
> - Edit role button
> - Deactivate / delete user
> Screenshot placeholder.

---

## Login and Session

> TODO: Describe the login page (email + password).
> Describe session behaviour (how long sessions last, remember-me option if any).
> Describe logout (nav bar button).
> Describe password change flow.
> Note: no OAuth or SSO in current version (planned for future).

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

> TODO: Describe filter options:
> - Date range
> - User
> - Action type (translate, approve, import, export, …)
> - Mod
> Screenshot placeholder.

### Using the Log for Accountability

> TODO: Practical guidance:
> - As a team lead, use the log to see daily translator output.
> - Use "who changed this string last?" to resolve disputes.
> - Export the log as CSV for reporting.

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

> TODO: Describe how to use the Review Queue in a multi-user context.
> Link to [Review Queue](15-review-queue.md).
> Explain notification workflow (currently manual — no email notifications).

---

← [Review Queue](15-review-queue.md) | [Home](README.md) | **Next: [Configuration →](17-configuration.md)**
