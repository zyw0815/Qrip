"""HTTP transport regressions for issue #82; no external network required."""

import asyncio
import http.client
import io
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import requests

import download as d
from streamrip.media.track import Track


class ManyHeadersHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        # Together with Server, Date and Content-Length: 104 headers.
        for _ in range(101):
            self.send_header("X-Cache-Hop", "cache")
        self.send_header("Content-Length", "8")
        self.end_headers()
        self.wfile.write(b"fLaCdata")

    def log_message(self, *args):
        pass


class HeaderLimitTests(unittest.TestCase):
    def test_104_headers_download_successfully(self):
        server = ThreadingHTTPServer(("127.0.0.1", 0), ManyHeadersHandler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            with tempfile.TemporaryDirectory() as directory:
                path = Path(directory) / "track.flac"
                url = f"http://127.0.0.1:{server.server_port}/track"
                item = {"item_id": "test"}
                with patch.object(d, "_active_item", item):
                    asyncio.run(d._patched_fast_async_download(str(path), url, {}, lambda _: None))
                self.assertEqual(path.read_bytes(), b"fLaCdata")
        finally:
            server.shutdown()
            server.server_close()
            thread.join()

    def test_response_header_limit_remains_bounded(self):
        headers = b"X-Test: value\r\n" * (http.client._MAXHEADERS + 1) + b"\r\n"
        with self.assertRaisesRegex(http.client.HTTPException, "got more than .* headers"):
            http.client.parse_headers(io.BytesIO(headers))


class TransferFailureTests(unittest.IsolatedAsyncioTestCase):
    async def test_failed_transfer_retains_original_error(self):
        item = {"item_id": "test"}
        error = requests.ConnectionError("got more than 256 headers")
        with tempfile.TemporaryDirectory() as directory:
            path = str(Path(directory) / "track.flac")
            with patch.object(d, "_active_item", item), \
                 patch.object(d, "_orig_fast_async_download", new=AsyncMock(side_effect=error)):
                with self.assertRaises(requests.ConnectionError):
                    await d._patched_fast_async_download(path, "http://unused", {}, lambda _: None)
            self.assertIn("got more than 256 headers", item.get("download_errors", {}).get(path, ""))

    async def test_successful_retry_clears_old_transfer_error(self):
        with tempfile.TemporaryDirectory() as directory:
            path = str(Path(directory) / "track.flac")
            item = {"item_id": "test", "download_errors": {path: "connection failed"}}
            with patch.object(d, "_active_item", item), \
                 patch.object(d, "_orig_fast_async_download", new=AsyncMock()):
                await d._patched_fast_async_download(path, "http://unused", {}, lambda _: None)
            self.assertNotIn(path, item.get("download_errors", {}))

    async def test_empty_download_never_reaches_tagger(self):
        with tempfile.TemporaryDirectory() as directory:
            path = str(Path(directory) / "track.flac")
            Path(path).touch()
            item = {"item_id": "test", "download_errors": {path: "got more than 256 headers"}}
            track = SimpleNamespace(
                download_path=path,
                meta=SimpleNamespace(info=SimpleNamespace(id="7")),
                downloadable=SimpleNamespace(_size=39073602),
                preprocess=AsyncMock(), postprocess=AsyncMock(),
            )
            track.download = lambda: d._patched_track_download(track)
            with patch.object(d, "_active_item", item), \
                 patch.object(d, "_orig_track_download", new=AsyncMock()):
                with self.assertRaisesRegex(RuntimeError, "got more than 256 headers"):
                    await Track.rip(track)
            track.postprocess.assert_not_awaited()
            self.assertIn("incomplete transfer", item["transfer_errors"][path])

    async def test_empty_download_without_content_length_fails(self):
        with tempfile.TemporaryDirectory() as directory:
            path = str(Path(directory) / "track.flac")
            Path(path).touch()
            item = {"item_id": "test"}
            track = SimpleNamespace(
                download_path=path, meta=SimpleNamespace(info=SimpleNamespace(id="7")),
                downloadable=SimpleNamespace(_size=None),
            )
            with patch.object(d, "_active_item", item), \
                 patch.object(d, "_orig_track_download", new=AsyncMock()):
                with self.assertRaisesRegex(RuntimeError, "empty download"):
                    await d._patched_track_download(track)


if __name__ == "__main__":
    unittest.main()
