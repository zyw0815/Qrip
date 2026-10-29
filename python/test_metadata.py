"""Qobuz metadata mapping and actual container read-back regressions (#83)."""
import asyncio
import copy
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

from mutagen.flac import FLAC
from mutagen.id3 import ID3
from mutagen.mp4 import MP4
from PIL import Image

from streamrip.metadata.album import AlbumMetadata
from streamrip.metadata.track import TrackMetadata, qobuz_producers
from streamrip.metadata.tagger import Container, tag_file


ALBUM = {
    "qobuz_id": "previ0q8mktub", "title": "Interstellar", "tracks_count": 1,
    "genres_list": ["Soundtracks"], "release_date_original": "2014-11-18",
    "artist": {"name": "Hans Zimmer"}, "composer": {"name": "Hans Zimmer"},
    "copyright": "(C) 2020 Artwork (P) 2014 Compilation",
    "label": {"name": "WaterTower Music"}, "upc": "0794043201943",
    "release_type": "album", "parental_warning": False,
    "maximum_bit_depth": 24, "maximum_sampling_rate": 48.0,
    "image": {"large": "https://example.invalid/600.jpg", "small": "https://example.invalid/300.jpg", "thumbnail": "https://example.invalid/50.jpg"},
}
TRACK = {
    "id": 105398572, "title": "Cornfield Chase", "isrc": "USNLR1400774",
    "streamable": True, "performer": {"name": "Hans Zimmer"},
    "composer": {"name": "Hans Zimmer"}, "parental_warning": False,
    "performers": "Hans Zimmer, MainArtist, Composer",
    "copyright": "2014 Warner Bros. Entertainment Inc.",
    "maximum_bit_depth": 24, "maximum_sampling_rate": 48.0,
}


def metadata(track=None, album=None):
    return TrackMetadata.from_qobuz(
        AlbumMetadata.from_qobuz(copy.deepcopy(ALBUM if album is None else album)),
        copy.deepcopy(TRACK if track is None else track),
    )


class MetadataMappingTests(unittest.TestCase):
    def test_real_reference_fields_and_zero_rating(self):
        tags = dict(Container.FLAC.get_tag_pairs(metadata()))
        self.assertEqual(tags["INVOLVEDPEOPLE"], TRACK["performers"])
        self.assertEqual(tags["COPYRIGHT"], TRACK["copyright"])
        self.assertEqual(tags["ITUNESADVISORY"], "0")
        self.assertEqual(tags["LABEL"], "WaterTower Music")
        self.assertEqual(tags["PUBLISHER"], "WaterTower Music")
        self.assertEqual(tags["MEDIATYPE"], "album")
        self.assertEqual(tags["UPC"], "0794043201943")
        self.assertEqual(tags["ISRC"], "USNLR1400774")
        self.assertNotIn("PRODUCER", tags)

    def test_producer_roles_and_original_credit_text(self):
        track = dict(TRACK, performers=(
            "Wiener Philharmoniker, MainArtist, Orchestra - "
            "Andris Nelsons, MainArtist, Conductor - "
            "Friedemann Engelbrecht, Producer - "
            "Anne-Sophie Test, Co-Producer - Friedemann Engelbrecht, Producer"
        ))
        tags = dict(Container.FLAC.get_tag_pairs(metadata(track)))
        self.assertEqual(tags["PRODUCER"], "Friedemann Engelbrecht; Anne-Sophie Test")
        self.assertEqual(tags["INVOLVEDPEOPLE"], track["performers"])
        self.assertIsNone(qobuz_producers("A Producer Named Joe, Composer"))

    def test_recording_copyright_and_album_fallback(self):
        track = dict(TRACK, copyright="(P) 2026 Deutsche Grammophon GmbH, Berlin")
        self.assertEqual(dict(Container.FLAC.get_tag_pairs(metadata(track)))["COPYRIGHT"],
                         "℗ 2026 Deutsche Grammophon GmbH, Berlin")
        track.pop("copyright")
        self.assertEqual(dict(Container.FLAC.get_tag_pairs(metadata(track)))["COPYRIGHT"],
                         "© 2020 Artwork ℗ 2014 Compilation")

    def test_explicit_track_rating(self):
        meta = metadata(dict(TRACK, parental_warning=True))
        self.assertTrue(meta.info.explicit)
        self.assertEqual(dict(Container.FLAC.get_tag_pairs(meta))["ITUNESADVISORY"], "1")

    def test_optional_values_are_omitted(self):
        album = dict(ALBUM, label=None, upc=None, release_type=None, product_type=None)
        track = dict(TRACK, performers=None, copyright=None)
        tags = dict(Container.FLAC.get_tag_pairs(metadata(track, album)))
        for name in ("LABEL", "PUBLISHER", "UPC", "MEDIATYPE", "INVOLVEDPEOPLE", "PRODUCER"):
            self.assertNotIn(name, tags)


@unittest.skipUnless(shutil.which("ffmpeg"), "ffmpeg required for real container fixtures")
class MetadataContainerTests(unittest.TestCase):
    def test_roundtrip_flac_mp3_and_aac(self):
        meta = metadata(dict(TRACK, performers="Hans Zimmer, MainArtist - Test Producer, Producer"))
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            cover = folder / "cover.jpg"
            Image.new("RGB", (16, 16), "purple").save(cover)
            for extension, codec in (("flac", "flac"), ("mp3", "libmp3lame"), ("m4a", "aac")):
                with self.subTest(extension=extension):
                    path = folder / f"track.{extension}"
                    subprocess.run(["ffmpeg", "-v", "error", "-f", "lavfi", "-i",
                                    "sine=frequency=440:duration=0.5", "-c:a", codec, str(path)], check=True)
                    asyncio.run(tag_file(str(path), meta, str(cover)))
                    if extension == "flac":
                        audio = FLAC(path)
                        self.assertEqual(audio["upc"], ["0794043201943"])
                        self.assertEqual(audio["producer"], ["Test Producer"])
                        self.assertEqual(audio["itunesadvisory"], ["0"])
                        self.assertEqual(audio["copyright"], [TRACK["copyright"]])
                        self.assertEqual(len(audio.pictures), 1)
                    elif extension == "mp3":
                        audio = ID3(path)
                        self.assertEqual(str(audio["TXXX:UPC"]), "0794043201943")
                        self.assertEqual(str(audio["TPUB"]), "WaterTower Music")
                        self.assertEqual(str(audio["TXXX:ITUNESADVISORY"]), "0")
                        self.assertTrue(audio.getall("APIC"))
                    else:
                        audio = MP4(path)
                        self.assertEqual(audio["----:com.apple.iTunes:UPC"], [b"0794043201943"])
                        self.assertEqual(audio["rtng"], [0])
                        self.assertTrue(audio["covr"])
                    subprocess.run(["ffmpeg", "-v", "error", "-i", str(path), "-f", "null", "-"], check=True)


if __name__ == "__main__":
    unittest.main()
