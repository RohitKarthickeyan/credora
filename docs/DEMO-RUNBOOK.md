# Demo runbook: onboarding by text

One caregiver goes from offer accepted to "Ready for AlayaCare" by text, while staff watch and act
in the portal (spec: `docs/superpowers/specs/2026-09-30-sms-onboarding-demo-design.md`). Everything
runs on the presenter's machine. Rehearsed end to end on 2026-09-30; the whole flow takes about
seven minutes, with the times below.

## 1. One-time setup

### Software and photos

- Docker Desktop running, `npm install` done.
- An OpenAI API key with access to `gpt-5-mini`.
- An authenticator app on your phone (Google Authenticator, 1Password, ...) for the staff sign-in.
- Four photos, prepared in advance (see § 4 for what to photograph).

### `.env`

Copy `.env.example` to `.env` if you have none, replace `FIELD_ENCRYPTION_KEY` and `SESSION_SECRET`
as its comments say, then set these lines. `.env` is gitignored: never commit it, and keep
`.env.example` as placeholders.

```bash
MESSAGING_ADAPTER=mock          # the web phone; no Twilio in this demo
AGENT_ADAPTER=openai            # the text agent
JUDGE_ADAPTER=openai            # the document judge
EXTRACTION_ADAPTER=paddleocr    # the OCR container
ESIGN_ADAPTER=docuseal          # the DocuSeal container
OPENAI_API_KEY=sk-...
OCR_URL=http://localhost:8866
APP_URL=http://localhost:3000
# DOCUSEAL_URL, DOCUSEAL_API_KEY, DOCUSEAL_WEBHOOK_SECRET, DOCUSEAL_ADMIN_EMAIL and
# DOCUSEAL_ADMIN_PASSWORD are written by the DocuSeal setup below.
```

Every other `*_ADAPTER` stays `mock` (`STORAGE_ADAPTER=local`).

**A shell-exported `OPENAI_API_KEY` wins over `.env`.** Both `next dev` and the worker
(`tsx --env-file`) keep a variable that is already set, so a stale key in your shell profile gives
401s even when `.env` is right. Check with `echo ${OPENAI_API_KEY:+set}`; if it prints `set`, remove
it from your profile or start every command below with `env -u OPENAI_API_KEY`.

### Containers and database

```bash
docker compose up -d --wait postgres
docker compose up -d docuseal            # http://localhost:3001
docker compose up -d --build ocr         # first build downloads PaddleOCR models: 5-10 minutes
npm run db:migrate
npm run db:seed                          # Alvita agency, staff accounts, DEMO requirement set
```

The OCR service runs on one CPU thread on purpose (more threads crash Paddle on Apple Silicon),
so each photo takes about 6 s to read. `curl -s localhost:8866/docs -o /dev/null -w '%{http_code}'`
answers 200 once it is up.

### DocuSeal first run

The free self-hosted DocuSeal cannot upload a PDF through its REST API (that route is Pro-only), so
the adapter signs in to DocuSeal's web UI as the admin to upload the forms. It therefore needs the
admin email and password as well as the API key and webhook secret.

Run this once, from the repo root, on a fresh DocuSeal (it creates the admin, the webhook and its
secret header, reveals the API key, and appends six lines to `.env`):

```bash
DS=http://localhost:3001
DOCUSEAL_ADMIN_EMAIL=admin@credora.local
DOCUSEAL_ADMIN_PASSWORD=$(openssl rand -hex 16)
DOCUSEAL_WEBHOOK_SECRET=$(openssl rand -hex 24)
JAR=$(mktemp)
csrf() { curl -s -b "$JAR" -c "$JAR" "$DS$1" | sed -n 's/.*name="csrf-token" content="\([^"]*\)".*/\1/p' | head -1; }

# 1. First-run admin (this also signs the cookie jar in).
curl -s -o /dev/null -b "$JAR" -c "$JAR" -X POST "$DS/setup" \
  --data-urlencode "authenticity_token=$(csrf /setup)" \
  -d 'user[first_name]=Credora' -d 'user[last_name]=Admin' \
  --data-urlencode "user[email]=$DOCUSEAL_ADMIN_EMAIL" \
  --data-urlencode "user[password]=$DOCUSEAL_ADMIN_PASSWORD" \
  --data-urlencode 'account[name]=Credora Demo' -d 'account[timezone]=America/New_York' \
  --data-urlencode "encrypted_config[value]=$DS"

# 2. Webhook to our route, only the two events the adapter maps, then its secret header.
curl -s -o /dev/null -b "$JAR" -c "$JAR" -X POST "$DS/settings/webhooks" \
  --data-urlencode "authenticity_token=$(csrf /settings/webhooks/new)" \
  --data-urlencode 'webhook_url[url]=http://host.docker.internal:3000/api/webhooks/esign' \
  -d 'webhook_url[events][]=form.completed' -d 'webhook_url[events][]=form.declined'
curl -s -o /dev/null -b "$JAR" -c "$JAR" -X POST "$DS/webhook_secret/1" -d '_method=patch' \
  --data-urlencode "authenticity_token=$(csrf /webhook_secret/1)" \
  -d 'webhook_url[secret][key]=X-Credora-Webhook-Secret' \
  --data-urlencode "webhook_url[secret][value]=$DOCUSEAL_WEBHOOK_SECRET"

# 3. API key (DocuSeal asks for the password again to reveal it).
DOCUSEAL_API_KEY=$(curl -s -b "$JAR" -c "$JAR" -X POST "$DS/settings/reveal_access_token" \
  -H 'Accept: text/vnd.turbo-stream.html' \
  --data-urlencode "authenticity_token=$(csrf /settings/api)" \
  --data-urlencode "password=$DOCUSEAL_ADMIN_PASSWORD" | sed -n 's/.*value="\([A-Za-z0-9]\{20,\}\)".*/\1/p' | head -1)

# 4. Append to .env (remove any older DOCUSEAL_* / ESIGN_ADAPTER lines first).
cat >> .env <<EOF
ESIGN_ADAPTER=docuseal
DOCUSEAL_URL=$DS
DOCUSEAL_API_KEY=$DOCUSEAL_API_KEY
DOCUSEAL_WEBHOOK_SECRET=$DOCUSEAL_WEBHOOK_SECRET
DOCUSEAL_ADMIN_EMAIL=$DOCUSEAL_ADMIN_EMAIL
DOCUSEAL_ADMIN_PASSWORD=$DOCUSEAL_ADMIN_PASSWORD
EOF
rm -f "$JAR"
```

The same by hand: open http://localhost:3001, create the admin (app URL `http://localhost:3001`);
Settings > API, reveal and copy the key; Settings > Webhooks, add
`http://host.docker.internal:3000/api/webhooks/esign`, tick **only** `form.completed` and
`form.declined`, save, then on the webhook's page add the secret header
`X-Credora-Webhook-Secret` with a random value. Put the five `DOCUSEAL_*` values in `.env`.

Subscribe to no other event: our route answers any other event 401, and DocuSeal keeps redelivering
it. A fresh DocuSeal volume (`docker volume rm credora-docuseal`) needs this setup again.

### Staff sign-in (two-step)

The seed creates `admin@alvita.test` (AGENCY_ADMIN) and `coordinator@alvita.test` (COORDINATOR),
both with password `alvita-demo-2026`. Two-step sign-in is required for every staff user.

1. With the app running (§ 2), open http://localhost:3000/login and sign in as
   `admin@alvita.test` / `alvita-demo-2026`.
2. The first time, you land on **Set up two-step sign-in**. Add the key it shows to your
   authenticator app (or use "Open in an authenticator app on this device"), type the 6-digit code,
   and keep the ten recovery codes it shows once.
3. Every later sign-in asks for the current 6-digit code (or a recovery code).

Do this the day before, not in front of the audience. Re-seeding does not reset it. If the
authenticator is lost and no recovery code is left, reset it in the dev database and enrol again:

```bash
docker exec credora-postgres psql -U credora -d credora -c \
  "delete from core.\"StaffMfa\" where \"userId\" = (select id from core.\"User\" where email = 'admin@alvita.test')"
```

(Another AGENCY_ADMIN can instead use **Reset two-step sign-in** at `/admin/users`; the seed has
only one admin.) Ten wrong codes lock the second step until such a reset.

## 2. Before the demo

```bash
docker compose up -d                     # postgres, docuseal, ocr
npm run dev                              # terminal 1: http://localhost:3000
npm run worker                           # terminal 2: runs every text turn, OCR and judge job
```

Both must run the whole time: nothing is texted, read or judged without the worker. Then:

- Sign in as `admin@alvita.test` in the browser (§ 1).
- Pick a phone number no caregiver has used (the invite refuses a number in use), for example
  `(646) 555-04xx`.
- Have the four photos on the presenting machine.

## 3. The script

Who sees what: COORDINATOR and AGENCY_ADMIN see the caregiver page (with its transcript and the
**Background check completed** button), **Conversations** and the **Queue** (`/queue`). The
caregiver's "phone" is `/dev/phone/<caregiverId>`, a dev-only page, linked from the caregiver page
(**Open phone**) and from http://localhost:3000/dev. Put the phone and the portal side by side.

Times are from the 2026-09-30 rehearsal: a text reply takes 4-10 s, a photo 25-35 s.

1. **Invite.** Pipeline > **Invite a caregiver**: legal first and last name exactly as printed on the
   photos, the mobile number, State **Demo**, Service type **HHA**, Payer Private pay; leave email
   empty. Within ~5 s the phone gets the welcome and the date-of-birth question.
2. **Open the phone.** On the caregiver page, **Open phone**. The transcript on the caregiver page
   updates as you text.
3. **Intake.** Answer as a caregiver would; it takes any wording. Show off:
   - a free-form date: `i was born march 3rd 1991`;
   - a question at any step: `how long does the whole process take?` (answered from the FAQ;
     anything not in the FAQ is passed to staff);
   - sex (`female`), email, home address in one line, SSN (`078-05-1120` style; the transcript stores
     `[SSN]`, never the number);
   - a correction at the read-back: `actually my birthday is march 13 1991 not the 3rd`. The agent
     re-reads everything with the fix. Then `yes`.
4. **Sign.** About 10 s after `yes`, a DocuSeal link arrives. Open it (same machine), sign both
   documents, submit. Within ~10 s the phone gets "Thanks for signing!" and the request for the HHA
   certificate; the pipeline stage moves to Document review.
5. **Documents, with one return.** Attach photos with the phone's paperclip:
   - first the **wrong** document (§ 4). About 30 s later: "About your HHA certificate: we couldn't
     find your name on it. Please send one issued in your legal name." The queue lists it under
     **Waiting on the caregiver**;
   - then the right HHA certificate, the TB result and the driver's license, in that order, each
     answered "Got it, thanks" and the next request. After the third: "you've sent everything we
     need".
6. **Approve.** In `/queue`, under **Needs a decision**, choose **Accept the document** for each of
   the three. The phone gets "Good news: your ... was approved." for each, and the caregiver moves to
   Verification.
7. **Clear.** On the caregiver page, **Background check completed**, confirm. The stage becomes
   **Ready for AlayaCare** and the phone gets "You're cleared to work with Alvita Care!". Nothing
   is sent to AlayaCare.
8. **Show** the Pipeline board (the caregiver under Ready for AlayaCare) and **Conversations**
   (the full thread). On the caregiver page, **Pause agent** lets staff take over and **Send**
   texts as staff.

## 4. The photos

All in the demo caregiver's **legal name exactly as invited**, with the date of birth you will text.
Photograph flat, in good light, whole document in frame. JPEG, PNG, HEIC or PDF, under 10 MB.

| Photo | What must be legible | Notes |
| --- | --- | --- |
| HHA certificate | the caregiver's name; a completion date | the name on its own line, or in a sentence ("This certifies that ... has completed") |
| TB test result (PPD) | the name; the date read; a "valid through"/expiry date if printed | the name must be printed: a result without the name is texted back |
| Driver's license | name (`LAST, FIRST` on one line is fine); DOB; issue and expiry dates | label and date on the same line, e.g. `ISS 04/10/2024 EXP 03/13/2032`; an expiry date on the line under its label is not read |
| **Wrong document** | someone else's HHA certificate (or the HHA certificate with a different name) | returned as "couldn't find your name on it". An expired document can also show a return, but that depends on the judge model reading the expiry; the wrong name is deterministic |

A name that OCR misreads by more than one letter, or a date of birth on the document that differs
from the one texted, is also texted back. Every document that passes goes to staff: nothing is
auto-approved, and most will show "judge not passed" because the issuer is not on the allowlist.

## 5. If something goes wrong

| Symptom | Cause and fix |
| --- | --- |
| No reply to a text | The worker is not running, or its log shows 401 from OpenAI (stale shell key, § 1). |
| "Sorry, something went wrong. Someone from the team will follow up." and the agent pauses | The model call failed three times; check the key and network, then **Resume agent** on the caregiver page. |
| No signing link | Worker log: a DocuSeal error. "is DocuSeal set up?" means the first run was not done; a 401 means a wrong API key or admin password. The send job retries, then shows in `/queue` under stalled signing; fix the setting, restart the worker, and retry it there. |
| Signed, but no "Thanks for signing" | The webhook did not reach us: check the URL is `host.docker.internal:3000`, the secret header matches `.env`, and the dev server log shows `POST /api/webhooks/esign 200`. |
| Photo never answered | `docker compose ps ocr`; the first read after start is slower. |
| Invite refused "number in use" | Use another number; every rehearsal leaves its caregiver in the dev database. |
