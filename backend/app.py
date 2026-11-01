"""
Smart Village Management System - Backend
Python (Flask) + SQLite.  No other services needed.

Run:  python app.py      then open  http://127.0.0.1:5000

Roles
  citizen          villager: raises and tracks complaints, pays bills, applies for schemes
  field_worker     works on complaints assigned to them
  department_head  manages complaints of their own department, assigns workers
  supervisor       read-only oversight of the whole village, can reopen resolved work
  admin            village administrator: full control
"""
import csv
import io
import json
import os
import secrets
import sqlite3
import time
from datetime import date, datetime, timedelta
from functools import wraps

from flask import Flask, Response, g, jsonify, request, send_from_directory, session
from werkzeug.security import check_password_hash, generate_password_hash

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.environ.get("SV_DB", os.path.join(BASE_DIR, "village.db"))
UPLOAD_DIR = os.path.join(BASE_DIR, "uploads")
FRONT_DIR = os.path.abspath(os.path.join(BASE_DIR, "..", "frontend"))
os.makedirs(UPLOAD_DIR, exist_ok=True)


def load_secret():
    env = os.environ.get("SECRET_KEY")
    if env:
        return env
    path = os.path.join(BASE_DIR, ".secret_key")
    if not os.path.exists(path):
        with open(path, "w") as f:
            f.write(secrets.token_hex(32))
        try:
            os.chmod(path, 0o600)
        except OSError:
            pass
    with open(path) as f:
        return f.read().strip()


app = Flask(__name__, static_folder=None)
app.secret_key = load_secret()
app.config.update(
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
    PERMANENT_SESSION_LIFETIME=timedelta(hours=12),
    MAX_CONTENT_LENGTH=24 * 1024 * 1024,
)

ROLES = ("citizen", "field_worker", "department_head", "supervisor", "admin")
STAFF_ROLES = ("field_worker", "department_head", "supervisor")
STATUSES = ("SUBMITTED", "UNDER_REVIEW", "ASSIGNED", "IN_PROGRESS", "WAITING_FOR_INFORMATION",
            "RESOLVED", "REOPENED", "REFERRED_OUT", "REJECTED", "DUPLICATE")
TERMINAL = ("RESOLVED", "REJECTED", "DUPLICATE", "REFERRED_OUT")
PRIORITIES = ("LOW", "NORMAL", "HIGH", "URGENT")
SLA_HOURS = {"URGENT": 24, "HIGH": 72, "NORMAL": 168, "LOW": 336}

# status -> statuses that may follow it (the complaint state machine)
GRAPH = {
    "SUBMITTED": ("UNDER_REVIEW", "ASSIGNED", "REJECTED", "DUPLICATE", "REFERRED_OUT"),
    "UNDER_REVIEW": ("ASSIGNED", "WAITING_FOR_INFORMATION", "REJECTED", "DUPLICATE", "REFERRED_OUT"),
    "ASSIGNED": ("IN_PROGRESS", "WAITING_FOR_INFORMATION", "UNDER_REVIEW"),
    "IN_PROGRESS": ("RESOLVED", "WAITING_FOR_INFORMATION"),
    "WAITING_FOR_INFORMATION": ("UNDER_REVIEW", "IN_PROGRESS"),
    "RESOLVED": ("REOPENED",),
    "REOPENED": ("ASSIGNED", "IN_PROGRESS", "UNDER_REVIEW"),
    "REJECTED": (), "DUPLICATE": (), "REFERRED_OUT": (),
}
WORKER_MOVES = {("ASSIGNED", "IN_PROGRESS"), ("ASSIGNED", "WAITING_FOR_INFORMATION"),
                ("IN_PROGRESS", "RESOLVED"), ("IN_PROGRESS", "WAITING_FOR_INFORMATION"),
                ("REOPENED", "IN_PROGRESS")}


# ----------------------------------------------------------------------------
# Database
# ----------------------------------------------------------------------------
def connect():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def db():
    if "db" not in g:
        g.db = connect()
    return g.db


@app.teardown_appcontext
def close_db(_exc):
    conn = g.pop("db", None)
    if conn is not None:
        conn.close()


def rows(sql, args=()):
    return [dict(r) for r in db().execute(sql, args).fetchall()]


def one(sql, args=()):
    r = db().execute(sql, args).fetchone()
    return dict(r) if r else None


def run(sql, args=()):
    cur = db().execute(sql, args)
    db().commit()
    return cur.lastrowid


SCHEMA = """
CREATE TABLE IF NOT EXISTS departments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    description TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL,
    default_priority TEXT DEFAULT 'NORMAL'
);
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'citizen',
    department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL,
    phone TEXT DEFAULT '',
    address TEXT DEFAULT '',
    ward TEXT DEFAULT '',
    family_members INTEGER DEFAULT 1,
    active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS complaints (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reference_code TEXT UNIQUE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    description TEXT DEFAULT '',
    location TEXT DEFAULT '',
    priority TEXT DEFAULT 'NORMAL',
    status TEXT DEFAULT 'SUBMITTED',
    department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL,
    assigned_to INTEGER REFERENCES users(id) ON DELETE SET NULL,
    sla_due TEXT DEFAULT '',
    resolved_at TEXT DEFAULT '',
    rating INTEGER DEFAULT 0,
    feedback TEXT DEFAULT '',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS complaint_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    complaint_id INTEGER NOT NULL REFERENCES complaints(id) ON DELETE CASCADE,
    actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    event_type TEXT NOT NULL,
    old_status TEXT DEFAULT '',
    new_status TEXT DEFAULT '',
    description TEXT DEFAULT '',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS complaint_files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    complaint_id INTEGER NOT NULL REFERENCES complaints(id) ON DELETE CASCADE,
    stored_name TEXT NOT NULL,
    original_name TEXT DEFAULT '',
    mime TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    actor_name TEXT DEFAULT '',
    action TEXT NOT NULL,
    resource TEXT DEFAULT '',
    resource_id INTEGER,
    detail TEXT DEFAULT '',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS contact_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    contact TEXT DEFAULT '',
    message TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS notices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    category TEXT DEFAULT 'General',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS schemes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    eligibility TEXT DEFAULT '',
    benefit TEXT DEFAULT '',
    last_date TEXT DEFAULT '',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS applications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    scheme_id INTEGER NOT NULL REFERENCES schemes(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status TEXT DEFAULT 'Pending',
    remarks TEXT DEFAULT '',
    applied_at TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(scheme_id, user_id)
);
CREATE TABLE IF NOT EXISTS bills (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    bill_type TEXT NOT NULL,
    description TEXT DEFAULT '',
    amount REAL NOT NULL,
    due_date TEXT DEFAULT '',
    status TEXT DEFAULT 'Unpaid',
    paid_on TEXT DEFAULT '',
    payment_ref TEXT DEFAULT '',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT DEFAULT '',
    venue TEXT DEFAULT '',
    event_date TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS event_regs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE(event_id, user_id)
);
CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT DEFAULT '',
    budget REAL DEFAULT 0,
    spent REAL DEFAULT 0,
    progress INTEGER DEFAULT 0,
    status TEXT DEFAULT 'Planned',
    start_date TEXT DEFAULT '',
    end_date TEXT DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_complaints_user ON complaints(user_id);
CREATE INDEX IF NOT EXISTS idx_complaints_status ON complaints(status);
CREATE INDEX IF NOT EXISTS idx_complaints_dept ON complaints(department_id);
CREATE INDEX IF NOT EXISTS idx_complaints_assignee ON complaints(assigned_to);
CREATE INDEX IF NOT EXISTS idx_events_complaint ON complaint_events(complaint_id);
"""


def stamp(dt=None):
    return (dt or datetime.now()).strftime("%Y-%m-%d %H:%M:%S")


def sla_due_for(priority, start=None):
    return stamp((start or datetime.now()) + timedelta(hours=SLA_HOURS.get(priority, 168)))


def add_event(conn, cid, actor, etype, old="", new="", desc="", when=None):
    conn.execute(
        "INSERT INTO complaint_events(complaint_id,actor_id,event_type,old_status,new_status,description,created_at) VALUES(?,?,?,?,?,?,?)",
        (cid, actor, etype, old, new, desc, when or stamp()),
    )


def insert_complaint(conn, user_id, category_id, title, description, location, priority, when=None):
    when = when or datetime.now()
    cat = conn.execute("SELECT department_id FROM categories WHERE id=?", (category_id,)).fetchone()
    dept = cat["department_id"] if cat else None
    cur = conn.execute(
        "INSERT INTO complaints(user_id,category_id,title,description,location,priority,department_id,sla_due,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
        (user_id, category_id, title, description, location, priority, dept, sla_due_for(priority, when), stamp(when), stamp(when)),
    )
    cid = cur.lastrowid
    conn.execute("UPDATE complaints SET reference_code=? WHERE id=?", (f"SV-{when.year}-{cid:05d}", cid))
    add_event(conn, cid, user_id, "SUBMITTED", "", "SUBMITTED", "Complaint submitted", stamp(when))
    return cid


def init_db():
    conn = connect()
    conn.executescript(SCHEMA)
    conn.commit()
    if not conn.execute("SELECT COUNT(*) FROM users").fetchone()[0]:
        seed(conn)
    conn.close()


def seed(conn):
    """Demo data so the app is usable on first run."""
    today = date.today()

    def d(n):
        return (today + timedelta(days=n)).isoformat()

    depts = [("Water Supply", "Taps, pipelines, tanks and borewells"),
             ("Public Works", "Roads, drains, street lights and buildings"),
             ("Sanitation", "Garbage collection, toilets and cleanliness"),
             ("Health & Welfare", "Health centre, anganwadi and welfare services")]
    conn.executemany("INSERT INTO departments(name,description) VALUES(?,?)", depts)
    cats = [("Water Supply", 1, "HIGH"), ("Pipeline Leakage", 1, "HIGH"), ("Road & Potholes", 2, "NORMAL"),
            ("Street Light", 2, "NORMAL"), ("Drainage", 2, "HIGH"), ("Garbage Collection", 3, "NORMAL"),
            ("Public Toilet", 3, "NORMAL"), ("Health Service", 4, "HIGH"), ("Other", None, "NORMAL")]
    conn.executemany("INSERT INTO categories(name,department_id,default_priority) VALUES(?,?,?)", cats)

    def user(name, uname, pw, role, dept=None, phone="", addr="", ward="", fam=1):
        return conn.execute(
            "INSERT INTO users(name,username,password_hash,role,department_id,phone,address,ward,family_members) VALUES(?,?,?,?,?,?,?,?,?)",
            (name, uname, generate_password_hash(pw), role, dept, phone, addr, ward, fam)).lastrowid

    user("Rajesh Bhosale", "admin", "admin123", "admin", phone="9000000000")
    user("Sarpanch Sunil Deshmukh", "sarpanch", "staff123", "supervisor", phone="9000000001")
    h1 = user("Anil Kulkarni", "water_head", "staff123", "department_head", 1, "9000000011")
    h2 = user("Prakash More", "works_head", "staff123", "department_head", 2, "9000000012")
    w1 = user("Vijay Patil", "water_worker", "staff123", "field_worker", 1, "9000000021")
    w2 = user("Santosh Gaikwad", "works_worker", "staff123", "field_worker", 2, "9000000022")
    w3 = user("Mangal Kamble", "sanitation_worker", "staff123", "field_worker", 3, "9000000023")
    c1 = user("Ramesh Patil", "ramesh", "citizen123", "citizen", None, "9822011111", "House 12, Main Road", "Ward 1", 5)
    c2 = user("Sunita Jadhav", "sunita", "citizen123", "citizen", None, "9822022222", "House 27, Temple Lane", "Ward 2", 4)
    c3 = user("Ganesh Pawar", "ganesh", "citizen123", "citizen", None, "9822033333", "House 8, Market Street", "Ward 1", 3)
    c4 = user("Lata Shinde", "lata", "citizen123", "citizen", None, "9822044444", "House 41, River Side", "Ward 3", 6)

    now_ = datetime.now()
    # complaint 1: in progress (water)
    a = insert_complaint(conn, c1, 1, "No water in Ward 1 taps", "Taps have been dry for two days.", "Main Road, Ward 1", "HIGH", now_ - timedelta(days=2))
    conn.execute("UPDATE complaints SET status='IN_PROGRESS', assigned_to=?, updated_at=? WHERE id=?", (w1, stamp(), a))
    add_event(conn, a, h1, "ASSIGNED", "SUBMITTED", "ASSIGNED", "Assigned to Vijay Patil", stamp(now_ - timedelta(days=1, hours=20)))
    add_event(conn, a, w1, "STATUS_CHANGE", "ASSIGNED", "IN_PROGRESS", "Pump technician checking the main valve", stamp(now_ - timedelta(days=1)))
    # complaint 2: pending
    insert_complaint(conn, c2, 4, "Street light not working", "Light near the temple is off since last week.", "Temple Lane", "NORMAL", now_ - timedelta(hours=30))
    # complaint 3: resolved with feedback
    b = insert_complaint(conn, c3, 6, "Garbage not collected", "Garbage van has not come this week.", "Market Street", "NORMAL", now_ - timedelta(days=6))
    conn.execute("UPDATE complaints SET status='RESOLVED', assigned_to=?, resolved_at=?, rating=4, feedback='Resolved quickly, thank you.' WHERE id=?",
                 (w3, stamp(now_ - timedelta(days=4)), b))
    add_event(conn, b, 1, "ASSIGNED", "SUBMITTED", "ASSIGNED", "Assigned to Mangal Kamble", stamp(now_ - timedelta(days=5)))
    add_event(conn, b, w3, "STATUS_CHANGE", "IN_PROGRESS", "RESOLVED", "Collection resumed from Monday", stamp(now_ - timedelta(days=4)))
    # complaint 4: urgent, assigned to department only
    insert_complaint(conn, c4, 3, "Large pothole on river road", "Dangerous for two-wheelers, especially at night.", "River Road near the bridge", "URGENT", now_ - timedelta(hours=5))
    conn.execute("UPDATE complaints SET status='UNDER_REVIEW' WHERE reference_code LIKE ? AND title LIKE 'Large pothole%'", (f"SV-{now_.year}-%",))

    conn.executemany("INSERT INTO notices(title,content,category) VALUES(?,?,?)", [
        ("Gram Sabha Meeting", "Gram Sabha will be held on the coming Sunday at 10 AM in the Panchayat hall. All residents are requested to attend.", "Meeting"),
        ("Water Supply Timing Change", "From next week, water supply timing will be 6 AM - 8 AM and 5 PM - 6 PM.", "Utility"),
        ("Free Health Camp", "A free health check-up camp will be organised at the Primary Health Centre. Bring your Aadhaar card.", "Health")])
    conn.executemany("INSERT INTO schemes(name,description,eligibility,benefit,last_date) VALUES(?,?,?,?,?)", [
        ("Kisan Solar Pump Subsidy", "Subsidy for installing solar water pumps on farms.", "Farmers with at least 1 acre land", "Up to 90% subsidy on pump cost", d(45)),
        ("Housing Support Scheme", "Financial help for building a pucca house.", "Families without a pucca house", "Rs. 1,20,000 in instalments", d(60)),
        ("Girl Child Education Aid", "Scholarship for school-going girls.", "Girl students up to class 12", "Rs. 5,000 per year", d(30))])
    conn.executemany("INSERT INTO applications(scheme_id,user_id,status) VALUES(?,?,?)", [(1, c1, "Pending"), (3, c2, "Approved"), (2, c4, "Pending")])
    bills = []
    for uid in (c1, c2, c3, c4):
        bills.append((uid, "House Tax", "Annual house tax", 1200 + uid * 20, d(20), "Unpaid", "", ""))
        bills.append((uid, "Water Bill", "Monthly water charges", 150, d(10), "Unpaid", "", ""))
    bills[0] = (c1, "House Tax", "Annual house tax", 1500, d(20), "Paid", d(-2), "PAY-DEMO0001")
    bills[3] = (c2, "Water Bill", "Monthly water charges", 150, d(-5), "Unpaid", "", "")
    conn.executemany("INSERT INTO bills(user_id,bill_type,description,amount,due_date,status,paid_on,payment_ref) VALUES(?,?,?,?,?,?,?,?)", bills)
    conn.executemany("INSERT INTO events(title,description,venue,event_date) VALUES(?,?,?,?)", [
        ("Village Fair", "Annual village fair with local food stalls and cultural programmes.", "Village Ground", d(12)),
        ("Tree Plantation Drive", "Plant saplings along the village road. Saplings provided.", "Main Road", d(5)),
        ("Digital Literacy Workshop", "Learn UPI payments and online government services.", "Panchayat Hall", d(20))])
    conn.executemany("INSERT INTO projects(title,description,budget,spent,progress,status,start_date,end_date) VALUES(?,?,?,?,?,?,?,?)", [
        ("Village Road Concreting", "Concrete road from the main gate to the temple.", 1500000, 900000, 60, "In Progress", d(-60), d(60)),
        ("Solar Street Lights", "Install 40 solar street lights.", 600000, 600000, 100, "Completed", d(-120), d(-20)),
        ("Community Water Tank", "New overhead tank with a 50,000 litre capacity.", 2000000, 150000, 10, "In Progress", d(-15), d(150)),
        ("Primary School Renovation", "Classroom repair and new toilets.", 800000, 0, 0, "Planned", d(30), d(120))])
    conn.commit()


# ----------------------------------------------------------------------------
# Errors, auth, validation helpers
# ----------------------------------------------------------------------------
class ApiError(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.message = message
        self.status = status


@app.errorhandler(ApiError)
def handle_api_error(e):
    return jsonify({"error": e.message}), e.status


@app.errorhandler(404)
def handle_404(_e):
    if request.path.startswith("/api/"):
        return jsonify({"error": "Not found"}), 404
    return send_from_directory(FRONT_DIR, "index.html")


@app.errorhandler(413)
def handle_413(_e):
    return jsonify({"error": "Upload too large (max 24 MB in total)"}), 413


@app.errorhandler(500)
def handle_500(_e):
    return jsonify({"error": "Server error"}), 500


@app.after_request
def security_headers(resp):
    resp.headers.setdefault("X-Content-Type-Options", "nosniff")
    resp.headers.setdefault("X-Frame-Options", "DENY")
    resp.headers.setdefault("Referrer-Policy", "same-origin")
    resp.headers.setdefault(
        "Content-Security-Policy",
        "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; frame-ancestors 'none'")
    if request.path.startswith("/api/"):
        resp.headers["Cache-Control"] = "no-store"
    return resp


_hits = {}


def throttle(key, limit, window=60):
    """Tiny in-memory rate limiter (per process)."""
    t = time.time()
    k = f"{key}:{request.remote_addr}"
    recent = [x for x in _hits.get(k, []) if t - x < window]
    if len(recent) >= limit:
        raise ApiError("Too many attempts. Please wait a minute and try again.", 429)
    recent.append(t)
    _hits[k] = recent


def current_user():
    uid = session.get("uid")
    if not uid:
        return None
    return one("""SELECT u.id,u.name,u.username,u.role,u.department_id,u.phone,u.address,u.ward,u.family_members,
                  d.name department_name FROM users u LEFT JOIN departments d ON d.id=u.department_id
                  WHERE u.id=? AND u.active=1""", (uid,))


def login_required(fn):
    @wraps(fn)
    def wrapper(*a, **kw):
        user = current_user()
        if not user:
            raise ApiError("Please log in", 401)
        g.user = user
        return fn(*a, **kw)
    return wrapper


def roles_required(*roles):
    def deco(fn):
        @wraps(fn)
        @login_required
        def wrapper(*a, **kw):
            if g.user["role"] not in roles:
                raise ApiError("You do not have access to this", 403)
            return fn(*a, **kw)
        return wrapper
    return deco


admin_required = roles_required("admin")
reader_required = roles_required("admin", "supervisor")


def body():
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        raise ApiError("Invalid request body")
    return data


def text(data, key, required=False, maxlen=1000):
    v = data.get(key, "")
    v = "" if v is None else str(v).strip()
    if required and not v:
        raise ApiError(f"{key.replace('_', ' ').title()} is required")
    return v[:maxlen]


def number(data, key, default=0.0, minimum=0.0):
    try:
        v = float(data.get(key, default) or 0)
    except (TypeError, ValueError):
        raise ApiError(f"{key.replace('_', ' ').title()} must be a number")
    if v < minimum:
        raise ApiError(f"{key.replace('_', ' ').title()} cannot be less than {minimum:g}")
    return v


def audit(action, resource="", rid=None, detail=""):
    u = getattr(g, "user", None) or {}
    db().execute("INSERT INTO audit_logs(actor_id,actor_name,action,resource,resource_id,detail,created_at) VALUES(?,?,?,?,?,?,?)",
                 (u.get("id"), u.get("name", ""), action, resource, rid, detail[:300], stamp()))
    db().commit()


def check_password_rules(pw):
    if len(pw) < 6:
        raise ApiError("Password must be at least 6 characters")


def clean_username(raw):
    u = raw.strip().lower()
    if not (3 <= len(u) <= 40) or not u.replace("_", "").replace(".", "").replace("-", "").isalnum():
        raise ApiError("Username must be 3-40 characters: letters, numbers, . _ -")
    return u


# ----------------------------------------------------------------------------
# Auth
# ----------------------------------------------------------------------------
@app.post("/api/login")
def login():
    throttle("login", 12)
    data = body()
    username = text(data, "username", True).lower()
    password = text(data, "password", True, 200)
    u = one("SELECT * FROM users WHERE username=? AND active=1", (username,))
    if not u or not check_password_hash(u["password_hash"], password):
        raise ApiError("Invalid username or password", 401)
    session.clear()
    session.permanent = True
    session["uid"] = u["id"]
    g.user = current_user()
    audit("LOGIN", "user", u["id"])
    return jsonify(g.user)


@app.post("/api/register")
def register():
    throttle("register", 6)
    data = body()
    name = text(data, "name", True, 100)
    username = clean_username(text(data, "username", True, 40))
    password = text(data, "password", True, 200)
    check_password_rules(password)
    if one("SELECT id FROM users WHERE username=?", (username,)):
        raise ApiError("Username already taken")
    uid = run("INSERT INTO users(name,username,password_hash,role,phone,address,ward,family_members) VALUES(?,?,?,?,?,?,?,?)",
              (name, username, generate_password_hash(password), "citizen", text(data, "phone", maxlen=20),
               text(data, "address", maxlen=200), text(data, "ward", maxlen=50), int(number(data, "family_members", 1, 1))))
    session.clear()
    session.permanent = True
    session["uid"] = uid
    g.user = current_user()
    audit("REGISTER", "user", uid)
    return jsonify(g.user), 201


@app.post("/api/logout")
def logout():
    session.clear()
    return jsonify({"ok": True})


@app.get("/api/me")
def me():
    return jsonify(current_user())  # null when not logged in


@app.post("/api/change-password")
@login_required
def change_password():
    data = body()
    u = one("SELECT * FROM users WHERE id=?", (g.user["id"],))
    if not check_password_hash(u["password_hash"], text(data, "old_password", True, 200)):
        raise ApiError("Current password is incorrect")
    new = text(data, "new_password", True, 200)
    check_password_rules(new)
    run("UPDATE users SET password_hash=? WHERE id=?", (generate_password_hash(new), g.user["id"]))
    audit("PASSWORD_CHANGE", "user", g.user["id"])
    return jsonify({"ok": True})


@app.put("/api/profile")
@login_required
def update_profile():
    data = body()
    run("UPDATE users SET name=?, phone=?, address=?, ward=?, family_members=? WHERE id=?",
        (text(data, "name", True, 100), text(data, "phone", maxlen=20), text(data, "address", maxlen=200),
         text(data, "ward", maxlen=50), int(number(data, "family_members", 1, 1)), g.user["id"]))
    return jsonify(current_user())


# ----------------------------------------------------------------------------
# Public endpoints (no login)
# ----------------------------------------------------------------------------
@app.get("/api/public/overview")
def public_overview():
    return jsonify({
        "citizens": one("SELECT COUNT(*) c FROM users WHERE role='citizen' AND active=1")["c"],
        "complaints": one("SELECT COUNT(*) c FROM complaints")["c"],
        "resolved": one("SELECT COUNT(*) c FROM complaints WHERE status='RESOLVED'")["c"],
        "projects": one("SELECT COUNT(*) c FROM projects")["c"],
        "notices": rows("SELECT id,title,content,category,created_at FROM notices ORDER BY id DESC LIMIT 3"),
    })


@app.get("/api/public/track/<ref>")
def public_track(ref):
    throttle("track", 30)
    c = one("""SELECT c.id,c.reference_code,c.title,c.status,c.priority,c.created_at,c.resolved_at,cat.name category
               FROM complaints c LEFT JOIN categories cat ON cat.id=c.category_id WHERE c.reference_code=?""",
            (ref.strip().upper()[:32],))
    if not c:
        raise ApiError("No complaint found with that reference code", 404)
    c["timeline"] = rows("""SELECT event_type,old_status,new_status,created_at FROM complaint_events
                            WHERE complaint_id=? ORDER BY id""", (c.pop("id"),))
    return jsonify(c)


@app.post("/api/public/contact")
def public_contact():
    throttle("contact", 5, 300)
    d = body()
    run("INSERT INTO contact_messages(name,contact,message,created_at) VALUES(?,?,?,?)",
        (text(d, "name", True, 100), text(d, "contact", maxlen=120), text(d, "message", True, 2000), stamp()))
    return jsonify({"ok": True}), 201


@app.get("/api/meta")
@login_required
def meta():
    return jsonify({
        "departments": rows("SELECT * FROM departments ORDER BY name"),
        "categories": rows("SELECT * FROM categories ORDER BY name"),
        "statuses": STATUSES, "priorities": PRIORITIES, "roles": ROLES,
    })


# ----------------------------------------------------------------------------
# Departments / categories (admin manages, everyone signed-in reads via /api/meta)
# ----------------------------------------------------------------------------
@app.post("/api/departments")
@admin_required
def departments_create():
    d = body()
    try:
        did = run("INSERT INTO departments(name,description) VALUES(?,?)", (text(d, "name", True, 100), text(d, "description", maxlen=300)))
    except sqlite3.IntegrityError:
        raise ApiError("A department with this name already exists")
    audit("CREATE", "department", did)
    return jsonify({"id": did}), 201


@app.put("/api/departments/<int:did>")
@admin_required
def departments_update(did):
    d = body()
    try:
        run("UPDATE departments SET name=?, description=? WHERE id=?", (text(d, "name", True, 100), text(d, "description", maxlen=300), did))
    except sqlite3.IntegrityError:
        raise ApiError("A department with this name already exists")
    audit("UPDATE", "department", did)
    return jsonify({"ok": True})


@app.delete("/api/departments/<int:did>")
@admin_required
def departments_delete(did):
    run("DELETE FROM departments WHERE id=?", (did,))
    audit("DELETE", "department", did)
    return jsonify({"ok": True})


def category_values(d):
    pr = text(d, "default_priority") or "NORMAL"
    if pr not in PRIORITIES:
        raise ApiError("Invalid priority")
    dep = d.get("department_id")
    dep = int(dep) if str(dep or "").isdigit() else None
    if dep and not one("SELECT id FROM departments WHERE id=?", (dep,)):
        raise ApiError("Unknown department")
    return (text(d, "name", True, 100), dep, pr)


@app.post("/api/categories")
@admin_required
def categories_create():
    try:
        cid = run("INSERT INTO categories(name,department_id,default_priority) VALUES(?,?,?)", category_values(body()))
    except sqlite3.IntegrityError:
        raise ApiError("A category with this name already exists")
    audit("CREATE", "category", cid)
    return jsonify({"id": cid}), 201


@app.put("/api/categories/<int:cid>")
@admin_required
def categories_update(cid):
    try:
        run("UPDATE categories SET name=?, department_id=?, default_priority=? WHERE id=?", category_values(body()) + (cid,))
    except sqlite3.IntegrityError:
        raise ApiError("A category with this name already exists")
    audit("UPDATE", "category", cid)
    return jsonify({"ok": True})


@app.delete("/api/categories/<int:cid>")
@admin_required
def categories_delete(cid):
    run("DELETE FROM categories WHERE id=?", (cid,))
    audit("DELETE", "category", cid)
    return jsonify({"ok": True})


# ----------------------------------------------------------------------------
# People: citizens and staff
# ----------------------------------------------------------------------------
@app.get("/api/citizens")
@reader_required
def citizens_list():
    return jsonify(rows("""SELECT id,name,username,phone,address,ward,family_members,active,created_at
                           FROM users WHERE role='citizen' ORDER BY id DESC"""))


@app.post("/api/citizens")
@admin_required
def citizens_create():
    data = body()
    username = clean_username(text(data, "username", True, 40))
    password = text(data, "password", True, 200)
    check_password_rules(password)
    if one("SELECT id FROM users WHERE username=?", (username,)):
        raise ApiError("Username already taken")
    rid = run("INSERT INTO users(name,username,password_hash,role,phone,address,ward,family_members) VALUES(?,?,?,?,?,?,?,?)",
              (text(data, "name", True, 100), username, generate_password_hash(password), "citizen",
               text(data, "phone", maxlen=20), text(data, "address", maxlen=200), text(data, "ward", maxlen=50),
               int(number(data, "family_members", 1, 1))))
    audit("CREATE", "citizen", rid)
    return jsonify({"id": rid}), 201


def update_person(uid, roles, data):
    if not one(f"SELECT id FROM users WHERE id=? AND role IN ({','.join('?' * len(roles))})", (uid, *roles)):
        raise ApiError("Person not found", 404)
    run("UPDATE users SET name=?, phone=?, address=?, ward=?, family_members=?, active=? WHERE id=?",
        (text(data, "name", True, 100), text(data, "phone", maxlen=20), text(data, "address", maxlen=200),
         text(data, "ward", maxlen=50), int(number(data, "family_members", 1, 1)),
         1 if data.get("active", 1) in (1, True, "1", "true") else 0, uid))
    pw = text(data, "password", maxlen=200)
    if pw:
        check_password_rules(pw)
        run("UPDATE users SET password_hash=? WHERE id=?", (generate_password_hash(pw), uid))


@app.put("/api/citizens/<int:uid>")
@admin_required
def citizens_update(uid):
    update_person(uid, ("citizen",), body())
    audit("UPDATE", "citizen", uid)
    return jsonify({"ok": True})


@app.delete("/api/citizens/<int:uid>")
@admin_required
def citizens_delete(uid):
    if not one("SELECT id FROM users WHERE id=? AND role='citizen'", (uid,)):
        raise ApiError("Citizen not found", 404)
    run("DELETE FROM users WHERE id=?", (uid,))
    audit("DELETE", "citizen", uid)
    return jsonify({"ok": True})


@app.get("/api/staff")
@reader_required
def staff_list():
    return jsonify(rows("""SELECT u.id,u.name,u.username,u.role,u.department_id,d.name department_name,u.phone,u.active,
                           (SELECT COUNT(*) FROM complaints c WHERE c.assigned_to=u.id AND c.status NOT IN ('RESOLVED','REJECTED','DUPLICATE','REFERRED_OUT')) workload
                           FROM users u LEFT JOIN departments d ON d.id=u.department_id
                           WHERE u.role IN ('field_worker','department_head','supervisor') ORDER BY u.role, u.name"""))


def staff_values(data, creating):
    role = text(data, "role", True)
    if role not in STAFF_ROLES:
        raise ApiError("Invalid staff role")
    dep = data.get("department_id")
    dep = int(dep) if str(dep or "").isdigit() else None
    if role in ("field_worker", "department_head") and not dep:
        raise ApiError("Department is required for this role")
    if dep and not one("SELECT id FROM departments WHERE id=?", (dep,)):
        raise ApiError("Unknown department")
    if role == "supervisor":
        dep = None
    return role, dep


@app.post("/api/staff")
@admin_required
def staff_create():
    data = body()
    role, dep = staff_values(data, True)
    username = clean_username(text(data, "username", True, 40))
    password = text(data, "password", True, 200)
    check_password_rules(password)
    if one("SELECT id FROM users WHERE username=?", (username,)):
        raise ApiError("Username already taken")
    sid = run("INSERT INTO users(name,username,password_hash,role,department_id,phone) VALUES(?,?,?,?,?,?)",
              (text(data, "name", True, 100), username, generate_password_hash(password), role, dep, text(data, "phone", maxlen=20)))
    audit("CREATE", "staff", sid, role)
    return jsonify({"id": sid}), 201


@app.put("/api/staff/<int:sid>")
@admin_required
def staff_update(sid):
    data = body()
    if not one("SELECT id FROM users WHERE id=? AND role IN ('field_worker','department_head','supervisor')", (sid,)):
        raise ApiError("Staff member not found", 404)
    role, dep = staff_values(data, False)
    run("UPDATE users SET name=?, phone=?, role=?, department_id=?, active=? WHERE id=?",
        (text(data, "name", True, 100), text(data, "phone", maxlen=20), role, dep,
         1 if data.get("active", 1) in (1, True, "1", "true") else 0, sid))
    pw = text(data, "password", maxlen=200)
    if pw:
        check_password_rules(pw)
        run("UPDATE users SET password_hash=? WHERE id=?", (generate_password_hash(pw), sid))
    audit("UPDATE", "staff", sid, role)
    return jsonify({"ok": True})


@app.delete("/api/staff/<int:sid>")
@admin_required
def staff_delete(sid):
    if not one("SELECT id FROM users WHERE id=? AND role IN ('field_worker','department_head','supervisor')", (sid,)):
        raise ApiError("Staff member not found", 404)
    run("DELETE FROM users WHERE id=?", (sid,))
    audit("DELETE", "staff", sid)
    return jsonify({"ok": True})


@app.get("/api/assignees")
@roles_required("admin", "department_head")
def assignees():
    """Workers a complaint can be assigned to."""
    if g.user["role"] == "department_head":
        return jsonify(rows("SELECT id,name,role,department_id FROM users WHERE active=1 AND department_id=? AND role='field_worker' ORDER BY name",
                            (g.user["department_id"],)))
    return jsonify(rows("SELECT id,name,role,department_id FROM users WHERE active=1 AND role='field_worker' ORDER BY name"))


# ----------------------------------------------------------------------------
# Complaints
# ----------------------------------------------------------------------------
COMPLAINT_SELECT = """
SELECT c.*, cat.name category, d.name department_name, u.name citizen_name, u.ward, u.phone citizen_phone,
       a.name assignee_name,
       CASE WHEN c.status NOT IN ('RESOLVED','REJECTED','DUPLICATE','REFERRED_OUT') AND c.sla_due!='' AND c.sla_due<? THEN 1 ELSE 0 END overdue
FROM complaints c
JOIN users u ON u.id=c.user_id
LEFT JOIN categories cat ON cat.id=c.category_id
LEFT JOIN departments d ON d.id=c.department_id
LEFT JOIN users a ON a.id=c.assigned_to
"""


def scope_clause():
    r, uid = g.user["role"], g.user["id"]
    if r in ("admin", "supervisor"):
        return "1=1", ()
    if r == "department_head":
        return "c.department_id=?", (g.user["department_id"],)
    if r == "field_worker":
        return "c.assigned_to=?", (uid,)
    return "c.user_id=?", (uid,)


def fetch_complaint(cid):
    c = one(COMPLAINT_SELECT + " WHERE c.id=?", (stamp(), cid))
    if not c:
        raise ApiError("Complaint not found", 404)
    sc, args = scope_clause()
    if not one(f"SELECT c.id FROM complaints c WHERE c.id=? AND {sc}", (cid, *args)):
        raise ApiError("Complaint not found", 404)
    return c


def next_statuses(c):
    r, uid = g.user["role"], g.user["id"]
    nxt = GRAPH.get(c["status"], ())
    if r == "admin":
        return list(nxt)
    if r == "supervisor":
        return ["REOPENED"] if c["status"] == "RESOLVED" else []
    if r == "department_head":
        return list(nxt) if c["department_id"] == g.user["department_id"] else []
    if r == "field_worker":
        return [s for s in nxt if c["assigned_to"] == uid and (c["status"], s) in WORKER_MOVES]
    if r == "citizen":
        return ["REOPENED"] if c["user_id"] == uid and c["status"] == "RESOLVED" else []
    return []


def can_assign():
    return g.user["role"] in ("admin", "department_head")


def decorate(c):
    c["next_statuses"] = next_statuses(c)
    c["can_assign"] = can_assign() and c["status"] not in ("RESOLVED", "REJECTED", "DUPLICATE", "REFERRED_OUT")
    return c


@app.get("/api/complaints")
@login_required
def complaints_list():
    sc, args = scope_clause()
    where, params = [sc], list(args)
    status = request.args.get("status", "")
    if status:
        if status == "OPEN":
            where.append("c.status NOT IN ('RESOLVED','REJECTED','DUPLICATE','REFERRED_OUT')")
        elif status in STATUSES:
            where.append("c.status=?")
            params.append(status)
    q = request.args.get("q", "").strip()[:60]
    if q:
        where.append("(c.title LIKE ? OR c.reference_code LIKE ? OR u.name LIKE ?)")
        params += [f"%{q}%"] * 3
    data = rows(COMPLAINT_SELECT + " WHERE " + " AND ".join(where) + " ORDER BY c.id DESC LIMIT 500", (stamp(), *params))
    return jsonify([decorate(c) for c in data])


@app.get("/api/complaints/<int:cid>")
@login_required
def complaints_detail(cid):
    c = decorate(fetch_complaint(cid))
    c["events"] = rows("""SELECT e.*, u.name actor_name, u.role actor_role FROM complaint_events e
                          LEFT JOIN users u ON u.id=e.actor_id WHERE e.complaint_id=? ORDER BY e.id""", (cid,))
    c["files"] = rows("SELECT id,original_name,mime FROM complaint_files WHERE complaint_id=?", (cid,))
    return jsonify(c)


IMG_SIGS = (("image/jpeg", b"\xff\xd8\xff", ".jpg"), ("image/png", b"\x89PNG\r\n\x1a\n", ".png"))


def sniff_image(head):
    for mime, sig, ext in IMG_SIGS:
        if head.startswith(sig):
            return mime, ext
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return "image/webp", ".webp"
    return None, None


@app.post("/api/complaints")
@roles_required("citizen")
def complaints_create():
    throttle("complaint", 20, 600)
    if request.mimetype == "multipart/form-data":
        data, files = request.form.to_dict(), request.files.getlist("photos")
    else:
        data, files = body(), []
    files = [f for f in files if f and f.filename]
    if len(files) > 4:
        raise ApiError("You can attach at most 4 photos")
    saved = []
    for f in files:
        blob = f.read(5 * 1024 * 1024 + 1)
        if len(blob) > 5 * 1024 * 1024:
            raise ApiError(f"{f.filename} is larger than 5 MB")
        mime, ext = sniff_image(blob[:16])
        if not mime:
            raise ApiError(f"{f.filename} is not a JPG, PNG or WebP image")
        saved.append((blob, mime, ext, os.path.basename(f.filename)[:120]))

    cat_id = data.get("category_id")
    if not str(cat_id or "").isdigit() or not one("SELECT id FROM categories WHERE id=?", (int(cat_id),)):
        raise ApiError("Please choose a category")
    cat = one("SELECT * FROM categories WHERE id=?", (int(cat_id),))
    pr = text(data, "priority") or cat["default_priority"]
    if pr not in PRIORITIES:
        raise ApiError("Invalid priority")
    conn = db()
    cid = insert_complaint(conn, g.user["id"], cat["id"], text(data, "title", True, 150),
                           text(data, "description", True, 2000), text(data, "location", maxlen=200), pr)
    for blob, mime, ext, orig in saved:
        name = secrets.token_hex(16) + ext
        with open(os.path.join(UPLOAD_DIR, name), "wb") as fh:
            fh.write(blob)
        conn.execute("INSERT INTO complaint_files(complaint_id,stored_name,original_name,mime) VALUES(?,?,?,?)", (cid, name, orig, mime))
    conn.commit()
    ref = one("SELECT reference_code FROM complaints WHERE id=?", (cid,))["reference_code"]
    return jsonify({"id": cid, "reference_code": ref}), 201


@app.get("/api/files/<int:fid>")
@login_required
def complaint_file(fid):
    f = one("SELECT * FROM complaint_files WHERE id=?", (fid,))
    if not f:
        raise ApiError("File not found", 404)
    fetch_complaint(f["complaint_id"])  # enforces scope
    resp = send_from_directory(UPLOAD_DIR, f["stored_name"], mimetype=f["mime"])
    resp.headers["Cache-Control"] = "private, max-age=3600"
    return resp


def change_status(c, new, note, actor_desc=None):
    now_ = stamp()
    resolved = now_ if new == "RESOLVED" else ("" if new == "REOPENED" else c["resolved_at"])
    sla = c["sla_due"]
    if new == "REOPENED":
        sla = sla_due_for(c["priority"])
    db().execute("UPDATE complaints SET status=?, resolved_at=?, sla_due=?, updated_at=? WHERE id=?", (new, resolved, sla, now_, c["id"]))
    add_event(db(), c["id"], g.user["id"], "STATUS_CHANGE", c["status"], new, note or actor_desc or "", now_)
    db().commit()


@app.post("/api/complaints/<int:cid>/transition")
@login_required
def complaints_transition(cid):
    c = fetch_complaint(cid)
    d = body()
    new = text(d, "status", True)
    note = text(d, "note", maxlen=1000)
    if new not in next_statuses(c):
        raise ApiError(f"You cannot move this complaint from {c['status']} to {new}", 403)
    if new in ("REJECTED", "DUPLICATE", "REFERRED_OUT", "WAITING_FOR_INFORMATION", "REOPENED") and not note:
        raise ApiError("Please add a short note explaining this change")
    if new == "ASSIGNED" and not c["assigned_to"]:
        raise ApiError("Assign a worker first")
    change_status(c, new, note)
    audit("COMPLAINT_" + new, "complaint", cid)
    return jsonify({"ok": True})


@app.post("/api/complaints/<int:cid>/assign")
@roles_required("admin", "department_head")
def complaints_assign(cid):
    c = fetch_complaint(cid)
    if c["status"] in TERMINAL:
        raise ApiError("This complaint is closed")
    d = body()
    dep = d.get("department_id")
    dep = int(dep) if str(dep or "").isdigit() else c["department_id"]
    if g.user["role"] == "department_head":
        dep = g.user["department_id"]
    if not dep or not one("SELECT id FROM departments WHERE id=?", (dep,)):
        raise ApiError("Choose a department")
    wid = d.get("assigned_to")
    worker = None
    if str(wid or "").isdigit():
        worker = one("SELECT id,name FROM users WHERE id=? AND role='field_worker' AND active=1 AND department_id=?", (int(wid), dep))
        if not worker:
            raise ApiError("That worker does not belong to the chosen department")
    old = c["status"]
    new = old
    if worker and old in ("SUBMITTED", "UNDER_REVIEW", "REOPENED", "WAITING_FOR_INFORMATION"):
        new = "ASSIGNED"
    elif not worker and old == "SUBMITTED":
        new = "UNDER_REVIEW"
    desc = f"Assigned to {worker['name']}" if worker else "Routed to department"
    note = text(d, "note", maxlen=500)
    if note:
        desc += f" - {note}"
    db().execute("UPDATE complaints SET department_id=?, assigned_to=?, status=?, updated_at=? WHERE id=?",
                 (dep, worker["id"] if worker else None, new, stamp(), cid))
    add_event(db(), cid, g.user["id"], "ASSIGNED" if worker else "ROUTED", old, new, desc)
    db().commit()
    audit("COMPLAINT_ASSIGN", "complaint", cid, desc)
    return jsonify({"ok": True})


@app.post("/api/complaints/<int:cid>/comment")
@login_required
def complaints_comment(cid):
    c = fetch_complaint(cid)
    note = text(body(), "note", True, 1000)
    old = c["status"]
    new = old
    if g.user["role"] == "citizen" and old == "WAITING_FOR_INFORMATION":
        new = "UNDER_REVIEW"
        db().execute("UPDATE complaints SET status=?, updated_at=? WHERE id=?", (new, stamp(), cid))
    add_event(db(), cid, g.user["id"], "COMMENT", old, new, note)
    db().commit()
    return jsonify({"ok": True}), 201


@app.post("/api/complaints/<int:cid>/feedback")
@roles_required("citizen")
def complaints_feedback(cid):
    c = fetch_complaint(cid)
    if c["status"] != "RESOLVED":
        raise ApiError("Feedback can be given once the complaint is resolved")
    d = body()
    rating = int(number(d, "rating", 0, 1))
    if rating > 5:
        raise ApiError("Rating must be between 1 and 5")
    run("UPDATE complaints SET rating=?, feedback=? WHERE id=?", (rating, text(d, "feedback", maxlen=1000), cid))
    add_event(db(), cid, g.user["id"], "FEEDBACK", c["status"], c["status"], f"Rated {rating}/5")
    db().commit()
    return jsonify({"ok": True})


@app.delete("/api/complaints/<int:cid>")
@admin_required
def complaints_delete(cid):
    fetch_complaint(cid)
    for f in rows("SELECT stored_name FROM complaint_files WHERE complaint_id=?", (cid,)):
        try:
            os.remove(os.path.join(UPLOAD_DIR, f["stored_name"]))
        except OSError:
            pass
    run("DELETE FROM complaints WHERE id=?", (cid,))
    audit("DELETE", "complaint", cid)
    return jsonify({"ok": True})


# ----------------------------------------------------------------------------
# Dashboard
# ----------------------------------------------------------------------------
OPEN_SQL = "status NOT IN ('RESOLVED','REJECTED','DUPLICATE','REFERRED_OUT')"


@app.get("/api/dashboard")
@login_required
def dashboard():
    today = date.today().isoformat()
    now_ = stamp()
    role, uid = g.user["role"], g.user["id"]
    out = {"events": rows("SELECT * FROM events WHERE event_date>=? ORDER BY event_date LIMIT 5", (today,)),
           "notices": rows("SELECT * FROM notices ORDER BY id DESC LIMIT 5")}
    if role in ("admin", "supervisor"):
        out["stats"] = {
            "citizens": one("SELECT COUNT(*) c FROM users WHERE role='citizen' AND active=1")["c"],
            "population": one("SELECT COALESCE(SUM(family_members),0) c FROM users WHERE role='citizen' AND active=1")["c"],
            "complaints_total": one("SELECT COUNT(*) c FROM complaints")["c"],
            "complaints_open": one(f"SELECT COUNT(*) c FROM complaints WHERE {OPEN_SQL}")["c"],
            "overdue": one(f"SELECT COUNT(*) c FROM complaints WHERE {OPEN_SQL} AND sla_due!='' AND sla_due<?", (now_,))["c"],
            "resolved": one("SELECT COUNT(*) c FROM complaints WHERE status='RESOLVED'")["c"],
            "avg_rating": round(one("SELECT COALESCE(AVG(rating),0) c FROM complaints WHERE rating>0")["c"], 1),
            "collected": one("SELECT COALESCE(SUM(amount),0) c FROM bills WHERE status='Paid'")["c"],
            "pending_amount": one("SELECT COALESCE(SUM(amount),0) c FROM bills WHERE status='Unpaid'")["c"],
            "applications_pending": one("SELECT COUNT(*) c FROM applications WHERE status='Pending'")["c"],
            "projects_active": one("SELECT COUNT(*) c FROM projects WHERE status='In Progress'")["c"],
            "staff": one("SELECT COUNT(*) c FROM users WHERE role IN ('field_worker','department_head','supervisor') AND active=1")["c"],
        }
        out["charts"] = {
            "by_status": rows("SELECT status label, COUNT(*) value FROM complaints GROUP BY status"),
            "by_department": rows("SELECT COALESCE(d.name,'Unrouted') label, COUNT(*) value FROM complaints c LEFT JOIN departments d ON d.id=c.department_id GROUP BY label ORDER BY value DESC"),
            "by_category": rows("SELECT COALESCE(cat.name,'Other') label, COUNT(*) value FROM complaints c LEFT JOIN categories cat ON cat.id=c.category_id GROUP BY label ORDER BY value DESC"),
            "bills_by_type": rows("SELECT bill_type label, COALESCE(SUM(CASE WHEN status='Paid' THEN amount END),0) paid, COALESCE(SUM(CASE WHEN status='Unpaid' THEN amount END),0) unpaid FROM bills GROUP BY bill_type"),
        }
    elif role == "department_head":
        dep = g.user["department_id"]
        out["stats"] = {
            "dept_total": one("SELECT COUNT(*) c FROM complaints WHERE department_id=?", (dep,))["c"],
            "dept_open": one(f"SELECT COUNT(*) c FROM complaints WHERE department_id=? AND {OPEN_SQL}", (dep,))["c"],
            "dept_unassigned": one("SELECT COUNT(*) c FROM complaints WHERE department_id=? AND assigned_to IS NULL AND status NOT IN ('RESOLVED','REJECTED','DUPLICATE','REFERRED_OUT')", (dep,))["c"],
            "overdue": one(f"SELECT COUNT(*) c FROM complaints WHERE department_id=? AND {OPEN_SQL} AND sla_due!='' AND sla_due<?", (dep, now_))["c"],
            "resolved": one("SELECT COUNT(*) c FROM complaints WHERE department_id=? AND status='RESOLVED'", (dep,))["c"],
            "team": one("SELECT COUNT(*) c FROM users WHERE department_id=? AND role='field_worker' AND active=1", (dep,))["c"],
        }
        out["charts"] = {"by_status": rows("SELECT status label, COUNT(*) value FROM complaints WHERE department_id=? GROUP BY status", (dep,))}
    elif role == "field_worker":
        out["stats"] = {
            "assigned_open": one(f"SELECT COUNT(*) c FROM complaints WHERE assigned_to=? AND {OPEN_SQL}", (uid,))["c"],
            "in_progress": one("SELECT COUNT(*) c FROM complaints WHERE assigned_to=? AND status='IN_PROGRESS'", (uid,))["c"],
            "overdue": one(f"SELECT COUNT(*) c FROM complaints WHERE assigned_to=? AND {OPEN_SQL} AND sla_due!='' AND sla_due<?", (uid, now_))["c"],
            "resolved": one("SELECT COUNT(*) c FROM complaints WHERE assigned_to=? AND status='RESOLVED'", (uid,))["c"],
        }
        out["charts"] = {"by_status": rows("SELECT status label, COUNT(*) value FROM complaints WHERE assigned_to=? GROUP BY status", (uid,))}
    else:
        out["stats"] = {
            "my_open": one(f"SELECT COUNT(*) c FROM complaints WHERE user_id=? AND {OPEN_SQL}", (uid,))["c"],
            "my_total": one("SELECT COUNT(*) c FROM complaints WHERE user_id=?", (uid,))["c"],
            "dues": one("SELECT COALESCE(SUM(amount),0) c FROM bills WHERE user_id=? AND status='Unpaid'", (uid,))["c"],
            "paid": one("SELECT COALESCE(SUM(amount),0) c FROM bills WHERE user_id=? AND status='Paid'", (uid,))["c"],
            "my_applications": one("SELECT COUNT(*) c FROM applications WHERE user_id=?", (uid,))["c"],
            "open_schemes": one("SELECT COUNT(*) c FROM schemes WHERE last_date='' OR last_date>=?", (today,))["c"],
        }
        out["charts"] = {"by_status": rows("SELECT status label, COUNT(*) value FROM complaints WHERE user_id=? GROUP BY status", (uid,))}
    return jsonify(out)


# ----------------------------------------------------------------------------
# Notices / Projects (admin-managed, everyone reads)
# ----------------------------------------------------------------------------
@app.get("/api/notices")
@login_required
def notices_list():
    return jsonify(rows("SELECT * FROM notices ORDER BY id DESC"))


@app.post("/api/notices")
@admin_required
def notices_create():
    d = body()
    nid = run("INSERT INTO notices(title,content,category,created_at) VALUES(?,?,?,?)",
              (text(d, "title", True, 150), text(d, "content", True, 3000), text(d, "category", maxlen=50) or "General", stamp()))
    audit("CREATE", "notice", nid)
    return jsonify({"id": nid}), 201


@app.put("/api/notices/<int:nid>")
@admin_required
def notices_update(nid):
    d = body()
    run("UPDATE notices SET title=?, content=?, category=? WHERE id=?",
        (text(d, "title", True, 150), text(d, "content", True, 3000), text(d, "category", maxlen=50) or "General", nid))
    audit("UPDATE", "notice", nid)
    return jsonify({"ok": True})


@app.delete("/api/notices/<int:nid>")
@admin_required
def notices_delete(nid):
    run("DELETE FROM notices WHERE id=?", (nid,))
    audit("DELETE", "notice", nid)
    return jsonify({"ok": True})


PROJECT_STATUS = ("Planned", "In Progress", "Completed", "On Hold")


def project_values(d):
    status = text(d, "status") or "Planned"
    if status not in PROJECT_STATUS:
        raise ApiError("Invalid status")
    progress = int(number(d, "progress", 0, 0))
    if progress > 100:
        raise ApiError("Progress cannot exceed 100")
    return (text(d, "title", True, 150), text(d, "description", maxlen=2000), number(d, "budget"), number(d, "spent"),
            progress, status, text(d, "start_date", maxlen=10), text(d, "end_date", maxlen=10))


@app.get("/api/projects")
@login_required
def projects_list():
    return jsonify(rows("SELECT * FROM projects ORDER BY id DESC"))


@app.post("/api/projects")
@admin_required
def projects_create():
    pid = run("INSERT INTO projects(title,description,budget,spent,progress,status,start_date,end_date) VALUES(?,?,?,?,?,?,?,?)", project_values(body()))
    audit("CREATE", "project", pid)
    return jsonify({"id": pid}), 201


@app.put("/api/projects/<int:pid>")
@admin_required
def projects_update(pid):
    run("UPDATE projects SET title=?,description=?,budget=?,spent=?,progress=?,status=?,start_date=?,end_date=? WHERE id=?", project_values(body()) + (pid,))
    audit("UPDATE", "project", pid)
    return jsonify({"ok": True})


@app.delete("/api/projects/<int:pid>")
@admin_required
def projects_delete(pid):
    run("DELETE FROM projects WHERE id=?", (pid,))
    audit("DELETE", "project", pid)
    return jsonify({"ok": True})


# ----------------------------------------------------------------------------
# Schemes & applications
# ----------------------------------------------------------------------------
@app.get("/api/schemes")
@login_required
def schemes_list():
    data = rows("SELECT s.*, (SELECT COUNT(*) FROM applications a WHERE a.scheme_id=s.id) applicants FROM schemes s ORDER BY s.id DESC")
    mine = {r["scheme_id"]: r["status"] for r in rows("SELECT scheme_id,status FROM applications WHERE user_id=?", (g.user["id"],))}
    for s in data:
        s["my_status"] = mine.get(s["id"], "")
    return jsonify(data)


def scheme_values(d):
    return (text(d, "name", True, 150), text(d, "description", maxlen=2000), text(d, "eligibility", maxlen=500),
            text(d, "benefit", maxlen=500), text(d, "last_date", maxlen=10))


@app.post("/api/schemes")
@admin_required
def schemes_create():
    sid = run("INSERT INTO schemes(name,description,eligibility,benefit,last_date) VALUES(?,?,?,?,?)", scheme_values(body()))
    audit("CREATE", "scheme", sid)
    return jsonify({"id": sid}), 201


@app.put("/api/schemes/<int:sid>")
@admin_required
def schemes_update(sid):
    run("UPDATE schemes SET name=?,description=?,eligibility=?,benefit=?,last_date=? WHERE id=?", scheme_values(body()) + (sid,))
    audit("UPDATE", "scheme", sid)
    return jsonify({"ok": True})


@app.delete("/api/schemes/<int:sid>")
@admin_required
def schemes_delete(sid):
    run("DELETE FROM schemes WHERE id=?", (sid,))
    audit("DELETE", "scheme", sid)
    return jsonify({"ok": True})


@app.post("/api/schemes/<int:sid>/apply")
@roles_required("citizen")
def schemes_apply(sid):
    s = one("SELECT * FROM schemes WHERE id=?", (sid,))
    if not s:
        raise ApiError("Scheme not found", 404)
    if s["last_date"] and s["last_date"] < date.today().isoformat():
        raise ApiError("Last date for this scheme has passed")
    if one("SELECT id FROM applications WHERE scheme_id=? AND user_id=?", (sid, g.user["id"])):
        raise ApiError("You have already applied for this scheme")
    run("INSERT INTO applications(scheme_id,user_id,applied_at) VALUES(?,?,?)", (sid, g.user["id"], stamp()))
    return jsonify({"ok": True}), 201


@app.get("/api/applications")
@roles_required("admin", "supervisor", "citizen")
def applications_list():
    sql = """SELECT a.*, s.name scheme_name, u.name resident_name, u.ward
             FROM applications a JOIN schemes s ON s.id=a.scheme_id JOIN users u ON u.id=a.user_id"""
    if g.user["role"] == "citizen":
        return jsonify(rows(sql + " WHERE a.user_id=? ORDER BY a.id DESC", (g.user["id"],)))
    return jsonify(rows(sql + " ORDER BY a.id DESC"))


@app.put("/api/applications/<int:aid>")
@admin_required
def applications_update(aid):
    d = body()
    status = text(d, "status", True)
    if status not in ("Pending", "Approved", "Rejected"):
        raise ApiError("Invalid status")
    run("UPDATE applications SET status=?, remarks=? WHERE id=?", (status, text(d, "remarks", maxlen=500), aid))
    audit("APPLICATION_" + status.upper(), "application", aid)
    return jsonify({"ok": True})


# ----------------------------------------------------------------------------
# Bills
# ----------------------------------------------------------------------------
@app.get("/api/bills")
@roles_required("admin", "supervisor", "citizen")
def bills_list():
    sql = "SELECT b.*, u.name resident_name, u.ward FROM bills b JOIN users u ON u.id=b.user_id"
    if g.user["role"] == "citizen":
        return jsonify(rows(sql + " WHERE b.user_id=? ORDER BY b.id DESC", (g.user["id"],)))
    return jsonify(rows(sql + " ORDER BY b.id DESC"))


@app.post("/api/bills")
@admin_required
def bills_create():
    d = body()
    amount = number(d, "amount")
    if amount <= 0:
        raise ApiError("Amount must be greater than zero")
    btype = text(d, "bill_type", True, 50)
    desc, due = text(d, "description", maxlen=200), text(d, "due_date", maxlen=10)
    target = str(d.get("user_id", "")).strip()
    if target == "all":
        ids = [r["id"] for r in rows("SELECT id FROM users WHERE role='citizen' AND active=1")]
    elif target.isdigit() and one("SELECT id FROM users WHERE id=? AND role='citizen'", (int(target),)):
        ids = [int(target)]
    else:
        raise ApiError("Select a citizen or 'All citizens'")
    for uid in ids:
        db().execute("INSERT INTO bills(user_id,bill_type,description,amount,due_date) VALUES(?,?,?,?,?)", (uid, btype, desc, amount, due))
    db().commit()
    audit("CREATE", "bills", None, f"{btype} x{len(ids)}")
    return jsonify({"created": len(ids)}), 201


@app.post("/api/bills/<int:bid>/pay")
@roles_required("admin", "citizen")
def bills_pay(bid):
    b = one("SELECT * FROM bills WHERE id=?", (bid,))
    if not b:
        raise ApiError("Bill not found", 404)
    if g.user["role"] != "admin" and b["user_id"] != g.user["id"]:
        raise ApiError("Bill not found", 404)
    if b["status"] == "Paid":
        raise ApiError("Bill is already paid")
    ref = "PAY-" + datetime.now().strftime("%y%m%d%H%M%S") + str(bid)
    run("UPDATE bills SET status='Paid', paid_on=?, payment_ref=? WHERE id=?", (date.today().isoformat(), ref, bid))
    audit("BILL_PAID", "bill", bid, ref)
    return jsonify({"payment_ref": ref})


@app.delete("/api/bills/<int:bid>")
@admin_required
def bills_delete(bid):
    run("DELETE FROM bills WHERE id=?", (bid,))
    audit("DELETE", "bill", bid)
    return jsonify({"ok": True})


# ----------------------------------------------------------------------------
# Events
# ----------------------------------------------------------------------------
@app.get("/api/events")
@login_required
def events_list():
    data = rows("SELECT e.*, (SELECT COUNT(*) FROM event_regs r WHERE r.event_id=e.id) registrations FROM events e ORDER BY e.event_date DESC")
    mine = {r["event_id"] for r in rows("SELECT event_id FROM event_regs WHERE user_id=?", (g.user["id"],))}
    for e in data:
        e["registered"] = e["id"] in mine
    return jsonify(data)


def event_values(d):
    return (text(d, "title", True, 150), text(d, "description", maxlen=2000), text(d, "venue", maxlen=150), text(d, "event_date", True, 10))


@app.post("/api/events")
@admin_required
def events_create():
    eid = run("INSERT INTO events(title,description,venue,event_date) VALUES(?,?,?,?)", event_values(body()))
    audit("CREATE", "event", eid)
    return jsonify({"id": eid}), 201


@app.put("/api/events/<int:eid>")
@admin_required
def events_update(eid):
    run("UPDATE events SET title=?,description=?,venue=?,event_date=? WHERE id=?", event_values(body()) + (eid,))
    audit("UPDATE", "event", eid)
    return jsonify({"ok": True})


@app.delete("/api/events/<int:eid>")
@admin_required
def events_delete(eid):
    run("DELETE FROM events WHERE id=?", (eid,))
    audit("DELETE", "event", eid)
    return jsonify({"ok": True})


@app.post("/api/events/<int:eid>/register")
@roles_required("citizen")
def events_register(eid):
    if not one("SELECT id FROM events WHERE id=?", (eid,)):
        raise ApiError("Event not found", 404)
    if one("SELECT id FROM event_regs WHERE event_id=? AND user_id=?", (eid, g.user["id"])):
        run("DELETE FROM event_regs WHERE event_id=? AND user_id=?", (eid, g.user["id"]))
        return jsonify({"registered": False})
    run("INSERT INTO event_regs(event_id,user_id) VALUES(?,?)", (eid, g.user["id"]))
    return jsonify({"registered": True})


# ----------------------------------------------------------------------------
# Reports, audit log, contact inbox
# ----------------------------------------------------------------------------
@app.get("/api/reports/summary")
@reader_required
def report_summary():
    now_ = stamp()
    return jsonify({
        "by_ward": rows("SELECT ward, COUNT(*) citizens, COALESCE(SUM(family_members),0) population FROM users WHERE role='citizen' AND active=1 GROUP BY ward ORDER BY ward"),
        "revenue": rows("""SELECT bill_type, COUNT(*) bills, COALESCE(SUM(amount),0) total,
                           COALESCE(SUM(CASE WHEN status='Paid' THEN amount END),0) collected,
                           COALESCE(SUM(CASE WHEN status='Unpaid' THEN amount END),0) pending
                           FROM bills GROUP BY bill_type"""),
        "departments": rows("""SELECT COALESCE(d.name,'Unrouted') department, COUNT(*) total,
                               SUM(CASE WHEN c.status='RESOLVED' THEN 1 ELSE 0 END) resolved,
                               SUM(CASE WHEN c.status NOT IN ('RESOLVED','REJECTED','DUPLICATE','REFERRED_OUT') AND c.sla_due!='' AND c.sla_due<? THEN 1 ELSE 0 END) overdue,
                               ROUND(COALESCE(AVG(CASE WHEN c.rating>0 THEN c.rating END),0),1) avg_rating
                               FROM complaints c LEFT JOIN departments d ON d.id=c.department_id GROUP BY department""", (now_,)),
        "resolution_hours": round(one("""SELECT COALESCE(AVG((julianday(resolved_at)-julianday(created_at))*24),0) h
                                         FROM complaints WHERE resolved_at!=''""")["h"], 1),
        "projects": one("SELECT COUNT(*) total, COALESCE(SUM(budget),0) budget, COALESCE(SUM(spent),0) spent, COALESCE(AVG(progress),0) avg_progress FROM projects"),
        "overdue_bills": rows("""SELECT b.id, u.name resident_name, b.bill_type, b.amount, b.due_date
                                 FROM bills b JOIN users u ON u.id=b.user_id
                                 WHERE b.status='Unpaid' AND b.due_date!='' AND b.due_date<? ORDER BY b.due_date""", (date.today().isoformat(),)),
    })


EXPORTS = {
    "citizens": "SELECT id,name,username,phone,address,ward,family_members,active,created_at FROM users WHERE role='citizen'",
    "complaints": """SELECT c.reference_code,u.name citizen,cat.name category,d.name department,a.name assigned_to,c.title,c.priority,c.status,c.sla_due,c.resolved_at,c.rating,c.created_at
                     FROM complaints c JOIN users u ON u.id=c.user_id LEFT JOIN categories cat ON cat.id=c.category_id
                     LEFT JOIN departments d ON d.id=c.department_id LEFT JOIN users a ON a.id=c.assigned_to""",
    "bills": "SELECT b.id,u.name citizen,b.bill_type,b.description,b.amount,b.due_date,b.status,b.paid_on,b.payment_ref FROM bills b JOIN users u ON u.id=b.user_id",
    "applications": "SELECT a.id,s.name scheme,u.name citizen,a.status,a.remarks,a.applied_at FROM applications a JOIN schemes s ON s.id=a.scheme_id JOIN users u ON u.id=a.user_id",
    "projects": "SELECT id,title,budget,spent,progress,status,start_date,end_date FROM projects",
}


@app.get("/api/reports/export/<name>")
@reader_required
def report_export(name):
    if name not in EXPORTS:
        raise ApiError("Unknown report", 404)
    data = rows(EXPORTS[name])
    buf = io.StringIO()
    if data:
        w = csv.DictWriter(buf, fieldnames=list(data[0].keys()))
        w.writeheader()
        for r in data:  # neutralise spreadsheet formula injection
            w.writerow({k: ("'" + v if isinstance(v, str) and v[:1] in ("=", "+", "-", "@") else v) for k, v in r.items()})
    audit("EXPORT", "report", None, name)
    return Response(buf.getvalue(), mimetype="text/csv",
                    headers={"Content-Disposition": f"attachment; filename={name}_{date.today().isoformat()}.csv"})


@app.get("/api/audit")
@admin_required
def audit_list():
    return jsonify(rows("SELECT * FROM audit_logs ORDER BY id DESC LIMIT 300"))


@app.get("/api/messages")
@admin_required
def messages_list():
    return jsonify(rows("SELECT * FROM contact_messages ORDER BY id DESC LIMIT 200"))


@app.delete("/api/messages/<int:mid>")
@admin_required
def messages_delete(mid):
    run("DELETE FROM contact_messages WHERE id=?", (mid,))
    return jsonify({"ok": True})


# ----------------------------------------------------------------------------
# Frontend (static)
# ----------------------------------------------------------------------------
@app.get("/")
def index():
    return send_from_directory(FRONT_DIR, "index.html")


@app.get("/<path:path>")
def static_files(path):
    if path.startswith("api/"):
        raise ApiError("Not found", 404)
    return send_from_directory(FRONT_DIR, path)


init_db()

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    print(f"\n  Smart Village Management System running at http://127.0.0.1:{port}\n")
    app.run(host="127.0.0.1", port=port, debug=False)
