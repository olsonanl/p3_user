# Plan: Add "Deleted" Account Status

## Context

BV-BRC needs a way to mark user accounts as deleted while preserving the records so that deleted usernames and email addresses cannot be reused. This is a soft-delete mechanism with an enum `status` field to allow future expansion to states like "suspended".

**Requirements:**
- Deleted accounts cannot log in
- Deleted usernames cannot be reused for new registrations
- Deleted email addresses cannot be reused for new registrations
- Admin + self-service deletion (self-service requires password confirmation)
- Admin-only restore capability

---

## New Schema Fields

| Field | Type | Description |
|-------|------|-------------|
| `status` | string | `"active"` or `"deleted"` (default: `"active"`) |
| `deletedDate` | string (ISO) | Timestamp of when account was deleted |

Existing users without a `status` field are treated as `"active"`.

---

## Changes by File

### 1. `models/user.js` — User Model

- **Add `status` to schema** with type `string` and default `"active"`.

- **`post()` method** (~line 478): Set `obj.status = 'active'` on new user creation.

- **`validatePassword()` method** (~line 398): After fetching the user, check `user.status`. If status is `"deleted"`, resolve with `Result(false)` (same as wrong password) so the caller gets a generic auth failure. This blocks login for deleted accounts.

- **Add `deleteAccount(id, opts)` method**: Patches the user record with:
  - `{op: 'add', path: '/status', value: 'deleted'}`
  - `{op: 'add', path: '/password', value: ''}` (clear password hash)
  - `{op: 'add', path: '/resetCode', value: ''}` (clear any pending reset)
  - `{op: 'add', path: '/verification_code', value: ''}` (clear any pending verification)
  - `{op: 'add', path: '/deletedDate', value: new Date().toISOString()}`
  - `{op: 'replace', path: '/updatedBy', value: deletedBy}` (who performed the deletion)

- **Add `restoreAccount(id, opts)` method**: Patches the user record with:
  - `{op: 'replace', path: '/status', value: 'active'}`
  - `{op: 'replace', path: '/deletedDate', value: ''}`
  - Triggers a password reset flow so the restored user can set a new password (since password was cleared on delete).

- **`registerUser()` method** (~line 112): Enhance the duplicate-found error message. When the duplicate match has `status === 'deleted'`, return a message like `"This username/email is associated with a deleted account and cannot be reused."` instead of the current generic messages.

- **`resetAccount()` method** (~line 267): After `get(id)`, if `user.status === 'deleted'`, return early without generating a code or sending email. This silently prevents password resets on deleted accounts.

- **`get()` method** (~line 177): No change. Deleted users must remain findable so duplicate checks in `registerUser()` continue to work.

### 2. `routes/authenticate.js` — Authentication Route

- **POST `/authenticate`** (~line 15): No route change needed — `validatePassword` in the model already returns `false` for deleted users after the model change above.

- **POST `/authenticate/sulogin`** (~line 42): After fetching the target user (~line 62), check `tuser.status === 'deleted'` and return `NotAcceptable('Target user account is deleted')`. Admins should not be able to impersonate deleted accounts.

- **GET `/authenticate/refresh`** (~line 81): After fetching the user (~line 88), check `user.status === 'deleted'` and return `Unauthorized('Account is deleted')`. Prevents token refresh for deleted accounts.

- **POST `/authenticate/service`** (~line 103): After fetching the user (~line 121), check `user.status === 'deleted'` and return `Unauthorized('Account is deleted')`. Prevents service token generation for deleted accounts.

### 3. `routes/reset.js` — Password Reset Route

- **POST `/reset`** (~line 88): No route change needed — the guard in `resetAccount()` (model change above) handles this by silently returning without sending an email for deleted accounts.

### 4. `routes/verify.js` — Email Verification Route

- No change needed. Deleted accounts won't have pending verification codes (cleared on deletion). Old verification links will fail the query match.

### 5. `facets/user-admin.js` — Admin Facet

- **Add `deleteAccount(id, opts)` method**: Calls `this.model.deleteAccount(id, opts)`. Only reachable by admin-privileged requests (enforced by facet routing).

- **Add `restoreAccount(id, opts)` method**: Calls `this.model.restoreAccount(id, opts)`. Admin-only.

- **`get()` and `query()` methods**: `status` is already included in responses by default (only `password` and `resetCode` are explicitly stripped). No change needed.

### 6. `facets/user-user.js` — User Facet

- **Add `deleteAccount(id, password, opts)` method**:
  - Requires `opts.req.user.id === id` (can only delete own account)
  - Requires password confirmation: calls `this.model.validatePassword(id, password)` first
  - On valid password: calls `this.model.deleteAccount(id, opts)`
  - On invalid password: throws `Unauthorized('Invalid password')`

### 7. `routes/account.js` (NEW) — Account Lifecycle Routes

New route file for delete/restore operations:

- **DELETE `/user/:id`**:
  - For regular authenticated users: requires `password` in request body for confirmation. Routes through user facet's `deleteAccount`.
  - For admin users: no password required. Routes through admin facet's `deleteAccount`.

- **POST `/user/:id/restore`**: Admin-only endpoint. Calls admin facet's `restoreAccount` method. Returns error for non-admin users.

### 8. `app.js` — Application Entry Point

- Register the new `/user` delete/restore routes from `routes/account.js`.

---

## File Change Summary

| File | Type | Description |
|------|------|-------------|
| `models/user.js` | Modify | Schema, validatePassword, registerUser, resetAccount, new deleteAccount/restoreAccount |
| `routes/authenticate.js` | Modify | Guard sulogin, refresh, service endpoints against deleted users |
| `facets/user-admin.js` | Modify | Add deleteAccount, restoreAccount methods |
| `facets/user-user.js` | Modify | Add deleteAccount method with password confirmation |
| `routes/account.js` | **New** | DELETE /user/:id and POST /user/:id/restore endpoints |
| `app.js` | Modify | Register new routes |

---

## Verification Checklist

1. **Login blocked**: `POST /authenticate` with deleted user's credentials — expect 401
2. **Registration blocked (username)**: `POST /register` with deleted user's username — expect 409 with "deleted account" message
3. **Registration blocked (email)**: `POST /register` with deleted user's email — expect 409 with "deleted account" message
4. **Token refresh blocked**: Valid token for deleted user on `GET /authenticate/refresh` — expect 401
5. **Sulogin blocked**: Admin `POST /authenticate/sulogin` targeting deleted user — expect error
6. **Service token blocked**: `POST /authenticate/service` for deleted user — expect 401
7. **Self-delete works**: Authenticated user `DELETE /user/:id` with correct password — success, subsequent login fails
8. **Self-delete requires password**: Self-delete with wrong password — expect 401
9. **Admin delete works**: Admin `DELETE /user/:id` — success
10. **Admin restore works**: Admin `POST /user/:id/restore` — success, user receives password reset email
11. **Password reset silent for deleted**: `POST /reset` with deleted user's email — returns 201 but no email sent
12. **Existing users unaffected**: Users without `status` field work normally (treated as `"active"`)
