import math
import shutil
import sqlite3
from pathlib import Path
from datetime import datetime, timezone, date


def _ceil15(seconds: float) -> float:
    """Round duration up to the nearest 15-minute boundary (900 s)."""
    return math.ceil(seconds / 900) * 900

DB_PATH = Path(__file__).parent / "data" / "timetracking.db"


def get_conn():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db():
    with get_conn() as conn:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS tasks (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                name       TEXT    NOT NULL UNIQUE,
                created_at TEXT    NOT NULL,
                active     INTEGER NOT NULL DEFAULT 1
            );

            CREATE TABLE IF NOT EXISTS time_entries (
                id               INTEGER PRIMARY KEY AUTOINCREMENT,
                task_id          INTEGER NOT NULL REFERENCES tasks(id),
                task_name        TEXT    NOT NULL,
                started_at       TEXT    NOT NULL,
                ended_at         TEXT,
                duration_seconds REAL,
                date             TEXT    NOT NULL
            );

            CREATE TABLE IF NOT EXISTS active_timer (
                id         INTEGER PRIMARY KEY CHECK (id = 1),
                task_id    INTEGER NOT NULL REFERENCES tasks(id),
                task_name  TEXT    NOT NULL,
                started_at TEXT    NOT NULL
            );
        """)
        # Migration: add pause columns for existing databases
        for stmt in [
            "ALTER TABLE active_timer ADD COLUMN paused_at TEXT",
            "ALTER TABLE active_timer ADD COLUMN paused_seconds REAL NOT NULL DEFAULT 0",
        ]:
            try:
                conn.execute(stmt)
            except sqlite3.OperationalError:
                pass  # column already exists


# ── Tasks ──────────────────────────────────────────────────────────────────

def get_all_tasks():
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT id, name, created_at, active FROM tasks ORDER BY name"
        ).fetchall()
    return [dict(r) for r in rows]


def add_task(name: str):
    now = datetime.now(timezone.utc).isoformat()
    with get_conn() as conn:
        try:
            conn.execute(
                "INSERT INTO tasks (name, created_at) VALUES (?, ?)", (name, now)
            )
        except sqlite3.IntegrityError:
            return None, "duplicate"
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM tasks WHERE name = ?", (name,)).fetchone()
    return dict(row), None


def rename_task(task_id: int, new_name: str):
    with get_conn() as conn:
        try:
            conn.execute("UPDATE tasks SET name = ? WHERE id = ?", (new_name, task_id))
        except sqlite3.IntegrityError:
            return False, "duplicate"
        conn.execute("UPDATE time_entries SET task_name = ? WHERE task_id = ?", (new_name, task_id))
        conn.execute("UPDATE active_timer SET task_name = ? WHERE task_id = ?", (new_name, task_id))
    return True, None


def disable_task(task_id: int):
    with get_conn() as conn:
        conn.execute("UPDATE tasks SET active = 0 WHERE id = ?", (task_id,))


def delete_task(task_id: int):
    with get_conn() as conn:
        count = conn.execute(
            "SELECT COUNT(*) FROM time_entries WHERE task_id = ?", (task_id,)
        ).fetchone()[0]
        if count > 0:
            return False, "has_entries"
        conn.execute("DELETE FROM tasks WHERE id = ?", (task_id,))
    return True, None


# ── Timer ──────────────────────────────────────────────────────────────────

def get_active_timer():
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM active_timer WHERE id = 1").fetchone()
    return dict(row) if row else None


def start_timer(task_id: int):
    with get_conn() as conn:
        existing = conn.execute("SELECT id FROM active_timer WHERE id = 1").fetchone()
        if existing:
            return False, "already_running"
        task = conn.execute(
            "SELECT id, name FROM tasks WHERE id = ? AND active = 1", (task_id,)
        ).fetchone()
        if not task:
            return False, "task_not_found"
        now = datetime.now(timezone.utc).isoformat()
        conn.execute(
            "INSERT INTO active_timer (id, task_id, task_name, started_at) VALUES (1, ?, ?, ?)",
            (task["id"], task["name"], now),
        )
    return True, None


def pause_timer():
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM active_timer WHERE id = 1").fetchone()
        if not row:
            return False, "not_running"
        if row["paused_at"]:
            return False, "already_paused"
        now = datetime.now(timezone.utc).isoformat()
        conn.execute("UPDATE active_timer SET paused_at = ? WHERE id = 1", (now,))
    return True, None


def resume_timer():
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM active_timer WHERE id = 1").fetchone()
        if not row:
            return False, "not_running"
        if not row["paused_at"]:
            return False, "not_paused"
        paused_since = datetime.fromisoformat(row["paused_at"])
        added = (datetime.now(timezone.utc) - paused_since).total_seconds()
        new_paused = (row["paused_seconds"] or 0) + added
        conn.execute(
            "UPDATE active_timer SET paused_at = NULL, paused_seconds = ? WHERE id = 1",
            (new_paused,),
        )
    return True, None


def stop_timer():
    with get_conn() as conn:
        timer = conn.execute("SELECT * FROM active_timer WHERE id = 1").fetchone()
        if not timer:
            return None, "not_running"
        timer = dict(timer)
        now_utc = datetime.now(timezone.utc)
        started = datetime.fromisoformat(timer["started_at"])
        paused_secs = timer.get("paused_seconds") or 0
        if timer.get("paused_at"):
            paused_since = datetime.fromisoformat(timer["paused_at"])
            paused_secs += (now_utc - paused_since).total_seconds()
        duration = _ceil15((now_utc - started).total_seconds() - paused_secs)
        local_date = date.today().isoformat()
        conn.execute(
            """INSERT INTO time_entries
               (task_id, task_name, started_at, ended_at, duration_seconds, date)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (
                timer["task_id"],
                timer["task_name"],
                timer["started_at"],
                now_utc.isoformat(),
                duration,
                local_date,
            ),
        )
        conn.execute("DELETE FROM active_timer WHERE id = 1")
    return timer, None


# ── Manual entries ─────────────────────────────────────────────────────────

def add_manual_entry(task_id: int, entry_date: str, started_at: str, ended_at: str):
    """started_at / ended_at are 'YYYY-MM-DDTHH:MM' local-time strings."""
    with get_conn() as conn:
        task = conn.execute(
            "SELECT name FROM tasks WHERE id = ?", (task_id,)
        ).fetchone()
        if not task:
            return None, "task_not_found"
        start_dt = datetime.fromisoformat(started_at)
        end_dt = datetime.fromisoformat(ended_at)
        if end_dt <= start_dt:
            return None, "invalid_range"
        duration = _ceil15((end_dt - start_dt).total_seconds())
        conn.execute(
            """INSERT INTO time_entries
               (task_id, task_name, started_at, ended_at, duration_seconds, date)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (task_id, task["name"], started_at, ended_at, duration, entry_date),
        )
    return {"duration_seconds": duration}, None


def get_recent_entries(limit: int = 50):
    with get_conn() as conn:
        rows = conn.execute(
            """SELECT id, task_name, date, started_at, ended_at, duration_seconds
               FROM time_entries
               ORDER BY date DESC, started_at DESC
               LIMIT ?""",
            (limit,),
        ).fetchall()
    return [dict(r) for r in rows]


def delete_entry(entry_id: int):
    with get_conn() as conn:
        conn.execute("DELETE FROM time_entries WHERE id = ?", (entry_id,))


def recover_active_timer():
    """Called once at startup. If a timer was running when the app was killed,
    remove it from active_timer and return the timer dict (with suggested_end)
    so the UI can ask the user what to do. Does NOT auto-save an entry.
    Returns None if nothing to recover."""
    with get_conn() as conn:
        timer = conn.execute("SELECT * FROM active_timer WHERE id = 1").fetchone()
        if not timer:
            return None
        timer = dict(timer)
        now_utc = datetime.now(timezone.utc)
        started = datetime.fromisoformat(timer["started_at"])
        duration = _ceil15((now_utc - started).total_seconds())
        if duration <= 0:
            conn.execute("DELETE FROM active_timer WHERE id = 1")
            return None
        conn.execute("DELETE FROM active_timer WHERE id = 1")
    timer["suggested_end"] = now_utc.isoformat()
    return timer


def save_recovered_session(task_id: int, task_name: str, started_at: str, end_time_iso: str):
    end = datetime.fromisoformat(end_time_iso)
    started = datetime.fromisoformat(started_at)
    duration = _ceil15((end - started).total_seconds())
    if duration <= 0:
        return
    local_date = end.astimezone().date().isoformat()
    with get_conn() as conn:
        conn.execute(
            """INSERT INTO time_entries
               (task_id, task_name, started_at, ended_at, duration_seconds, date)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (task_id, task_name, started_at, end_time_iso, duration, local_date),
        )


def get_all_entries():
    with get_conn() as conn:
        rows = conn.execute(
            """SELECT id, task_id, task_name, date, started_at, ended_at, duration_seconds
               FROM time_entries
               ORDER BY date DESC, started_at DESC"""
        ).fetchall()
    return [dict(r) for r in rows]


def update_entry(entry_id: int, task_id: int, entry_date: str, started_at: str, ended_at: str):
    """started_at / ended_at are 'YYYY-MM-DDTHH:MM' local-time strings."""
    with get_conn() as conn:
        task = conn.execute("SELECT name FROM tasks WHERE id = ?", (task_id,)).fetchone()
        if not task:
            return False, "task_not_found"
        start_dt = datetime.fromisoformat(started_at)
        end_dt = datetime.fromisoformat(ended_at)
        if end_dt <= start_dt:
            return False, "invalid_range"
        duration = _ceil15((end_dt - start_dt).total_seconds())
        conn.execute(
            """UPDATE time_entries
               SET task_id=?, task_name=?, date=?, started_at=?, ended_at=?, duration_seconds=?
               WHERE id=?""",
            (task_id, task["name"], entry_date, started_at, ended_at, duration, entry_id),
        )
    return True, None


# ── Analytics ──────────────────────────────────────────────────────────────

def analytics_week(week_start: str):
    """Total hours per task for a given Monday-starting week."""
    week_dates = _week_dates(week_start)
    with get_conn() as conn:
        rows = conn.execute(
            """SELECT task_name, SUM(duration_seconds) AS total_seconds
               FROM time_entries
               WHERE date >= ? AND date <= ?
               GROUP BY task_name
               ORDER BY total_seconds DESC""",
            (week_dates[0], week_dates[-1]),
        ).fetchall()
    return [
        {"task_name": r["task_name"], "hours": round(r["total_seconds"] / 3600, 2)}
        for r in rows
    ]


def analytics_daily(week_start: str):
    """Hours per task per day for the week (pivot)."""
    week_dates = _week_dates(week_start)
    with get_conn() as conn:
        rows = conn.execute(
            """SELECT task_name, date, SUM(duration_seconds) AS total_seconds
               FROM time_entries
               WHERE date >= ? AND date <= ?
               GROUP BY task_name, date""",
            (week_dates[0], week_dates[-1]),
        ).fetchall()

    # Build pivot: {task_name: {date: hours}}
    pivot: dict[str, dict[str, float]] = {}
    for r in rows:
        pivot.setdefault(r["task_name"], {})[r["date"]] = round(
            r["total_seconds"] / 3600, 2
        )

    result = []
    for task_name, day_map in sorted(pivot.items()):
        entry: dict = {"task_name": task_name, "days": {}}
        total = 0.0
        for d in week_dates:
            h = day_map.get(d, 0.0)
            entry["days"][d] = h
            total += h
        entry["total"] = round(total, 2)
        result.append(entry)
    return result, week_dates


def analytics_trends(start_date: str, end_date: str):
    """Hours per task per week (Sun–Sat) for a date range."""
    from datetime import timedelta
    with get_conn() as conn:
        rows = conn.execute(
            """SELECT task_name, date, SUM(duration_seconds) AS total_seconds
               FROM time_entries
               WHERE date >= ? AND date <= ?
               GROUP BY task_name, date""",
            (start_date, end_date),
        ).fetchall()

    # Accumulate into {week_sunday: {task: hours}}
    week_task: dict[str, dict[str, float]] = {}
    for row in rows:
        d = date.fromisoformat(row["date"])
        days_since_sunday = (d.weekday() + 1) % 7
        sunday = d - timedelta(days=days_since_sunday)
        week_key = sunday.isoformat()
        bucket = week_task.setdefault(week_key, {})
        bucket[row["task_name"]] = bucket.get(row["task_name"], 0) + row["total_seconds"] / 3600

    all_weeks = sorted(week_task.keys())
    all_tasks = sorted({t for week in week_task.values() for t in week})

    data = []
    for task in all_tasks:
        entry: dict = {"task_name": task, "weeks": {}}
        for week in all_weeks:
            entry["weeks"][week] = round(week_task[week].get(task, 0), 2)
        data.append(entry)

    return data, all_weeks


def _week_dates(week_start: str) -> list[str]:
    from datetime import timedelta
    start = date.fromisoformat(week_start)
    return [(start + timedelta(days=i)).isoformat() for i in range(7)]


def get_today_total() -> float:
    today = date.today().isoformat()
    with get_conn() as conn:
        row = conn.execute(
            "SELECT COALESCE(SUM(duration_seconds), 0) AS total FROM time_entries WHERE date = ? AND task_name NOT LIKE 'Non-Work%'",
            (today,),
        ).fetchone()
    return float(row["total"])


BACKUP_DIR = Path(__file__).parent / "data" / "backups"


def backup_db():
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    date_str = datetime.now().strftime("%Y-%m-%d")
    dest = BACKUP_DIR / f"timetracking_{date_str}.db"
    shutil.copy2(DB_PATH, dest)
