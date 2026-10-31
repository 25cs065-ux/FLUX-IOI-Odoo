# Brightloop Subscription Platform

## Setup
1. Clone the repo and run `git checkout develop`
2. Copy `.env.example` to `.env` (frontend: `frontend/.env.local`) and ask Khushi for the keys
3. Backend:
   cd backend
   python -m venv venv
   source venv/Scripts/activate   # Mac/Linux: source venv/bin/activate
   pip install -r requirements.txt
   uvicorn app.main:app --reload
   (API docs at http://localhost:8000/docs)
4. Frontend:
   cd frontend
   npm install
   npm run dev
   (App at http://localhost:3000)

## Team
Aadya (Tech Lead), Seena (Frontend), Vaidehi (Features and QA), Khushi (Integration)

## Rules
- Never commit .env files or API keys
- Work only on feature/<name>-<module> branches and open PRs into develop
- Only edit files in your own folders (see docs/task-board.md)