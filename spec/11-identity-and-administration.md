# 11 — Identity, onboarding, memberships, and administration

## Identity planes

Petrios combines two identity stores:

- Supabase GoTrue `auth.users` owns credentials, provider identities, sessions,
  email confirmation, and user metadata; and
- application tables (`profiles`, memberships, roles, onboarding requests) own
  tenant authorization and programme attributes.

An authenticated account has no application authority until membership or
`super_admins` supplies it. Email identity is used to reconcile accountless
feedback/invites with accounts, so normalization and verified ownership matter.

## Profiles

`profiles.user_id` corresponds to `auth.users.id`. Trigger/application paths
create or synchronize profile identity. Runtime fields include normalized email,
first/last/full name, email verification timestamp, and optional grade.

A unique index on lower-cased email supports case-insensitive account resolution.
All application lookups normalize input before comparing. This makes email a
powerful join key across feedback, onboarding, contacts, certificates, and
teacher invitations; changing an account email needs a deliberate reconciliation
story.

The active grade vocabulary is:

- `Level 1 Trainee`
- `Level 2 Trainee`
- `Consultant`

Database checks enforce this vocabulary on profile, department membership, and
pending onboarding request grade columns. Onboarding finalization currently
writes the requested grade to `department_members` but its profile-upsert helper
does not pass grade, so profile grade and department grade can differ.

## Session authentication methods

### Passwordless email link

The public login form calls `sendPasswordlessLoginLink(email)`.

1. Lower-case/trim email and require nonblank.
2. Read recent `login_link_requests` for a 15-minute window.
3. Refuse at three prior requests for the email or twelve for the client IP.
4. Record the request, then opportunistically delete rows older than 24 hours.
5. Ask GoTrue admin API for a magic link; if the account is reported missing,
   request an invite link, which creates the account.
6. Build a Petrios `/join/callback` URL containing `token_hash`, link type,
   `mode=login`, and `next=/dashboard`.
7. Send through the shared email adapter.

The limiter table is deny-all/service accessed because the caller is not signed
in. Limiter failure is intentionally fail-open: sign-in continues and logs the
problem. IP is the first `x-forwarded-for` value, then `x-real-ip`; deployments
must configure a trusted proxy or clients may spoof these headers.

The action returns readable structured failure rather than throwing a masked
server-action error. In nonproduction, or when `AUTH_DEV_LINKS=true`, the full
login URL is printed to server logs. Enabling that flag in production exposes a
live account capability to anyone with log access and should be exceptional.

The rate limit reduces email bombing but is not account admission: passwordless
requests can create auth users for arbitrary addresses. Tenant membership remains
the application gate.

### Password

The server action and `POST /api/auth/login` call
`supabase.auth.signInWithPassword`. They require a GoTrue session, persist auth
cookies, and surface provider errors. `/signup` is a browser-side password signup
with client minimum length six/confirmation check plus any GoTrue password/email-
confirmation policy.

Signup remains publicly reachable even when personal workspaces are disabled.
A successfully created account without membership reaches the join wall.

### Microsoft Entra OAuth

`getMicrosoftSignInUrl` asks Supabase for provider `azure`, scope `email`, PKCE
callback `/join/callback?mode=login&next=/dashboard`. Provider configuration
lives in Entra and Supabase, not Petrios-specific secrets. An unavailable provider
returns a readable message and users can fall back to email.

The callback exchanges an OAuth code or verifies a token hash client-side,
waits briefly for cookie propagation, reloads the authenticated user, optionally
finalizes an onboarding request, and redirects.

Current redirect limitation: callback `next` is read from the query and passed to
`window.location.replace` in login mode without enforcing a same-origin relative
path. Generated links use `/dashboard`, but the public callback should validate
the parameter before it is considered free of open-redirect behavior.

### Sign-out and session refresh

The request proxy invokes `auth.getUser()` to refresh expired browser sessions
and copies resulting cookies. Unauthenticated nonpublic page requests redirect to
`/login`. API handlers are excluded from that redirect and must authenticate
themselves. Supabase cookie options are preserved with `SameSite=Lax`; httpOnly
uses the provider-supplied value.

## Membership and role model

Application roles are `org_admin`, `department_admin`, `faculty`, and `trainee`.
They can appear in organization/department membership rows, but effective
authority depends on the helper and target.

| Helper/capability | Effective rule |
|---|---|
| `isSuperAdmin` | Current user has a `super_admins` row |
| `isOrgAdmin(org)` | Exact `organization_members.role = org_admin` for user/org |
| `isDepartmentModerator(dept)` | Super admin, current-org org admin, or target department member role in `department_admin`/`org_admin` |
| `isOrgManager(org)` | Super admin, org admin, or any `department_members.role = department_admin` in org |
| Basic member | Organization/department membership plus RLS/action-specific rule |

“Faculty” does not automatically mean department moderator. “Department admin”
can act as an organization manager for Ops/member settings even though session
management remains department-scoped. Super-admin elevation is global and
separate from membership.

Target-resolving actions should load the row under the current organization
before calling a role helper. `isDepartmentModerator` elevates a current-org admin
before proving that an arbitrary department id belongs to that org, so callers
that pass unscoped ids create a confused-deputy risk.

## Current organization selection

`getCurrentOrgId()` selects the current user's most recently created
`organization_members` row and caches it for the React request. There is no
explicit workspace selection cookie/profile field.

Normal department-transfer onboarding deletes memberships in other
organizations, making the choice unambiguous. The schema and several admin paths
can still produce multiple memberships. In that case:

- newest membership silently becomes current; and
- `ensurePersonalWorkspace` separately looks for the **oldest** membership when
  deciding whether to provision/reuse a workspace.

Code must not rely on a universal one-organization database constraint. A future
multi-org UI needs explicit current-org selection rather than timestamp order.

## Department entry credentials

Departments expose two onboarding entry forms:

- a six-digit `department_code`; and
- a reusable 12-character `department_invite_links.invite_code` URL/QR.

Organization managers list/ensure invite rows for departments they manage.
Rotating an invite chooses a new code (up to five collision attempts), updates
the row, and invalidates the old URL. A department code lookup also resolves the
department's invite-link row so both paths use the same request/finalization
pipeline.

These values locate an onboarding target; the email ownership proof in the
generated auth link is the final identity check.

## Older authenticated join-request workflow

`department_join_requests` supports a separate, older flow in which an already
authenticated user selects an organization and department, requests a role, and
waits for a moderator decision. Its actions and UI components remain in the
source tree, but no current page mounts those components; the invite/code
workflow below is the active user journey.

The request table permits one pending row per department/user. Approval requires
a super admin or target department moderator, marks the request `APPROVED`,
deletes memberships in other organizations, then upserts target organization and
department memberships. Rejection only marks the row `REJECTED`.

Approval is not transactional and changes status **before** moving memberships.
If a later delete/upsert fails, the request is already non-pending and the same
action refuses to retry it. The role passed by the approver overrides the
requested role.

Two exported read actions deserve particular care if this UI is restored:

- `getPendingDepartmentJoinRequests` performs no explicit auth check and relies
  on the request-scoped database/RLS view; and
- `getAllPendingDepartmentJoinRequests` selects through the service role without
  any actor/tenant check.

The latter is not imported by a mounted client today, but it must be authorization-
gated before reuse. The audit dashboard counts pending rows from this older table,
not current `member_onboarding_requests`.

## Department onboarding state machine

### Begin

`beginDepartmentOnboarding` is public. It:

1. resolves invite code or department code to organization/department/invite;
2. normalizes and requires email, first name, and last name; grade is optional;
3. looks for a profile with that email and/or matching signed-in user;
4. detects a membership in another organization;
5. returns `confirm-switch` with current/target organization names unless
   `confirmOrgSwitch` is true;
6. creates or updates a pending request for department/email, requested role
   `trainee`, identity, grade, user id, and link type;
7. when an already confirmed signed-in user's email matches, finalizes
   immediately; otherwise
8. generates an `invite` for an unverified/new account or `magiclink` for a
   verified account, falling back from invite to magic link on an “already”
   error; and
9. emails a callback containing token hash and onboarding request id.

Email failure throws but leaves the pending request/account/link generation side
effects. Repeating for an existing pending request updates identity/link fields,
but the update helper currently omits the newly supplied grade; the original
pending grade can persist.

Privacy limitation: the public begin flow resolves an existing email to user
memberships and can return the name of that email's current organization in the
confirmation response before proving the caller owns the email. This creates an
account/membership disclosure surface. Final membership still requires the email
owner to authenticate.

### Callback and finalize

The callback verifies the GoTrue capability and calls `finalizeMemberOnboarding`.
Finalization requires:

- authenticated user;
- request status `PENDING` (already `COMPLETED` is idempotent success); and
- normalized authenticated email exactly equal to request email.

It then:

1. loads all user organization memberships;
2. deletes department and organization memberships in every other organization;
3. preserves an existing target organization role, otherwise uses requested
   role;
4. preserves an existing target department role, otherwise uses requested role;
5. upserts target organization and department membership with request grade;
6. updates GoTrue first/last/full-name metadata;
7. upserts application profile identity/verification;
8. marks the request `COMPLETED`; and
9. revalidates admin/dashboard/settings.

This is a sequence of independent service-role operations, not a transaction.
If metadata/profile/complete fails after membership deletion/upsert, the user can
already have moved organizations while the request remains pending. Retrying is
intended to finish, but there is no automatic rollback.

Switch confirmation is a user-facing consent checkpoint, not a database
constraint. Finalization always enforces the one-target-org transfer behavior.

## Personal workspaces and enterprise posture

`INDIVIDUAL_SIGNUP_ENABLED` is a compile-time constant and currently `false`.
The landing/login UI hides or redirects the individual path, and dashboard does
not auto-provision an org for an org-less user. They see the join wall.

When true, dashboard calls `ensurePersonalWorkspace`, which idempotently reuses
an existing membership or creates a personal organization, default department,
`org_admin` membership, and `department_admin` membership.

Current enforcement limitations:

- the exported `ensurePersonalWorkspace` server action does not itself check the
  flag; only its dashboard call site does; and
- `createOrganization` requires authentication but no explicit super-admin
  check. The UI shows it only to super admins, while an older RLS INSERT policy
  allows an authenticated user to insert an organization they create. The later
  membership insert may fail, leaving a partial/orphan organization because the
  two writes are not transactional.

Therefore the flag is a strong UI/product posture but not, by itself, a complete
server-side admission control. Enterprise deployments should close these action/
policy gaps before describing signup as cryptographically air-tight.

## Member administration

Organization managers can list organization members plus profiles and department
names. Missing application profiles are best-effort filled for display from the
GoTrue admin API. A member is marked nonremovable in this view if their org role
is `org_admin` or they hold any department-admin role.

`removeOrgMember` enforces the same rules server-side:

- manager authority;
- not self;
- target exists in organization; and
- target is neither org admin nor department admin.

It deletes all target department memberships in that organization, then the
organization membership. Auth account/profile and historical records remain
subject to their foreign-key retention rules.

### Department-level actions and current limitations

`removeDepartmentMember` requires moderator authority for the supplied
department, then uses service role to delete that department membership **and the
target's organization membership**. It does not apply `removeOrgMember`'s self,
org-admin, or any-department-admin protection and does not check whether the user
still belongs to another department in the organization. Other department rows
can remain while the organization membership is gone.

`leaveDepartment` similarly deletes the caller's selected department membership
and their organization membership unconditionally, even if they belong to other
departments.

`addDepartmentMember` has no explicit action-level moderator check and trusts the
RLS client/policy plus database role check. Because role is a cast from an input
string, the database constraint is part of validation.

These flows should be consolidated around one membership invariant before
multi-department membership is treated as robust. The safer organization-member
removal path should be the reference.

## Department and organization administration

- Organization admins create/update departments through RLS-backed actions/UI.
- Department moderators manage lead name, feedback template, sessions, attendance,
  member directory, invites, contacts, and relevant reports.
- Department code and invite URL are enrollment capabilities and should be shown
  only on organizer surfaces, despite API exposure under an admin-issued scope.
- Deleting organization/department is super-admin-only in the dedicated global
  surface and cascades dependent data according to foreign keys.

Any action relying on UI gating still needs a server check. RLS helps for
request-scoped writes but cannot protect a service-role DAL call.

## Super administration

A super admin can:

- list/create/delete all organizations and departments;
- list up to 1,000 GoTrue users and all membership rows;
- grant/revoke `super_admins` rows;
- grant/revoke a department moderator;
- create a moderator account and send a magic-link welcome;
- delete another user from data tables and GoTrue; and
- navigate the global administration surface regardless of current org.

`grantDepartmentModerator` deliberately deletes memberships in other
organizations, then upserts both organization and department role as
`department_admin`. `createModeratorAccount` upserts the target roles but does
not first delete other-organization memberships, so the two admin paths have
different one-org behavior.

User deletion refuses self, deletes known data rows/cascades, removes any
super-admin row best-effort, then calls GoTrue admin delete. The multi-step delete
is not one transaction.

Moderator-account email adapter errors are not always inspected; membership can
be created even when welcome delivery fails. The account can later use the normal
passwordless login flow.

## Capability and personal-data handling

The following URLs/values authorize account or tenant changes and must be treated
as secrets even though they pass through public pages:

- GoTrue hashed token callback query;
- department invite code and department code;
- onboarding request id combined with authenticated email session; and
- OAuth PKCE code/cookies.

Do not log full production callback/invite URLs, put them in analytics, or expose
them through referrers. Email, name, grade, organization membership, and role are
personal/authorization data. Public lookup responses should disclose only what
is needed to complete the join.

## Identity change checklist

- Separate account creation from tenant admission explicitly.
- Normalize email and prove ownership before revealing existing membership.
- Validate callback redirects as same-origin relative paths.
- Apply admission/feature flags inside exported server actions, not only UI.
- Resolve target tenant before role checks; never let current-org elevation
  authorize an unscoped id.
- Keep organization and department memberships consistent under leave/remove.
- Protect self, org admins, and department admins in every removal surface.
- Make organization transfer transactional or safely resumable with visible
  partial state.
- Decide whether grade is profile-global or department-specific and synchronize
  accordingly.
- Test duplicate pending request, email failure, account already exists, org
  switch, callback replay, multiple org memberships, trusted-proxy IP, and auth
  provider failure.
