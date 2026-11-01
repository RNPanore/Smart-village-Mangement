# Smart Village Management System

A web platform for a Gram Panchayat and its villagers.

- **Frontend:** plain HTML, CSS and JavaScript (no frameworks, no build step)
- **Backend:** Python 3 + Flask, with a SQLite database (a single file, created automatically)

## Run it

You need Python 3.9 or newer.

**Windows:** double-click `run.bat`
**Mac / Linux:** `./run.sh`

Or manually:

```
cd backend
pip install -r requirements.txt
python app.py
```

Then open **http://127.0.0.1:5000**. The database and demo data are created on first start.

## Demo accounts

| Role | Username | Password |
|---|---|---|
| Village Administrator | `admin` | `admin123` |
| Supervisor / Sarpanch | `sarpanch` | `staff123` |
| Department head (Water) | `water_head` | `staff123` |
| Department head (Public Works) | `works_head` | `staff123` |
| Field worker (Water) | `water_worker` | `staff123` |
| Field worker (Public Works) | `works_worker` | `staff123` |
| Citizen | `ramesh`, `sunita`, `ganesh`, `lata` | `citizen123` |

Anyone can also register as a citizen from the Register page. **Change or delete these demo accounts before real use.**

## What is included

**Public website (no login):** Home, About, Features, How it works, Contact form, and complaint tracking by reference code (e.g. `SV-2026-00001`). English / Marathi switch and dark mode.

**Complaints (the core workflow)**
- Citizens raise complaints with category, priority, location and up to 4 photos (JPG/PNG/WebP, 5 MB each; checked by file content, not just the extension).
- Each complaint gets a reference code, a target date (SLA by priority: urgent 24 h, high 72 h, normal 7 days, low 14 days) and a full timeline.
- Status flow: Submitted, Under review, Assigned, In progress, Waiting for information, Resolved, Reopened, Referred out, Rejected, Duplicate. Only valid moves are allowed.
- Citizens can reply, rate a resolution, or reopen it. Overdue complaints are flagged.

**Roles and what each can do**

| Role | Access |
|---|---|
| Citizen | Own complaints, bills, scheme applications, events, notices, projects |
| Field worker | Complaints assigned to them: start work, mark resolved, add notes |
| Department head | All complaints of their department; assign workers; move work along |
| Supervisor | Read-only view of the whole village and reports; can reopen resolved work |
| Village Administrator | Everything: people, departments, categories, notices, schemes, bills, events, projects, reports, audit log, messages |

**Village services:** notices, government schemes with applications and approval, house tax / water bills with online payment (demo, no real money), events with registration, development projects with budget and progress.

**Administration:** citizens and staff management, departments and categories, reports with CSV export, audit log of important actions, contact-form inbox.

## Project layout

```
smart_village/
  backend/
    app.py            all API routes, database schema and demo data
    test_api.py       automated API tests  (python test_api.py)
    requirements.txt
    village.db        created on first run
    uploads/          complaint photos (created on first run)
  frontend/
    index.html
    css/style.css
    js/  i18n.js api.js ui.js public.js views.js app.js
  run.bat  run.sh
```

## Security notes

- Passwords are hashed; sessions use HttpOnly cookies; every API route checks the user's role, and complaints/photos are visible only to the people involved.
- Login, registration, tracking and contact are rate limited (in memory, per process).
- A random secret key is created in `backend/.secret_key` on first run. For deployment set the `SECRET_KEY` environment variable instead.
- Uploaded photos are saved under random names and served only through a permission check.
- This runs Flask's built-in server, which is fine for a demo or a small local deployment. For a public site, run it behind HTTPS with a production server such as `waitress` or `gunicorn`, and set a strong `SECRET_KEY`.
- The bill payment is a simulation. Connect a real payment gateway before collecting money.

## Possible next steps

SMS / WhatsApp notifications, PDF receipts, multiple villages, a real payment gateway, PostgreSQL instead of SQLite.
