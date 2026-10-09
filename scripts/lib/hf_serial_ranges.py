"""Serial HF range transport. Signed redirects and payloads stay in scratch.

References: https://huggingface.co/docs/dataset-viewer/en/parquet
"""
import contextlib
import email.utils
import http.server
import pathlib
import threading
import time
import urllib.error
import urllib.request


class SerialTransport:
    def __init__(self):
        self.last = 0.0
        self.last_progress = 0.0
        self.stats = {'requests': 0, 'bytes': 0, 'statuses': [], 'minimum_interval_seconds': 2}
        transport = self

        class Redirect(urllib.request.HTTPRedirectHandler):
            def redirect_request(self, request, fp, code, message, headers, new_url):
                transport.pace()
                return super().redirect_request(request, fp, code, message, headers, new_url)

        self.opener = urllib.request.build_opener(Redirect())

    def pace(self):
        time.sleep(max(0, 2 - (time.monotonic() - self.last)))
        now = time.monotonic()
        if self.last:
            interval = now - self.last
            self.stats['minimum_observed_interval_seconds'] = min(interval, self.stats.get('minimum_observed_interval_seconds', interval))
        self.last = now
        self.stats['requests'] += 1
        if time.monotonic() - self.last_progress >= 30:
            self.last_progress = time.monotonic()
            print(f"range-audit progress: requests={self.stats['requests']}, received_bytes={self.stats['bytes']}", flush=True)

    def open(self, url, method='GET', headers=None):
        for attempt in range(3):
            self.pace()
            try:
                response = self.opener.open(urllib.request.Request(url, method=method, headers={
                    'User-Agent': 'AyahX-D2-audit/1.0 (read-only; serial; no audio rehosting)', **(headers or {})}), timeout=90)
                self.stats['statuses'].append(response.status)
                return response
            except urllib.error.HTTPError as error:
                self.stats['statuses'].append(error.code)
                if error.code not in (429, 500, 502, 503, 504) or attempt == 2:
                    raise
                delay = 2 ** (attempt + 1)
                retry = error.headers.get('Retry-After')
                if retry:
                    try:
                        delay = max(delay, float(retry))
                    except ValueError:
                        delay = max(delay, email.utils.parsedate_to_datetime(retry).timestamp() - time.time())
                time.sleep(delay)
            except (TimeoutError, urllib.error.URLError):
                if attempt == 2:
                    raise
                time.sleep(2 ** (attempt + 1))
        raise RuntimeError('TRANSPORT_RETRY_EXHAUSTED')


@contextlib.contextmanager
def range_proxy(files, transport):
    class Proxy(http.server.BaseHTTPRequestHandler):
        def log_message(self, *unused):
            pass  # Suppress signed URL and raw payload logging.

        def serve(self, method):
            try:
                index = int(self.path.strip('/').split('.')[0])
                headers = {'Range': self.headers['Range']} if self.headers.get('Range') else {}
                with transport.open(files[index], method, headers) as response:
                    self.send_response(response.status)
                    for key in ['Content-Length', 'Content-Range', 'Content-Type', 'Accept-Ranges', 'ETag']:
                        if response.headers.get(key):
                            self.send_header(key, response.headers[key])
                    self.end_headers()
                    if method != 'HEAD':
                        while data := response.read(65536):
                            transport.stats['bytes'] += len(data)
                            self.wfile.write(data)
            except (urllib.error.URLError, OSError, ValueError, IndexError) as error:
                transport.stats['last_error'] = type(error).__name__
                self.send_response(getattr(error, 'code', 502))
                self.send_header('Content-Length', '0')
                self.end_headers()

        def do_GET(self):
            self.serve('GET')

        def do_HEAD(self):
            self.serve('HEAD')

    server = http.server.HTTPServer(('127.0.0.1', 0), Proxy)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield [f'http://127.0.0.1:{server.server_port}/{i}.parquet' for i in range(len(files))]
    finally:
        server.shutdown()
        server.server_close()
        thread.join()


def download(transport, url, destination):
    with transport.open(url) as response, pathlib.Path(destination).open('wb') as output:
        while data := response.read(65536):
            output.write(data)
