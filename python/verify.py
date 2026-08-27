"""Download verification: FLAC structural integrity + duration checks.

FLAC integrity is checked by walking every frame and verifying the
per-frame error-detection codes that every FLAC encoder writes:

  - header CRC-8  (covers the whole frame header incl. sync code)
  - footer CRC-16 (covers the entire frame, header + audio data)

plus a completeness check: the last frame's sample number + block size
must equal the STREAMINFO total sample count, so truncated files fail.
Frame boundaries are located by scanning for the next sync code whose
header CRC-8 is valid — a false sync inside the audio payload fails the
CRC-8 check with overwhelming probability, so a genuine frame start is
almost never misidentified.

Duration comparison: mutagen (already a streamrip dependency) reads the
actual playtime; Qobuz metadata provides the official one (±2s tolerance).

Runs in a worker thread from download.py — never on the event loop.
"""

import mmap
import os
from typing import Optional

# --- CRC tables (FLAC polynomials, non-reflected, init 0) -------------------

def _crc8_table() -> list[int]:
    table = []
    for i in range(256):
        c = i
        for _ in range(8):
            c = ((c << 1) ^ 0x07) & 0xFF if c & 0x80 else (c << 1) & 0xFF
        table.append(c)
    return table


def _crc16_table() -> list[int]:
    table = []
    for i in range(256):
        c = i << 8
        for _ in range(8):
            c = ((c << 1) ^ 0x8005) & 0xFFFF if c & 0x8000 else (c << 1) & 0xFFFF
        table.append(c)
    return table


_CRC8 = _crc8_table()
_CRC16 = _crc16_table()


def _crc8(data: bytes) -> int:
    c = 0
    for b in data:
        c = _CRC8[(c ^ b) & 0xFF]
    return c


def _crc16(data: bytes) -> int:
    c = 0
    for b in data:
        c = ((c << 8) & 0xFFFF) ^ _CRC16[((c >> 8) ^ b) & 0xFF]
    return c


# --- FLAC parsing ------------------------------------------------------------

# Block size code (byte2 high nibble) -> samples per block. Codes 6/7 carry
# the value in the header; 0 is reserved/invalid.
_BLOCK_SIZES = {1: 192, 2: 576, 3: 1152, 4: 2304, 5: 4608}


def _decode_utf8_like(mm: mmap.mmap, i: int, n: int) -> Optional[tuple[int, int]]:
    """Decode FLAC's UTF-8-like frame/sample number. Returns (value, length)."""
    if i >= n:
        return None
    b0 = mm[i]
    if b0 & 0x80 == 0:
        return b0, 1
    if b0 & 0xE0 == 0xC0:
        ln, val = 2, b0 & 0x1F
    elif b0 & 0xF0 == 0xE0:
        ln, val = 3, b0 & 0x0F
    elif b0 & 0xF8 == 0xF0:
        ln, val = 4, b0 & 0x07
    elif b0 & 0xFC == 0xF8:
        ln, val = 5, b0 & 0x03
    elif b0 & 0xFE == 0xFC:
        ln, val = 6, b0 & 0x01
    elif b0 == 0xFE:
        ln, val = 7, 0
    else:
        return None
    if i + ln > n:
        return None
    for k in range(1, ln):
        if mm[i + k] & 0xC0 != 0x80:
            return None
        val = (val << 6) | (mm[i + k] & 0x3F)
    return val, ln


def _parse_frame_header(
    mm: mmap.mmap, p: int, n: int
) -> Optional[tuple[int, int, int, int]]:
    """Parse the frame header at p.

    Returns (header_length_without_crc, blocking_strategy, block_size,
    frame_or_sample_number) or None if invalid.
    """
    if p + 4 > n:
        return None
    b1 = mm[p + 1]
    if b1 & 0x02:  # reserved bit must be zero
        return None
    blocking = b1 & 0x01
    b2 = mm[p + 2]
    block_code = b2 >> 4
    rate_code = b2 & 0x0F
    if block_code == 0 or rate_code == 15:
        return None

    decoded = _decode_utf8_like(mm, p + 4, n)
    if decoded is None or decoded[1] > 6:
        return None
    number, ulen = decoded
    i = p + 4 + ulen

    if block_code == 6:
        if i + 1 > n:
            return None
        block_size = mm[i] + 1
        i += 1
    elif block_code == 7:
        if i + 2 > n:
            return None
        block_size = int.from_bytes(mm[i : i + 2], "big") + 1
        i += 2
    elif block_code < 6:
        block_size = _BLOCK_SIZES[block_code]
    else:
        block_size = 256 << (block_code - 8)

    if rate_code == 12:
        i += 1
    elif rate_code in (13, 14):
        i += 2
    if i > n:
        return None

    return i - p, blocking, block_size, number


def _find_next_frame(
    mm: mmap.mmap, start: int, n: int, frame_start: int, max_frame_size: int
) -> Optional[int]:
    """Scan for the next genuine frame start.

    A candidate sync code must pass three filters: a parseable header, a
    matching header CRC-8, AND a matching footer CRC-16 over the frame
    [frame_start : candidate-2]. The audio payload contains random bytes
    that occasionally look like sync codes — CRC-8 alone passes ~1/256 of
    those, which is far too loose for a 100KB frame. Adding the CRC-16
    check (1/65536) makes a false frame boundary essentially impossible,
    at ~2% extra scanning cost (CRC-8 filters almost all false candidates
    before the expensive CRC-16 runs).

    max_frame_size (from STREAMINFO) bounds how far a genuine next frame
    can be — once candidates exceed it the scan gives up immediately,
    which also keeps corrupted frames cheap to reject.
    """
    limit = frame_start + max_frame_size + 64
    i = mm.find(b"\xff", start)
    while i != -1 and i + 4 <= n:
        if i > limit:
            return None
        if (mm[i + 1] & 0xFC) == 0xF8:
            parsed = _parse_frame_header(mm, i, n)
            if parsed is not None:
                hlen = parsed[0]
                if i + hlen < n and _crc8(mm[i : i + hlen]) == mm[i + hlen]:
                    if i - 2 >= frame_start:
                        crc_end = i - 2
                        if _crc16(mm[frame_start:crc_end]) == int.from_bytes(
                            mm[crc_end:i], "big"
                        ):
                            return i
                    # CRC-16 mismatch: keep scanning past this false sync
        i = mm.find(b"\xff", i + 1)
    return None


def verify_flac(path: str) -> Optional[str]:
    """Structural integrity check. Returns an error description or None if OK."""
    try:
        f = open(path, "rb")
    except OSError as e:
        return f"cannot open: {e}"
    with f:
        if os.fstat(f.fileno()).st_size < 8:
            return "file too small to be FLAC"
        try:
            mm = mmap.mmap(f.fileno(), 0, access=mmap.ACCESS_READ)
        except ValueError:
            return "empty file"
        try:
            return _verify_flac_mm(mm)
        finally:
            mm.close()


def _verify_flac_mm(mm: mmap.mmap) -> Optional[str]:
    n = len(mm)
    if mm[:4] != b"fLaC":
        return "not a FLAC file"

    # Metadata blocks — find STREAMINFO (sample rate + total samples + max frame size).
    pos = 4
    total_samples: Optional[int] = None
    max_frame_size: Optional[int] = None
    while True:
        if pos + 4 > n:
            return "truncated metadata"
        last = mm[pos] >> 7
        btype = mm[pos] & 0x7F
        blen = int.from_bytes(mm[pos + 1 : pos + 4], "big")
        pos += 4
        if btype == 0 and blen >= 34:
            b = mm[pos : pos + 34]
            max_frame_size = int.from_bytes(b[7:10], "big")
            total_samples = ((b[13] & 0x0F) << 32) | int.from_bytes(b[14:18], "big")
        elif btype == 127:
            return "invalid metadata block"
        pos += blen
        if last:
            break
    if total_samples is None or total_samples == 0:
        return "missing STREAMINFO"
    if max_frame_size is None or max_frame_size == 0:
        max_frame_size = 1 << 24

    # Walk every frame, verifying header CRC-8 + footer CRC-16.
    p = pos
    fixed_block: Optional[int] = None  # fixed-block streams: the constant block size
    while True:
        if p >= n:
            return None
        if p + 2 > n:
            tail = mm[p:n]
            return None if (len(tail) <= 8 and not any(tail)) else "trailing garbage"
        if not (mm[p] == 0xFF and (mm[p + 1] & 0xFC) == 0xF8):
            return f"bad sync at offset {p}"
        parsed = _parse_frame_header(mm, p, n)
        if parsed is None:
            return f"bad frame header at offset {p}"
        hlen, blocking, block_size, number = parsed
        if p + hlen >= n:
            return "truncated frame header"
        if _crc8(mm[p : p + hlen]) != mm[p + hlen]:
            return f"frame header CRC-8 mismatch at offset {p}"
        body_start = p + hlen + 1
        if fixed_block is None and not blocking:
            fixed_block = block_size

        q = _find_next_frame(mm, body_start, n, p, max_frame_size)
        if q is None:
            # Last frame: its footer CRC-16 must be the final two bytes
            # (this also re-checks the CRC-16 that _find_next_frame
            # verified for every earlier frame).
            if n - 2 < body_start + 1:
                return "truncated frame"
            if _crc16(mm[p : n - 2]) != int.from_bytes(mm[n - 2 : n], "big"):
                return f"frame CRC-16 mismatch at offset {p}"
            if blocking:
                if number + block_size != total_samples:
                    return (
                        f"incomplete stream (variable-block): last frame at {p} "
                        f"sample {number} + {block_size} != {total_samples}"
                    )
            # Fixed-block streams may end with a SHORTER final block.
            if fixed_block is None or block_size > fixed_block:
                return (
                    f"incomplete stream (fixed-block): last frame at {p} "
                    f"block {block_size} > {fixed_block}"
                )
            if number * fixed_block + block_size != total_samples:
                return (
                    f"incomplete stream (fixed-block): last frame at {p} "
                    f"{number} x {fixed_block} + {block_size} != {total_samples}"
                )
            return None
        p = q


# --- Duration ----------------------------------------------------------------

def audio_duration(path: str) -> Optional[float]:
    """Playtime in seconds via mutagen, or None if unreadable."""
    try:
        import mutagen

        info = mutagen.File(path).info
        return float(info.length)
    except Exception:
        return None


def verify_audio(path: str, expected_duration: Optional[float] = None) -> Optional[str]:
    """Full check for one audio file. Returns an error description or None.

    FLAC gets the structural CRC walk; MP3 gets a duration check only
    (MP3 has no cheap integrity code). Duration is compared against the
    official Qobuz value when available (±2s tolerance).
    """
    ext = os.path.splitext(path)[1].lower()
    if ext == ".flac":
        err = verify_flac(path)
        if err:
            return f"corrupt FLAC ({err})"
    if expected_duration:
        actual = audio_duration(path)
        if actual is None:
            return "cannot read duration"
        if abs(actual - expected_duration) > 2:
            return (
                f"duration mismatch: actual {actual:.1f}s vs "
                f"official {expected_duration:.1f}s"
            )
    return None
