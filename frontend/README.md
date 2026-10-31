# Brightloop Frontend

Next.js (App Router) frontend for the Brightloop Subscription Platform, built with Tailwind CSS and shadcn/ui. Authentication uses NextAuth.js, which calls the FastAPI backend for login and issues the session token.

## Run locally

```bash
npm install
npm run dev
```

App: http://localhost:3000

The backend must be running at the URL set in `BACKEND_URL` (default `http://127.0.0.1:8000`).

## Environment variables

Create `frontend/.env.local`:

```
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=<any long random string>
BACKEND_URL=http://127.0.0.1:8000
```

## Structure

```
src/
├── app/
│   ├── (auth)/         login, register, password reset, email verification
│   ├── (dashboard)/    admin and staff screens
│   └── (portal)/       customer portal
├── components/         layout, shared components, shadcn/ui
├── lib/                api client, auth config, validators
├── hooks/
└── types/
```

## Build check

```bash
npm run build
```

See the root `README.md` for full project setup, features and team.
