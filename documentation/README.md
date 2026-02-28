# Time Tracker

A local, single-user time tracking web app. Runs entirely on your machine — no accounts, no cloud, no internet required.

## Prerequisites

- Python 3.11 or later
- pip

## Setup

```bash
# 1. Clone the repo
git clone <repo-url>
cd TimeTracking

# 2. Create a virtual environment
python3 -m venv .venv

# 3. Activate it
source .venv/bin/activate        # macOS / Linux
.venv\Scripts\activate           # Windows

# 4. Install dependencies
pip install -r requirements.txt
```

## Running

```bash
source .venv/bin/activate
python __main__.py
```

The app starts a local Flask server on `http://localhost:5000` and opens your browser automatically. The database (`data/timetracking.db`) is created on first run — nothing to configure.

To stop the app, click the **✕ Close** button in the top-right corner of the UI, or press `Ctrl+C` in the terminal.

## Features

### Timer
- Start a timer against any active task
- Pause and resume mid-session
- Displays elapsed time (live) and elapsed time rounded up to the nearest 15 minutes
- Shows the date and start time once running
- Daily progress bar showing hours logged today toward an 8-hour goal (excludes tasks prefixed with `Non-Work`)

### Tasks
- Add, rename, disable, or delete tasks
- Disabled tasks are hidden from the timer and log dropdowns but their history is preserved
- Tasks with existing entries cannot be deleted — disable them instead

### Log Time
- Manually log a time range (task, date, start → end) for past entries
- Queue multiple entries before submitting them all at once
- The queue persists across page refreshes (stored in browser localStorage)

### History
- Full entry history, grouped by week then by day
- Edit or delete any entry inline
- Weeks and days are collapsible; the most recent week/day is open by default

### Analytics

**Weekly view**
- Stacked bar chart of hours by task for any week
- Daily breakdown table
- Navigate week-by-week or jump to the current week with the Today button
- Filter by individual tasks using the task toggle

**Trends view**
- Hours by week over a date range
- Presets: YTD, Last 30/90 days, This Quarter, Last Quarter, Last 6 Months, Last Year, or a custom range
- Toggle between bar and line chart
- Filter by individual tasks

### Session Recovery
If the app is closed or crashes while a timer is running, the next startup will show a recovery modal. You can save the entry (with the suggested end time or a custom one), or discard it.

## Data & Backups

- **Database**: `data/timetracking.db` (SQLite, created automatically on first run)
- **Backups**: `data/backups/timetracking_YYYY-MM-DD.db` — a backup is created automatically every day at 8:00 PM

The `data/` directory is excluded from version control. Back it up separately if needed.

## Project Structure

```
__main__.py        # Entry point — starts Flask, browser, backup scheduler
app.py             # Flask routes (REST API)
db.py              # All database logic
templates/
  index.html       # Single-page HTML shell
static/
  app.js           # All frontend logic (~1200 lines, vanilla JS)
  style.css        # Styles
data/              # Created at runtime, not in version control
  timetracking.db
  backups/
```
