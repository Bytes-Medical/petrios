# Byte Teaching

A teaching management web application designed for NHS trainees to facilitate and encourage teaching, with an ultra-simple UI.

## Features

- **Multi-tenancy**: Organizations and departments
- **Role-based access**: org_admin, department_admin, faculty, trainee
- **Session management**: Create, edit, publish, and cancel teaching sessions
- **Evidence-based attendance**: Multiple check-in methods (self, group code, feedback) with audit trail
- **Certificate generation**: PDF certificates for both teachers and attendees
- **Certificate verification**: Public verification page for certificates

## Tech Stack

- Next.js 14 (App Router) + TypeScript
- Tailwind CSS
- Supabase Auth for authentication
- Supabase (Postgres + Row Level Security)
- @react-pdf/renderer for PDF certificate generation

## Setup

### Prerequisites

- Node.js 18+ and npm
- Supabase account

### Installation

1. Clone the repository and install dependencies:

```bash
npm install
```

2. Set up environment variables:

Create a `.env.local` file in the root directory with the following variables:

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# Public app URL used in emailed sign-in and invite links
NEXT_PUBLIC_APP_URL=https://your-production-domain.example

# Email delivery (MailerSend — https://app.mailersend.com/api-tokens)
MAILERSEND_API_TOKEN=your-mailersend-api-token
MAIL_FROM=Byte Teaching <no-reply@your-verified-domain>

# Local testing — both optional:
#   Leave MAILERSEND_API_TOKEN unset in dev to log emails to the console
#   instead of sending (works for any recipient, no provider needed).
#   Or set a token + MAIL_DEV_REDIRECT to funnel ALL mail to one inbox.
# MAIL_DEV_REDIRECT=you@example.com
```

### Supabase Setup

1. Create a new Supabase project at https://supabase.com
2. Enable Email authentication in Authentication > Providers
3. In Authentication > URL Configuration, set the Site URL to the same value as `NEXT_PUBLIC_APP_URL`, and add your app callback URL to Redirect URLs, for example `https://your-production-domain.example/join/callback`.
4. Run the migrations in `supabase/migrations/` in order:
   - `000_organizations.sql` - Creates organizations and organization_members tables
   - `001_initial_schema.sql` - Creates all other tables
   - `002_rls_policies.sql` - Sets up Row Level Security policies
   - `003_super_admin_and_join_requests.sql` - Super admin and join requests
   - ... (all other migrations in order)
   - `014_evidence_based_attendance.sql` - Evidence-based attendance system
   - `015_attendance_evidence_rls.sql` - RLS for attendance evidence

You can run these migrations using the Supabase SQL editor or CLI:

```bash
# Using Supabase CLI (if installed)
supabase db push

# Or manually copy and paste the SQL into the Supabase SQL editor
```

### Running the Application

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Project Structure

```
byte-teaching/
├── app/
│   ├── actions/          # Server actions
│   │   ├── departments.ts
│   │   ├── sessions.ts
│   │   ├── attendance.ts
│   │   ├── attendance-evidence.ts
│   │   ├── certificates.ts
│   │   ├── feedback.ts
│   │   └── organizations.ts
│   ├── api/              # API routes
│   ├── dashboard/        # Dashboard page
│   ├── departments/      # Department pages
│   ├── sessions/         # Session pages
│   ├── certificates/     # Certificates page
│   ├── verify/           # Certificate verification
│   ├── admin/            # Admin panel
│   ├── login/            # Login page
│   └── signup/           # Signup page
├── components/           # React components
├── lib/
│   ├── supabase/         # Supabase client utilities
│   ├── auth.ts           # Auth helpers
│   ├── types.ts          # TypeScript types
│   └── certificates/     # PDF generation
├── supabase/
│   └── migrations/       # Database migrations
└── middleware.ts         # Auth middleware
```

## Database Schema

- **organizations**: Organization entities
- **organization_members**: User roles within organizations
- **departments**: Organization departments
- **department_members**: User roles within departments
- **sessions**: Teaching sessions (with attendance configuration)
- **session_teachers**: Teachers assigned to sessions
- **attendance_evidence**: Append-only audit trail of attendance evidence
- **attendance**: Computed attendance records (derived from evidence)
- **session_feedback**: Session feedback submissions
- **certificates**: Generated certificates

All tables use Row Level Security (RLS) to enforce organization and role-based access.

## Usage

### First Time Setup

1. Sign up with email and password
2. Create an organization in the Admin panel
3. As an org admin, create departments
4. Assign users to departments with appropriate roles

### Creating Sessions

1. Navigate to a department
2. Click "Create Session"
3. Fill in session details (title, date, location, etc.)
4. Publish the session to make it visible

### Attendance (Evidence-Based System)

- **Self Check-in**: Attendees can check in during the session window (configurable, default: 15 min before to 45 min after start)
- **Group Code**: Teachers can generate group codes/QR codes for group check-ins
- **Feedback**: Submitting feedback can automatically mark attendance (if user is department member)
- **Manual**: Department admins and faculty can manually confirm attendance
- **Evidence Trail**: All attendance evidence is stored immutably for audit
- **Locking**: Attendance can be locked after session ends to prevent changes
- **Export**: Export attendance as CSV from the session page

See [EVIDENCE_ATTENDANCE.md](./EVIDENCE_ATTENDANCE.md) for detailed documentation.

### Certificates

- Generate certificates for a session (creates certificates for all teachers and present attendees)
- View your certificates on the Certificates page
- Verify certificates using the public verification page: `/verify/[certificateCode]`

## Deployment

This application is ready for deployment on Vercel:

1. Push your code to a Git repository
2. Import the project in Vercel
3. Add environment variables in Vercel dashboard
4. Deploy

## License

Copyright (C) 2026 Akanimoh Osutuk.

Byte Teaching is licensed under the **GNU Affero General Public License
v3.0 or later (AGPL-3.0-or-later)**. See [`LICENSE`](./LICENSE) for the
full license text and [`NOTICE`](./NOTICE) for attribution requirements.

**What this means in practice:**

- You are free to use, read, modify, self-host, and distribute this
  software, including for internal commercial use inside your
  organisation.
- If you modify it and either redistribute it **or run the modified
  version as a network service** (e.g. a SaaS offering), AGPL section 13
  requires you to make the complete corresponding source code available
  to users of that service under the same license.
- You must preserve copyright notices and the `NOTICE` file, and
  reasonably attribute the original project and author in any
  distribution or user-facing "about" surface.

### Commercial licensing

The AGPL terms may be incompatible with closed-source embedding,
proprietary derivative products, or operating a managed service without
sharing modifications. The copyright holder retains full rights to the
original work and can offer separate **commercial licenses** for these
use cases.

For commercial licensing inquiries, contact the copyright holder
(Akanimoh Osutuk).

### Contributing

Contributions are welcome. By submitting a patch you agree to the
Developer Certificate of Origin (DCO) — see [`CONTRIBUTING.md`](./CONTRIBUTING.md)
for details.
