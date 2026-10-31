#!/usr/bin/env python3
"""Show the live Explorer frontend with component annotations on port 4180."""

import argparse
from html import escape
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import mimetypes
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import ProxyHandler, Request, build_opener


ROOT = Path(__file__).resolve().parent
DIRECT = build_opener(ProxyHandler({}))


def annotate(html, upstream):
    """Use the upstream HTML's current asset URLs instead of storing build hashes."""
    toolbar = (ROOT / "toolbar.html").read_text().replace("__UPSTREAM__", escape(upstream, quote=True))
    html = html.replace('lang="en"', 'lang="zh-CN"')
    html = html.replace("<title>COViS</title>", "<title>COViS · Dev 组件标注</title>")
    html = html.replace(
        "</head>",
        '<link rel="stylesheet" href="/annotations.css">\n'
        '<script defer src="/annotations.js"></script>\n</head>',
    )
    return html.replace('<div id="root"></div>', toolbar)


class Handler(BaseHTTPRequestHandler):
    def allowed(self):
        try:
            return urlsplit("http://" + self.headers.get("Host", "")).hostname in {
                "127.0.0.1", "localhost", "::1"
            }
        except ValueError:
            return False

    def send_bytes(self, body, media_type):
        self.send_response(200)
        self.send_header("Content-Type", media_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if not self.allowed():
            self.send_error(403, "Use localhost or 127.0.0.1")
            return
        name = urlsplit(self.path).path
        if name in {"/annotations.js", "/annotations.css"}:
            file = ROOT / name[1:]
            self.send_bytes(file.read_bytes(), mimetypes.guess_type(file.name)[0])
        else:
            self.proxy(annotated=name in {"/", "/index.html"})

    def do_POST(self):
        origin = self.headers.get("Origin")
        if not self.allowed() or (origin and urlsplit(origin).netloc != self.headers.get("Host")):
            self.send_error(403, "Use the same-origin component viewer")
            return
        self.proxy()

    def proxy(self, annotated=False):
        upstream = self.server.upstream
        length = int(self.headers.get("Content-Length", 0))
        data = self.rfile.read(length) if self.command == "POST" and length else None
        headers = {}
        if self.headers.get("Content-Type"):
            headers["Content-Type"] = self.headers["Content-Type"]
        for name in ("If-None-Match", "Range"):
            if self.headers.get(name) and not annotated:
                headers[name] = self.headers[name]
        if self.command == "POST" and self.headers.get("Origin"):
            headers["Origin"] = upstream
        request = Request(upstream + self.path, data=data, headers=headers, method=self.command)
        try:
            response = DIRECT.open(request, timeout=60)
        except HTTPError as error:
            response = error
        except (OSError, URLError):
            self.send_error(502, "Start the Prob Explorer upstream first")
            return
        try:
            with response:
                if annotated and response.status == 200:
                    body = annotate(response.read().decode("utf-8"), upstream).encode("utf-8")
                    self.send_bytes(body, "text/html; charset=utf-8")
                    return
                self.send_response(response.status)
                for name in ("Content-Type", "Content-Length", "ETag", "Content-Range", "Accept-Ranges"):
                    if response.headers.get(name):
                        self.send_header(name, response.headers[name])
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                while chunk := response.read(64 * 1024):
                    self.wfile.write(chunk)
        except (BrokenPipeError, ConnectionResetError):
            pass  # Navigation and lazy image loading can cancel requests.


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=4180)
    parser.add_argument("--upstream", default="http://127.0.0.1:4173")
    args = parser.parse_args()
    with ThreadingHTTPServer(("127.0.0.1", args.port), Handler) as server:
        server.upstream = args.upstream.rstrip("/")
        print(f"Dev component map: http://localhost:{args.port}/?dataset=sft-e6.0-r30", flush=True)
        server.serve_forever()
