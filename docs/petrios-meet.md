# Petrios Meet: production setup

Petrios Meet gives every `JITSI` ("Petrios Meet (Video)") session a video room.
This guide covers turning on embedded rooms with 8x8 Jitsi as a Service (JaaS)
on the production Render service and the Cloudflare Workers staging Worker, how
to check it worked, and what happens if you deploy without it. The behaviour
contract is spec/04 "Petrios Meet"; the privacy and security notes are spec/13.

## Before you deploy: what changes for users

| Configuration | What people get |
|---|---|
| **Nothing set** (public mode) | Rooms open on the free **meet.jit.si** service in a **new tab**. Petrios never embeds meet.jit.si, because it cuts embedded calls after 5 minutes. The **first person to arrive must sign in to Jitsi** (Google, GitHub or Facebook account) to start the room; everyone else joins as a guest. External NHS teachers may not have, or be allowed to use, such an account, so the teacher may not be able to start their own room. |
| **All three `JAAS_*` set** | Rooms are **embedded** on the session page. Every participant joins with a short-lived Petrios room pass; department moderators and accepted teachers are room moderators; recording, live streaming and transcription are off. Nobody needs a Jitsi account. |
| One or two `JAAS_*` set, or a malformed key | Video is **unavailable** (a notice instead of the room) until fixed. There is no silent fallback to meet.jit.si. |

Members' emailed and calendar links always open the Petrios session page, which
offers the room and attempts their check-in; signing in keeps the link.

> Deploying this release without the `JAAS_*` variables switches every room to
> meet.jit.si in a new tab with first-arrival sign-in. If teachers rely on
> embedded video, set the variables **before or with** the deploy.

## 1. Create the JaaS app and key

1. Sign up at <https://jaas.8x8.vc> and create an app. Copy its **AppID**
   (`vpaas-magic-cookie-…`).
2. Choose a plan. The free developer tier is limited by monthly active users
   and is not enough for a whole training cohort: check the current limits and
   pricing in the JaaS console before go-live.
3. Create the signing key on your own machine (nothing secret goes to 8x8):

   ```bash
   openssl genrsa -out jaas-private.pem 4096
   openssl rsa -in jaas-private.pem -pubout -out jaas-public.pem
   ```

   (A key pair generated in the JaaS console also works: download its private
   key when offered.)
4. In the JaaS console's API keys page, add a key and upload
   `jaas-public.pem`. Copy the **key id** it lists: it starts with your AppID,
   for example `vpaas-magic-cookie-…/4f4910`.
5. Record 8x8 as a subprocessor (DPA, data region, international transfers),
   and set the public compliance facts (spec/13). Petrios sends 8x8 only a
   display name, a per-session pseudonymous id, a moderator flag, the room name
   and the session title, never an email address.

Keep `jaas-private.pem` out of the repository, tickets and chat. Delete local
copies once it is stored as a secret.

## 2. Set the variables on Render (production)

Render dashboard → the Petrios web service → **Environment** → add:

| Key | Value |
|---|---|
| `JAAS_APP_ID` | the AppID |
| `JAAS_API_KEY_ID` | the key id (`<AppID>/<suffix>`) |
| `JAAS_PRIVATE_KEY` | the private key PEM |

For `JAAS_PRIVATE_KEY`, paste the whole PEM including the `-----BEGIN …-----`
and `-----END …-----` lines. If the field does not keep line breaks, use a
one-line form with literal `\n` escapes, which Petrios also accepts:

```bash
awk 'NF { sub(/\r/, ""); printf "%s\\n", $0 }' jaas-private.pem
```

PKCS#8 (`BEGIN PRIVATE KEY`) and PKCS#1 (`BEGIN RSA PRIVATE KEY`) both work.
Leave `JITSI_DOMAIN` unset. Save and deploy (these values are read at request
time; no rebuild of the client bundle is needed, but the service must restart
to see them).

## 3. The staging Worker (optional)

The staging Worker serves the production database, so its rooms are real
sessions' rooms and count towards the same JaaS usage. Use a separate JaaS app
for staging if you want separate usage. Store every value as a secret:

```bash
npx wrangler secret put JAAS_APP_ID --env=""
npx wrangler secret put JAAS_API_KEY_ID --env=""
npx wrangler secret put JAAS_PRIVATE_KEY --env="" < jaas-private.pem
```

Piping the file keeps the line breaks; the interactive prompt reads one line
(a one-line value with literal `\n` escapes also works). See
docs/cloudflare-workers.md.

## 4. External teachers (one more step)

External teachers (no Petrios account) join token-protected rooms from their
invitation (RSVP) link. Their invite code only unlocks a room pass when
`TEACHER_INVITATIONS_RLS_LOCKED=true`. Set it **only after** the database fix
in spec/13 "External teacher invite codes" has been reviewed, applied as a
migration and verified: migration 017 left the `teacher_invitations` table
readable and writable with the public anon key, so until then anyone could
obtain or forge an invite code. Until the flag is on, external teachers see a
notice to contact the organiser instead of the room; members are unaffected.

## 5. Verify after deploy

1. As a super admin, open `/settings/installation`: "Video (Petrios Meet)"
   should say **8x8 Jitsi as a Service (JaaS), embedded** and ready. A
   configuration error there names the variable at fault (never its value).
   The server log also has one `[petrios-meet] configuration error:` line.
2. On a published `JITSI` session's **Manage Session → Overview**, the card
   should name JaaS.
3. Within the room window (30 minutes before the start until 30 minutes after
   the end), join from two browsers: a trainee (participant) and a department
   moderator or accepted teacher (moderator; can mute others). Check camera,
   microphone and screen sharing, that the trainee's check-in message appears,
   and that the call is still connected after more than 5 minutes.
4. Leave and **Rejoin**, and reload the page mid-call: each join gets a fresh
   pass.
5. If people see "the video service did not accept the connection", the server
   log has a `[petrios-meet] the video service refused a jaas room connection`
   line. Check that the uploaded public key matches `JAAS_PRIVATE_KEY` and that
   `JAAS_API_KEY_ID` is the key id listed for it.
6. With the flag on, open an accepted external teacher's RSVP link in a
   signed-out browser and join as moderator.

## Self-hosted Jitsi instead

See docs/self-hosting.md "Self-hosted Jitsi". Note that the moderator and
pass-only guarantees there depend on your Jitsi server's settings (guest access
off, Jicofo auto-owner off, a module that applies the token's moderator claim).
