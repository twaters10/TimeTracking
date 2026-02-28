import threading
import webbrowser
import time
from datetime import datetime, timedelta
import app as flask_module
from app import app
import db


def main():
    db.init_db()
    flask_module._recovered_session = db.recover_active_timer()

    def open_browser():
        time.sleep(1)
        webbrowser.open("http://localhost:5000")

    def backup_scheduler():
        while True:
            now = datetime.now()
            target = now.replace(hour=20, minute=0, second=0, microsecond=0)
            if now >= target:
                target += timedelta(days=1)
            time.sleep((target - now).total_seconds())
            db.backup_db()

    threading.Thread(target=open_browser, daemon=True).start()
    threading.Thread(target=backup_scheduler, daemon=True).start()

    app.run(host="127.0.0.1", port=5000, use_reloader=False, debug=False)


if __name__ == "__main__":
    main()
