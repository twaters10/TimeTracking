from datetime import datetime, timezone, date, timedelta
from flask import Flask, jsonify, request, render_template, abort
import db

app = Flask(__name__)

# Set at startup by recover_active_timer(); consumed on first /api/recovered call.
_recovered_session = None


@app.before_request
def ensure_db():
    db.init_db()


# ── Pages ──────────────────────────────────────────────────────────────────

@app.get("/")
def index():
    return render_template("index.html")


# ── Tasks ──────────────────────────────────────────────────────────────────

@app.get("/api/tasks")
def api_get_tasks():
    return jsonify(db.get_all_tasks())


@app.post("/api/tasks")
def api_add_task():
    data = request.get_json(silent=True) or {}
    name = (data.get("name") or "").strip()
    if not name:
        return jsonify({"error": "name required"}), 400
    task, err = db.add_task(name)
    if err == "duplicate":
        return jsonify({"error": "Task already exists"}), 409
    return jsonify(task), 201


@app.patch("/api/tasks/<int:task_id>")
def api_rename_task(task_id: int):
    data = request.get_json(silent=True) or {}
    name = (data.get("name") or "").strip()
    if not name:
        return jsonify({"error": "name required"}), 400
    ok, err = db.rename_task(task_id, name)
    if not ok:
        return jsonify({"error": "A task with that name already exists"}), 409
    return jsonify({"ok": True})


@app.patch("/api/tasks/<int:task_id>/disable")
def api_disable_task(task_id: int):
    db.disable_task(task_id)
    return jsonify({"ok": True})


@app.delete("/api/tasks/<int:task_id>")
def api_delete_task(task_id: int):
    ok, err = db.delete_task(task_id)
    if not ok:
        return jsonify({"error": "Task has time entries — disable instead"}), 409
    return jsonify({"ok": True})


# ── Timer ──────────────────────────────────────────────────────────────────

@app.get("/api/timer/status")
def api_timer_status():
    timer = db.get_active_timer()
    if not timer:
        return jsonify({"running": False})
    started = datetime.fromisoformat(timer["started_at"])
    paused_secs = timer.get("paused_seconds") or 0
    if timer.get("paused_at"):
        paused_since = datetime.fromisoformat(timer["paused_at"])
        paused_secs += (datetime.now(timezone.utc) - paused_since).total_seconds()
    elapsed = (datetime.now(timezone.utc) - started).total_seconds() - paused_secs
    return jsonify({
        "running": True,
        "paused": timer.get("paused_at") is not None,
        "task_id": timer["task_id"],
        "task_name": timer["task_name"],
        "started_at": timer["started_at"],
        "elapsed_seconds": elapsed,
    })


@app.post("/api/timer/start")
def api_timer_start():
    data = request.get_json(silent=True) or {}
    task_id = data.get("task_id")
    if not task_id:
        return jsonify({"error": "task_id required"}), 400
    ok, err = db.start_timer(int(task_id))
    if err == "already_running":
        return jsonify({"error": "Timer already running"}), 409
    if err == "task_not_found":
        return jsonify({"error": "Task not found or inactive"}), 404
    return jsonify({"ok": True}), 200


@app.post("/api/timer/pause")
def api_timer_pause():
    ok, err = db.pause_timer()
    if err == "not_running":
        return jsonify({"error": "No timer running"}), 409
    if err == "already_paused":
        return jsonify({"error": "Timer already paused"}), 409
    return jsonify({"ok": True})


@app.post("/api/timer/resume")
def api_timer_resume():
    ok, err = db.resume_timer()
    if err == "not_running":
        return jsonify({"error": "No timer running"}), 409
    if err == "not_paused":
        return jsonify({"error": "Timer is not paused"}), 409
    return jsonify({"ok": True})


@app.patch("/api/timer/start_time")
def api_timer_update_start():
    data = request.get_json(silent=True) or {}
    started_at = data.get("started_at")
    if not started_at:
        return jsonify({"error": "started_at required"}), 400
    ok, err = db.update_timer_start(started_at)
    if err == "not_running":
        return jsonify({"error": "No timer running"}), 409
    return jsonify({"ok": True})


@app.post("/api/timer/stop")
def api_timer_stop():
    timer, err = db.stop_timer()
    if err == "not_running":
        return jsonify({"error": "No timer running"}), 409
    return jsonify({"ok": True})


# ── Manual entries ─────────────────────────────────────────────────────────

@app.post("/api/entries")
def api_add_entries():
    data = request.get_json(silent=True) or []
    if isinstance(data, dict):
        data = [data]
    errors = []
    added = 0
    for i, entry in enumerate(data):
        task_id = entry.get("task_id")
        entry_date = entry.get("date")
        started_at = entry.get("started_at")
        ended_at = entry.get("ended_at")
        if not all([task_id, entry_date, started_at, ended_at]):
            errors.append(f"Entry {i + 1}: missing fields")
            continue
        if "T" not in started_at:
            started_at = f"{entry_date}T{started_at}"
        if "T" not in ended_at:
            ended_at = f"{entry_date}T{ended_at}"
        _, err = db.add_manual_entry(int(task_id), entry_date, started_at, ended_at)
        if err == "task_not_found":
            errors.append(f"Entry {i + 1}: task not found")
        elif err == "invalid_range":
            errors.append(f"Entry {i + 1}: end time must be after start time")
        elif err:
            errors.append(f"Entry {i + 1}: {err}")
        else:
            added += 1
    status = 200 if not errors else (207 if added else 400)
    return jsonify({"added": added, "errors": errors}), status


@app.get("/api/entries")
def api_get_entries():
    limit = request.args.get("limit", 50, type=int)
    return jsonify(db.get_recent_entries(limit))


@app.get("/api/recovered")
def api_recovered():
    return jsonify(_recovered_session)


@app.post("/api/recovered/save")
def api_recovered_save():
    global _recovered_session
    if not _recovered_session:
        return jsonify({"error": "No session to recover"}), 404
    data = request.get_json(silent=True) or {}
    end_time = data.get("end_time") or datetime.now(timezone.utc).isoformat()
    db.save_recovered_session(
        _recovered_session["task_id"],
        _recovered_session["task_name"],
        _recovered_session["started_at"],
        end_time,
    )
    _recovered_session = None
    return jsonify({"ok": True})


@app.post("/api/recovered/discard")
def api_recovered_discard():
    global _recovered_session
    _recovered_session = None
    return jsonify({"ok": True})


@app.get("/api/entries/all")
def api_get_all_entries():
    return jsonify(db.get_all_entries())


@app.patch("/api/entries/<int:entry_id>")
def api_update_entry(entry_id: int):
    data = request.get_json(silent=True) or {}
    task_id = data.get("task_id")
    entry_date = data.get("date")
    started_at = data.get("started_at")
    ended_at = data.get("ended_at")
    if not all([task_id, entry_date, started_at, ended_at]):
        return jsonify({"error": "missing fields"}), 400
    if "T" not in started_at:
        started_at = f"{entry_date}T{started_at}"
    if "T" not in ended_at:
        ended_at = f"{entry_date}T{ended_at}"
    ok, err = db.update_entry(entry_id, int(task_id), entry_date, started_at, ended_at)
    if err == "task_not_found":
        return jsonify({"error": "task not found"}), 404
    if err == "invalid_range":
        return jsonify({"error": "End time must be after start time"}), 400
    return jsonify({"ok": True})


@app.delete("/api/entries/<int:entry_id>")
def api_delete_entry(entry_id: int):
    db.delete_entry(entry_id)
    return jsonify({"ok": True})


# ── Analytics ──────────────────────────────────────────────────────────────

def _current_sunday() -> str:
    today = date.today()
    # weekday(): Mon=0 … Sun=6  →  days since Sunday = (weekday + 1) % 7
    return (today - timedelta(days=(today.weekday() + 1) % 7)).isoformat()


@app.get("/api/today")
def api_today():
    return jsonify({"seconds": db.get_today_total()})


@app.get("/api/analytics/trends")
def api_analytics_trends():
    start = request.args.get("start")
    end = request.args.get("end")
    if not start or not end:
        return jsonify({"error": "start and end required"}), 400
    data, weeks = db.analytics_trends(start, end)
    return jsonify({"start": start, "end": end, "weeks": weeks, "data": data})


@app.get("/api/analytics/daily")
def api_analytics_daily():
    week_start = request.args.get("week_start") or _current_sunday()
    data, week_dates = db.analytics_daily(week_start)
    return jsonify({"week_start": week_start, "week_dates": week_dates, "data": data})


@app.post("/api/quit")
def api_quit():
    import os, signal, threading
    threading.Thread(target=lambda: os.kill(os.getpid(), signal.SIGINT), daemon=True).start()
    return jsonify({"ok": True})


if __name__ == "__main__":
    import threading, webbrowser, time
    db.init_db()
    _recovered_session = db.recover_active_timer()
    threading.Thread(target=lambda: (time.sleep(1), webbrowser.open("http://127.0.0.1:5000")), daemon=True).start()
    app.run(host="127.0.0.1", port=5000, use_reloader=False, debug=False)
