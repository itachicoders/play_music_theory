#!/usr/bin/env python3
"""
Custom server for play_music_theory.
Handles routing for /play, /gallery, /gallery-data, and POST /publish.
Falls back to static files for all assets.
"""

import os
import sys
import json
import time
import uuid
import urllib.parse
import urllib.request
import threading
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
GALLERY_DATA_FILE = os.path.join(BASE_DIR, "gallery-data.json")
LOCK = threading.Lock()

def load_gallery_data():
    with LOCK:
        if not os.path.exists(GALLERY_DATA_FILE):
            return []
        try:
            with open(GALLERY_DATA_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            print(f"[Error] Failed to read gallery data: {e}", file=sys.stderr)
            return []

def save_gallery_data(items):
    with LOCK:
        tmp_file = GALLERY_DATA_FILE + ".tmp"
        try:
            with open(tmp_file, "w", encoding="utf-8") as f:
                json.dump(items, f, ensure_ascii=False, indent=2)
            os.replace(tmp_file, GALLERY_DATA_FILE)
            return True
        except Exception as e:
            print(f"[Error] Failed to save gallery data: {e}", file=sys.stderr)
            if os.path.exists(tmp_file):
                try:
                    os.remove(tmp_file)
                except OSError:
                    pass
            return False

def forward_publish_upstream(payload_bytes):
    """Optionally attempt to sync with upstream playmusictheory.net if online."""
    try:
        req = urllib.request.Request(
            "https://playmusictheory.net/publish",
            data=payload_bytes,
            headers={"Content-Type": "application/json", "User-Agent": "play_music_theory_local/1.0"},
            method="POST"
        )
        with urllib.request.urlopen(req, timeout=5) as resp:
            resp.read()
    except Exception:
        # Offline or remote error - ignore, local publish already succeeded
        pass

class MusicTheoryHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=BASE_DIR, **kwargs)

    def end_headers(self):
        # Enable CORS for local testing
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.end_headers()

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path.rstrip("/")
        query = urllib.parse.parse_qs(parsed.query)

        # 1. Route / or /play -> index.html
        if path == "" or path == "/play":
            self.path = "/index.html"
            return super().do_GET()

        # 2. Route /gallery -> gallery.html
        if path == "/gallery":
            self.path = "/gallery.html"
            return super().do_GET()

        # Route /favicon.ico -> icon.svg
        if path == "/favicon.ico":
            self.path = "/icon.svg"
            return super().do_GET()

        # 3. Route /gallery-data
        if path == "/gallery-data":
            items = load_gallery_data()
            key = query.get("key", [None])[0]
            queue = query.get("queue", ["0"])[0] == "1"

            # Filter items if not admin key
            if not key:
                # Regular view: filter out pending items
                display_items = [i for i in items if not i.get("pending", False)]
            else:
                display_items = items

            pending_count = sum(1 for i in items if i.get("pending", False))
            body = json.dumps(display_items, ensure_ascii=False).encode("utf-8")

            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("X-Queue-Total", str(pending_count))
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return

        # 4. Curation endpoints
        if path == "/gallery-feature":
            item_id = query.get("id", [None])[0]
            items = load_gallery_data()
            status = "unstarred"
            for item in items:
                if item.get("id") == item_id:
                    item["star"] = not item.get("star", False)
                    status = "starred" if item["star"] else "unstarred"
                    break
            save_gallery_data(items)
            body = status.encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return

        if path == "/gallery-approve":
            item_id = query.get("id", [None])[0]
            items = load_gallery_data()
            for item in items:
                if item.get("id") == item_id:
                    item["pending"] = False
                    break
            save_gallery_data(items)
            self.send_response(200)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.send_header("Content-Length", "2")
            self.end_headers()
            self.wfile.write(b"ok")
            return

        if path == "/gallery-remove":
            item_id = query.get("id", [None])[0]
            items = load_gallery_data()
            items = [item for item in items if item.get("id") != item_id]
            save_gallery_data(items)
            self.send_response(200)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.send_header("Content-Length", "2")
            self.end_headers()
            self.wfile.write(b"ok")
            return

        # 5. Default static files
        return super().do_GET()

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path.rstrip("/")
        query = urllib.parse.parse_qs(parsed.query)

        # 1. Route /publish
        if path == "/publish":
            try:
                length = int(self.headers.get("Content-Length", 0))
                body_bytes = self.rfile.read(length)
                data = json.loads(body_bytes.decode("utf-8"))

                packed = data.get("p")
                if not packed:
                    self.send_response(400)
                    self.end_headers()
                    self.wfile.write(b"missing p")
                    return

                title = data.get("t", "").strip()
                artist_url = data.get("u", "").strip()

                items = load_gallery_data()
                # Deduplicate existing published piece with exact same packed data
                items = [i for i in items if i.get("p") != packed]

                new_id = f"{int(time.time() * 1000)}-{uuid.uuid4().hex[:8]}"
                new_entry = {
                    "id": new_id,
                    "star": False,
                    "pending": False,
                    "p": packed,
                    "t": title,
                    "u": artist_url,
                    "n": title or "local artist",
                }
                items.insert(0, new_entry)
                save_gallery_data(items)

                # Try upstream sync in background thread
                threading.Thread(target=forward_publish_upstream, args=(body_bytes,), daemon=True).start()

                # Official response is 200 "thin"
                resp_body = b"thin"
                self.send_response(200)
                self.send_header("Content-Type", "text/plain; charset=utf-8")
                self.send_header("Content-Length", str(len(resp_body)))
                self.end_headers()
                self.wfile.write(resp_body)
                return
            except Exception as e:
                self.send_response(500)
                self.end_headers()
                self.wfile.write(f"error: {e}".encode("utf-8"))
                return

        # 2. Route /gallery-triage
        if path == "/gallery-triage":
            try:
                length = int(self.headers.get("Content-Length", 0))
                body_bytes = self.rfile.read(length)
                data = json.loads(body_bytes.decode("utf-8"))
                keep_ids = set(data.get("keep", []))
                drop_ids = set(data.get("drop", []))

                items = load_gallery_data()
                new_items = []
                for item in items:
                    iid = item.get("id")
                    if iid in drop_ids:
                        continue
                    if iid in keep_ids:
                        item["pending"] = False
                    new_items.append(item)
                save_gallery_data(new_items)

                self.send_response(200)
                self.send_header("Content-Type", "text/plain; charset=utf-8")
                self.send_header("Content-Length", "2")
                self.end_headers()
                self.wfile.write(b"ok")
                return
            except Exception as e:
                self.send_response(500)
                self.end_headers()
                self.wfile.write(f"error: {e}".encode("utf-8"))
                return

        self.send_response(404)
        self.end_headers()

    def guess_type(self, path):
        # Ensure correct MIME types for webmanifest and others
        if path.endswith(".webmanifest"):
            return "application/manifest+json"
        return super().guess_type(path)


def run(port=8000):
    server_address = ("", port)
    httpd = ThreadingHTTPServer(server_address, MusicTheoryHandler)
    print(f"[*] play_music_theory server running at http://localhost:{port}/")
    print("    - Player:  http://localhost:{}/play".format(port))
    print("    - Gallery: http://localhost:{}/gallery".format(port))
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n[*] Server stopped.")
        httpd.server_close()


if __name__ == "__main__":
    port = int(os.environ.get("PORT", sys.argv[1] if len(sys.argv) > 1 else 8000))
    run(port)
