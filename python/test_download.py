"""Offline regressions: run python -m unittest discover -s python -p 'test_*.py'."""

import asyncio
import os
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import download as d
from streamrip.config import Config


async def wait_for_result(items):
    async def wait():
        while not items:
            await asyncio.sleep(0.01)
    await asyncio.wait_for(wait(), timeout=5)


class DownloadSizeTests(unittest.IsolatedAsyncioTestCase):
    def client(self, sizes=(100, 100, 100), failed_id=None, count=3):
        async def get_downloadable(tid, quality):
            if tid == failed_id:
                raise RuntimeError("lookup failed")
            size = sizes[int(tid) - 1]
            return SimpleNamespace(size=AsyncMock(return_value=size * 1024 * 1024))

        return SimpleNamespace(
            get_metadata=AsyncMock(return_value={
                "tracks_count": count,
                "tracks": {"items": [{"id": str(i + 1)} for i in range(len(sizes))]},
            }),
            get_downloadable=AsyncMock(side_effect=get_downloadable),
        )

    async def test_complete_estimate(self):
        self.assertEqual(await d._estimate_size(self.client(), "a", "album", 4), 300)

    async def test_partial_estimate_is_unknown(self):
        self.assertEqual(await d._estimate_size(self.client(failed_id="2"), "a", "album", 4), 0)

    async def test_missing_content_length_is_unknown(self):
        self.assertEqual(await d._estimate_size(self.client(sizes=(100, 0, 100)), "a", "album", 4), 0)

    async def test_incomplete_track_list_is_unknown(self):
        self.assertEqual(await d._estimate_size(self.client(count=4), "a", "album", 4), 0)

    async def test_playlist_does_not_preflight_each_track(self):
        client = self.client()
        self.assertEqual(await d._estimate_size(client, "a", "playlist", 4), 0)
        client.get_downloadable.assert_not_called()

    def test_unique_audio_paths_and_actual_final_size(self):
        with tempfile.TemporaryDirectory() as directory:
            audio = Path(directory) / "track.flac"
            cover = Path(directory) / "cover.jpg"
            audio.write_bytes(b"a" * 1024 * 1024)
            cover.write_bytes(b"c" * 1024 * 1024)
            item = {"total": 1, "written_files": [str(audio), str(audio), str(cover), "missing.flac"]}
            self.assertEqual(d._update_size(item), 1)
            self.assertEqual(item["downloaded"], 1)
            with audio.open("ab") as f:
                f.write(b"tags" * 65536)
            d._update_size(item)
            self.assertEqual(item["downloaded"], 1.2)
            self.assertEqual(item["total"], 0)

    async def test_retry_keeps_original_path_and_playlist_metadata(self):
        with tempfile.TemporaryDirectory() as directory:
            original = os.path.join(directory, "Disc 2", "07 — track.flac")
            track = SimpleNamespace(folder="wrong", download_path="wrong")
            track.preprocess = AsyncMock()
            track.download = AsyncMock()
            track.postprocess = AsyncMock()
            pending = SimpleNamespace(id="7", resolve=AsyncMock(return_value=track))
            media = SimpleNamespace(tracks=[pending])
            await d._redownload_track(original, "7", media, None, None)
            self.assertEqual(track.folder, os.path.dirname(original))
            self.assertEqual(track.download_path, original)
            track.download.assert_awaited_once()
            track.postprocess.assert_awaited_once()

    def test_verification_retains_reason(self):
        item = {"track_map": {"bad.flac": "7"}}
        with patch.object(d.os.path, "exists", return_value=True), patch.object(d, "verify_audio", return_value="CRC mismatch"):
            self.assertEqual(d._verify_item(item, {}), [("bad.flac", "7", "CRC mismatch")])

    def test_incomplete_transfer_fails_before_duration(self):
        item = {"track_map": {"bad.flac": "7"}, "transfer_errors": {"bad.flac": "incomplete transfer"}}
        with patch.object(d.os.path, "exists", return_value=True), patch.object(d, "verify_audio") as verify:
            self.assertEqual(d._verify_item(item, {}), [("bad.flac", "7", "incomplete transfer")])
            verify.assert_not_called()

    async def test_worker_freezes_quality_and_uses_actual_completed_size(self):
        cfg = Config.defaults()
        cfg.session.qobuz.quality = 2
        item = {"item_id": "7", "media_type": "track", "quality": 4, "status": "queued", "total": 0}
        client = SimpleNamespace(login=AsyncMock())
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "track.flac"

            async def resolve():
                cfg.session.qobuz.quality = 1  # User changes Settings mid-task.
                return SimpleNamespace(meta=SimpleNamespace(title="Test", album=None), rip=AsyncMock(side_effect=rip))

            async def rip():
                path.write_bytes(b"a" * 1024 * 1024)
                item["written_files"] = [str(path), str(path)]

            def pending(_id, _client, snapshot, _db):
                self.assertIsNot(snapshot, cfg)
                self.assertEqual(snapshot.session.qobuz.quality, 4)
                return SimpleNamespace(resolve=resolve)

            async def estimate(_client, _id, _type, quality):
                self.assertEqual(quality, 4)
                return 50

            completed = []
            with patch.object(d, "get_config", return_value=cfg), \
                 patch.object(d, "QobuzClient", return_value=client), \
                 patch.object(d, "PendingSingle", side_effect=pending), \
                 patch.object(d, "_estimate_size", side_effect=estimate), \
                 patch.object(d, "_fetch_expected_durations", new=AsyncMock(return_value={})), \
                 patch.object(d, "_verify_item", return_value=[]), \
                 patch.object(d, "remove_artwork_tempdirs"), \
                 patch.object(d, "close_client", new=AsyncMock()), \
                 patch.object(d, "_download_queue", [item]), \
                 patch.object(d, "_completed", completed), \
                 patch.object(d, "_downloading", {}):
                worker = asyncio.create_task(d._download_worker())
                try:
                    await wait_for_result(completed)
                    self.assertEqual(completed[0]["downloaded"], 1)
                    self.assertEqual(cfg.session.qobuz.quality, 1)
                finally:
                    worker.cancel()
                    await asyncio.gather(worker, return_exceptions=True)

    async def test_worker_reports_failure_reason_and_retry_exception(self):
        item = {"item_id": "bad", "media_type": "track", "quality": 2, "status": "queued", "total": 0}
        cfg = Config.defaults()
        client = SimpleNamespace(login=AsyncMock())
        media = SimpleNamespace(meta=SimpleNamespace(title="Broken", album=None), rip=AsyncMock())
        failed = []
        retry = AsyncMock(side_effect=RuntimeError("connection closed"))
        with tempfile.TemporaryDirectory() as directory:
            path = os.path.join(directory, "bad.flac")
            with patch.object(d, "get_config", return_value=cfg), \
                 patch.object(d, "QobuzClient", return_value=client), \
                 patch.object(d, "PendingSingle", return_value=SimpleNamespace(resolve=AsyncMock(return_value=media))), \
                 patch.object(d, "_estimate_size", new=AsyncMock(return_value=0)), \
                 patch.object(d, "_fetch_expected_durations", new=AsyncMock(return_value={})), \
                 patch.object(d, "_verify_item", return_value=[(path, "bad", "frame CRC-16 mismatch")]), \
                 patch.object(d, "_redownload_track", retry), \
                 patch.object(d, "remove_artwork_tempdirs"), \
                 patch.object(d, "close_client", new=AsyncMock()), \
                 patch.object(d, "_download_queue", [item]), \
                 patch.object(d, "_failed", failed), \
                 patch.object(d, "_downloading", {}), \
                 self.assertLogs(d.logger, level="ERROR"):
                worker = asyncio.create_task(d._download_worker())
                try:
                    await wait_for_result(failed)
                    self.assertEqual(retry.await_count, 2)
                    self.assertIn("frame CRC-16 mismatch", failed[0]["error"])
                    self.assertIn("retry failed: connection closed", failed[0]["error"])
                    status = await d.download_status()
                    self.assertIn("bad.flac", status["failed"][0]["error"])
                finally:
                    worker.cancel()
                    await asyncio.gather(worker, return_exceptions=True)


if __name__ == "__main__":
    unittest.main()
