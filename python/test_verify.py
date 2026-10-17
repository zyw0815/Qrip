import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

from verify import verify_audio


@unittest.skipUnless(shutil.which("ffmpeg"), "ffmpeg required for independent FLAC fixtures")
class AudioVerificationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.folder = Path(cls.temp.name)
        cls.good = cls.folder / "good.flac"
        subprocess.run([
            "ffmpeg", "-v", "error", "-f", "lavfi", "-i",
            "sine=frequency=440:duration=4.25", "-c:a", "flac", str(cls.good),
        ], check=True)
        cls.data = cls.good.read_bytes()

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    def test_good_file_passes(self):
        self.assertIsNone(verify_audio(str(self.good), 4))

    def test_catalogue_duration_mismatch_needs_complete_transfer(self):
        self.assertIn("duration mismatch", verify_audio(str(self.good), 2))
        self.assertIsNone(verify_audio(str(self.good), 2, transfer_complete=True))

    def test_corrupt_audio_fails_even_with_complete_transfer(self):
        damaged = bytearray(self.data)
        damaged[-8] ^= 0x80
        path = self.folder / "corrupt.flac"
        path.write_bytes(damaged)
        self.assertIn("corrupt FLAC", verify_audio(str(path), 2, transfer_complete=True))

    def test_truncated_file_fails_even_with_complete_transfer(self):
        path = self.folder / "truncated.flac"
        path.write_bytes(self.data[:-50])
        self.assertIn("corrupt FLAC", verify_audio(str(path), 2, transfer_complete=True))

    def test_metadata_only_file_is_not_a_complete_song(self):
        pos = 4
        while True:
            last = self.data[pos] & 0x80
            length = int.from_bytes(self.data[pos + 1:pos + 4], "big")
            pos += 4 + length
            if last:
                break
        path = self.folder / "no-audio.flac"
        path.write_bytes(self.data[:pos])
        self.assertIn("no audio frames", verify_audio(str(path), 2, transfer_complete=True))

    def test_truncated_metadata_returns_error(self):
        path = self.folder / "metadata-truncated.flac"
        path.write_bytes(b"fLaC\x80\x00\x00\x22\x00")
        self.assertIn("truncated metadata", verify_audio(str(path)))


if __name__ == "__main__":
    unittest.main()
