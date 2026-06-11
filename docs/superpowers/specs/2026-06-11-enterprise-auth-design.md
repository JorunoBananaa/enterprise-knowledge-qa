# Enterprise Authentication And User Management Design

## Goal

Replace the current MVP authentication path with an internal enterprise account system that is secure enough for normal company use and still small enough to fit the existing FastAPI and Next.js codebase.

The design covers login, logout, current-user verification, route protection, role checks, password handling, disabled-user handling, and minimum administrator user management.

## Current State

The frontend login form posts credentials to `/auth/login`, receives a JWT, stores it in `localStorage.access_token`, and redirects into the app. `apiFetch` reads that token and sends it as `Authorization: Bearer <token>`. `AppShell` treats local token presence as logged-in state and parses the token client-side to decide the displayed user and administrator menu.

The backend login route uses a hardcoded `_MVP_USERS` map with `admin/a` and `user/a`. JWTs contain `sub`, `role`, and `exp`. Protected endpoints decode bearer tokens, but most user identity handling is still string-based. Some business routes hardcode database user IDs by checking whether the token subject is `"admin"`.

The repository already has a `User` model with `username`, `display_name`, `password_hash`, `role`, and `status`, and backend dependencies already include `passlib[bcrypt]`. These are the basis for the enterprise auth path.

There are existing uncommitted frontend changes that make `/qa` the preferred post-login and default shell destination. This design keeps that behavior.

## Chosen Approach

Use short-lived signed JWTs carried in an HttpOnly Cookie.

On login, the backend validates the submitted credentials against the `users` table, then sets an HttpOnly Cookie containing the access token. The frontend no longer stores or reads tokens. Every protected backend request validates the cookie token and then loads the database user to check that the account still exists, is active, and has the required role.

The backend will temporarily accept `Authorization: Bearer` tokens for compatibility while the frontend migrates to Cookie-based auth. The frontend implementation uses only Cookie auth.

This approach improves security without requiring a full server-side session table or refresh-token rotation. It also leaves room for a later session table or SSO integration.

## Non-Goals

The first implementation will not include refresh tokens, multi-factor authentication, CAPTCHA, password complexity policy enforcement, login failure lockout, device management, SSO, or a full audit-log database model.

Basic server logs for auth and user-management events are in scope. Stronger audit persistence can be added later.

## Backend Authentication

### User Model

`User.role` remains a two-value role model:

- `admin`
- `standard`

`User.status` becomes an explicit status model:

- `active`
- `disabled`

Add a `token_version` integer field to the user model, defaulting to `0`. Any operation that should invalidate existing login tokens increments this value. Password change, administrator password reset, and account disable all increment `token_version`.

### Passwords

Passwords are never stored directly.

The backend uses `passlib[bcrypt]` to hash passwords when creating users, resetting passwords, and changing the current user's password. Login verifies the submitted password against the stored hash.

Seeded development users must use real bcrypt hashes, not the current `dev-hash` placeholder.

### Login

`POST /auth/login` accepts JSON credentials:

```json
{
  "username": "admin",
  "password": "example-password"
}
```

The route looks up the user by username, verifies the password hash, checks `status == active`, creates an access token, sets the auth cookie, and returns the current user summary:

```json
{
  "user": {
    "id": 1,
    "username": "admin",
    "display_name": "Administrator",
    "role": "admin",
    "status": "active"
  }
}
```

Invalid username or password returns `401`. Disabled users return `401` with a generic account-unavailable message. The API must not confirm whether a username exists.

### Cookie Settings

The access token cookie is configured as:

- `httponly=True`
- `samesite="lax"`
- `secure` controlled by settings
- `max_age` aligned with token expiration
- path `/`

Default development settings:

- `auth_cookie_name="access_token"`
- `access_token_expire_minutes=480`
- `auth_cookie_secure=False`

Production should provide `jwt_secret` and enable secure cookies.

### JWT Claims

The access token contains:

- `sub`: database user ID as a string
- `username`
- `role`
- `token_version`
- `exp`

The token is signed with the configured algorithm and secret.

`jwt_secret` remains configurable by environment. Local development can keep a fallback value, but production deployments should provide a strong value.

### Current User Verification

`get_current_user` reads the token from the HttpOnly Cookie. During migration, it falls back to `Authorization: Bearer` only when the cookie is missing.

After decoding the JWT, it loads the user from the database by `sub`. The request is rejected if:

- the token is missing or invalid
- the token is expired
- the user no longer exists
- the user is disabled
- the token `token_version` does not match the current database value

The dependency returns a typed current-user schema with:

- `id`
- `username`
- `display_name`
- `role`
- `status`

Business routes must use `current_user.id` instead of string username comparisons.

### Logout

`POST /auth/logout` clears the auth cookie and returns success.

Logout does not need to mutate `token_version`; it only ends the browser session. Forced invalidation happens through password change, password reset, disablement, or future session controls.

### Current User Endpoint

`GET /auth/me` returns the current user summary if authenticated. Unauthenticated or invalid sessions return `401`.

The frontend treats this endpoint as the only trusted source of logged-in state.

### Change Own Password

`PATCH /auth/me/password` lets a logged-in user change their own password.

The request includes the current password and new password. The backend verifies the current password, writes the new bcrypt hash, increments `token_version`, clears the current cookie, and requires the user to log in again.

## Authorization

`require_admin` continues to protect administrator-only endpoints, but it operates on the typed current-user object loaded from the database.

The backend remains the source of truth for authorization. Frontend menu hiding is only a usability feature.

Existing hardcoded identity mappings are removed:

- document upload uses `current_user.id` as `uploader_id`
- personal prompt routes use `current_user.id`
- chat session ownership stores the database user ID as `str(current_user.id)` while the existing `ChatSession.user_id` column remains a string

Routes that are currently intended for authenticated users must require `get_current_user`. Notably, `GET /llm-configs/brief` must require authentication even if it remains available to both roles.

## User Management

Add administrator-only user management APIs.

### List Users

`GET /users` supports pagination and optional text search by username or display name.

Response items include:

- `id`
- `username`
- `display_name`
- `role`
- `status`

Password hashes are never returned.

### Create User

`POST /users` creates a user with:

- `username`
- `display_name`
- `password`
- `role`
- `status`

The backend validates username uniqueness, hashes the password, and stores the user. The default role is `standard`, and the default status is `active`.

### Update User

`PATCH /users/{id}` updates:

- `display_name`
- `role`
- `status`

If the account is disabled, increment `token_version`.

The backend prevents disabling the last active administrator and prevents demoting the last active administrator.

### Reset Password

`POST /users/{id}/reset-password` accepts a new password, stores a new bcrypt hash, and increments `token_version`.

The response does not return the password.

## Frontend Authentication Flow

### Auth Client

Create a focused frontend auth client module, for example `src/lib/auth-client.ts`, with:

- `login(username, password)`
- `logout()`
- `getCurrentUser()`
- shared `CurrentUser` type

Remove local token helpers from auth decisions. `localStorage.access_token`, `parseToken`, and client-side JWT parsing should no longer drive application state.

### API Client

`apiFetch` uses `credentials: "include"` so browser requests include the HttpOnly Cookie.

On `401`, `apiFetch` triggers a common unauthenticated handling path. It should clear in-memory user state if available and navigate to `/login?next=<current-path>` for protected pages.

`403` remains a permission error and should be shown as a normal user-facing error instead of logging the user out.

### AppShell

`AppShell` initializes by calling `GET /auth/me`.

While identity is loading, it shows a lightweight loading state and avoids rendering protected page content. If `/auth/me` returns `401`, it redirects to `/login?next=<current-path>`.

Public routes are limited to `/login`. Authenticated users who visit `/login` are redirected to the `next` URL if safe, otherwise `/qa`.

After successful login, the frontend navigates to the safe `next` URL. If no `next` value exists, it navigates to `/qa`.

Administrator menu items are shown only when `user.role === "admin"`.

### Login Page

The login page submits credentials through the auth client. It no longer stores an access token. It shows backend validation errors, uses the existing Ant Design form pattern, and preserves the current `/qa` default destination.

### User Management Page

Replace the placeholder `/users` page with an administrator user-management page.

Minimum UI capabilities:

- list users
- search users
- create user
- edit display name, role, and status
- reset password

The page uses standard Ant Design controls and avoids exposing password hashes or token details.

## Error Handling

Backend status codes:

- `401`: missing, invalid, expired, disabled, or token-version-mismatched session
- `403`: authenticated but insufficient role
- `400`: invalid operation such as attempting to disable the last active administrator
- `409`: username conflict during user creation

Frontend behavior:

- `401` from protected pages redirects to login
- `403` shows a permission error
- form validation errors remain inline or near the form
- login errors are generic and do not reveal whether the username exists

## Testing

### Backend Tests

Add focused auth and user-management tests:

- successful login sets an HttpOnly Cookie
- wrong password fails
- disabled user cannot log in
- `/auth/me` requires a valid session
- `/auth/me` returns the current user after login
- logout clears the cookie
- standard user receives `403` for administrator endpoints
- administrator can create a user
- administrator can disable a user
- administrator can reset a password
- disabling or demoting the last active administrator fails
- password change invalidates old tokens
- password reset invalidates old tokens
- document upload uses the database user ID from `current_user`
- personal prompt routes use the database user ID from `current_user`

### Frontend Verification

Verify these flows manually or with tests where the existing frontend test setup supports it:

- unauthenticated visit to `/qa` redirects to `/login?next=/qa`
- unauthenticated visit to `/library` redirects to `/login?next=/library`
- login success redirects to `next`
- login without `next` redirects to `/qa`
- `401` during a protected API request redirects to login
- administrator sees the user-management menu
- standard user does not see the user-management menu
- user-management page can create, disable, and reset password for users

### Build And Test Commands

Expected verification commands:

```bash
cd services/api
python -m pytest -q
```

```bash
cd web-app
pnpm build
```

If `pnpm` is unavailable in the environment, use the package manager already used by the local workspace lockfile or fall back to `npm run build` after confirming dependencies are installed.

## Migration Notes

Development seed users should be updated to real bcrypt password hashes. The existing `admin` and `user` accounts can remain, but their credentials should be explicitly documented for local development.

Existing data that refers to usernames in chat sessions can remain readable during the first migration. New chat-session writes store `str(current_user.id)` in the existing string column. A later data migration can normalize old chat session ownership values and convert the column to a foreign key if needed.

The temporary bearer-token compatibility path should be removed after the frontend Cookie migration is complete and verified.

## Acceptance Criteria

- No frontend code stores or reads the auth token from `localStorage`.
- Login creates an HttpOnly Cookie and returns the current user summary.
- `/auth/me` is the frontend source of truth for identity.
- Protected pages redirect unauthenticated users to `/login?next=...`.
- Backend protected routes validate cookie token, database user status, and token version.
- Disabled users cannot log in or continue using existing tokens.
- Password change and administrator password reset invalidate existing tokens.
- Admin-only APIs return `403` for standard users.
- User-management APIs and page support list, create, update, disable, and reset password.
- Existing hardcoded `admin ? 1 : 2` user-ID mappings are removed from business routes.
- Backend auth/user tests pass.
- Frontend build passes.
