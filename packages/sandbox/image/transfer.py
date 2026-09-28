"""Fixed bounded file transport; never archives or follows filesystem links."""
import hashlib
import json
import os
import re
import stat
import struct
import sys
import unicodedata

ROOT = "/workspace"
CHUNK = 65536
MAX_FILE = 100 * 1024 * 1024
MAX_TOTAL = 1024 ** 3
seen = set()
count = 0
total = 0


def path_ok(path):
    if not isinstance(path, str) or not path or len(path.encode("utf8")) > 1024 or path != unicodedata.normalize("NFC", path):
        raise ValueError()
    if any(ord(c) < 32 or ord(c) == 127 or c in "\\:" for c in path):
        raise ValueError()
    for part in path.split("/"):
        if not part or part in (".", "..") or len(part.encode("utf8")) > 255 or part[-1] in ". " or re.match(r"^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)", part, re.I):
            raise ValueError()
    return path


def account(entry):
    global count, total
    if set(entry) != {"relativePath", "kind", "size", "sha256"}:
        raise ValueError()
    path = path_ok(entry["relativePath"])
    if path.lower() in seen or type(entry["size"]) is not int or not 0 <= entry["size"] <= MAX_FILE:
        raise ValueError()
    if entry["kind"] == "directory":
        if entry["size"] != 0 or entry["sha256"] is not None:
            raise ValueError()
    elif entry["kind"] != "file" or not isinstance(entry["sha256"], str) or not re.fullmatch("[a-f0-9]{64}", entry["sha256"]):
        raise ValueError()
    seen.add(path.lower())
    count += 1
    total += entry["size"]
    if count > 10000 or total > MAX_TOTAL:
        raise ValueError()


def exact(size):
    parts = bytearray()
    while len(parts) < size:
        data = sys.stdin.buffer.read(size - len(parts))
        if not data:
            raise ValueError()
        parts.extend(data)
    return parts


def header(value):
    data = json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf8")
    if len(data) > 4096:
        raise ValueError()
    sys.stdout.buffer.write(struct.pack(">I", len(data)))
    sys.stdout.buffer.write(data)


def parent(root, path):
    parts = path_ok(path).split("/")
    fd = os.dup(root)
    try:
        for part in parts[:-1]:
            child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
            os.close(fd)
            fd = child
        return fd, parts[-1]
    except BaseException:
        os.close(fd)
        raise


def import_files(root):
    while True:
        size = struct.unpack(">I", exact(4))[0]
        if not 0 < size <= 4096:
            raise ValueError()
        value = json.loads(exact(size).decode("utf8"))
        if value == {"type": "end"}:
            if sys.stdin.buffer.read(1):
                raise ValueError()
            return
        if not isinstance(value, dict) or set(value) != {"type", "entry"} or value["type"] != "entry":
            raise ValueError()
        entry = value["entry"]
        account(entry)
        fd, name = parent(root, entry["relativePath"])
        try:
            if entry["kind"] == "directory":
                os.mkdir(name, 0o700, dir_fd=fd)
            else:
                out = os.open(name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=fd)
                digest = hashlib.sha256()
                remaining = entry["size"]
                try:
                    while remaining:
                        chunk = exact(min(remaining, CHUNK))
                        digest.update(chunk)
                        offset = 0
                        while offset < len(chunk):
                            written = os.write(out, chunk[offset:])
                            if not written:
                                raise ValueError()
                            offset += written
                        remaining -= len(chunk)
                    if digest.hexdigest() != entry["sha256"]:
                        raise ValueError()
                    os.fsync(out)
                finally:
                    os.close(out)
        finally:
            os.close(fd)


def version(s):
    return (s.st_dev, s.st_ino, s.st_size, s.st_mtime_ns, s.st_ctime_ns, s.st_nlink)


def unchanged(fd, before, parent_fd, name):
    if version(os.fstat(fd)) != version(before) or version(os.stat(name, dir_fd=parent_fd, follow_symlinks=False)) != version(before):
        raise ValueError()


def export_files(root, prefix="", device=None):
    before = os.fstat(root)
    device = before.st_dev if device is None else device
    with os.scandir(root) as entries:
        for e in entries:
            path = path_ok(prefix + e.name)
            s = os.stat(e.name, dir_fd=root, follow_symlinks=False)
            if s.st_dev != device:
                raise ValueError()
            if stat.S_ISDIR(s.st_mode):
                entry = {"relativePath": path, "kind": "directory", "size": 0, "sha256": None}
                account(entry)
                fd = os.open(e.name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=root)
                try:
                    if os.fstat(fd).st_ino != s.st_ino:
                        raise ValueError()
                    header({"type": "entry", "entry": entry})
                    export_files(fd, path + "/", device)
                finally:
                    os.close(fd)
            elif stat.S_ISREG(s.st_mode) and s.st_nlink == 1 and s.st_size <= MAX_FILE:
                fd = os.open(e.name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=root)
                try:
                    actual = os.fstat(fd)
                    if version(actual) != version(s) or not stat.S_ISREG(actual.st_mode):
                        raise ValueError()
                    entry = {"relativePath": path, "kind": "file", "size": s.st_size, "sha256": "0" * 64}
                    account(entry)
                    digest = hashlib.sha256()
                    size = 0
                    while True:
                        data = os.read(fd, CHUNK)
                        if not data:
                            break
                        size += len(data)
                        if size > MAX_FILE:
                            raise ValueError()
                        digest.update(data)
                    unchanged(fd, s, root, e.name)
                    if size != s.st_size:
                        raise ValueError()
                    entry["sha256"] = digest.hexdigest()
                    header({"type": "entry", "entry": entry})
                    os.lseek(fd, 0, os.SEEK_SET)
                    remaining = size
                    while remaining:
                        data = os.read(fd, min(CHUNK, remaining))
                        if not data:
                            raise ValueError()
                        sys.stdout.buffer.write(data)
                        remaining -= len(data)
                    unchanged(fd, s, root, e.name)
                finally:
                    os.close(fd)
            else:
                raise ValueError()
    after = os.fstat(root)
    if (before.st_dev, before.st_ino, before.st_mtime_ns, before.st_ctime_ns) != (after.st_dev, after.st_ino, after.st_mtime_ns, after.st_ctime_ns):
        raise ValueError()


try:
    if len(sys.argv) != 2 or sys.argv[1] not in ("import", "export"):
        raise ValueError()
    root = os.open(ROOT, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        if sys.argv[1] == "import":
            import_files(root)
        else:
            export_files(root)
            header({"type": "end"})
            sys.stdout.buffer.flush()
    finally:
        os.close(root)
except Exception:
    sys.stderr.write("TRANSFER_INVALID\n")
    sys.exit(2)
