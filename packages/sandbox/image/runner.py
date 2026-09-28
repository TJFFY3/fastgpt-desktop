"""Trusted fixed-path supervisor; only untrusted commands run in the container."""
import json
import os
import signal
import subprocess
import sys
import time
import unicodedata


def processes():
    result = {}
    with os.scandir("/proc") as entries:
        for entry in entries:
            if not entry.name.isdigit():
                continue
            try:
                with open("/proc/" + entry.name + "/stat", encoding="utf-8") as f:
                    fields = f.read(4096).rsplit(")", 1)[1].split()
                if fields[0] != "Z":
                    result[entry.name] = fields[19]
            except FileNotFoundError:
                continue
            if len(result) > 128:
                raise RuntimeError("PID_LIMIT")
    return result


def integer(path):
    with open(path, encoding="ascii") as f:
        return int(f.read(256).strip())


def probe():
    with open("/proc/self/status", encoding="ascii") as f:
        status = dict(line.split(":", 1) for line in f.read(16384).splitlines() if ":" in line)
    with open("/sys/fs/cgroup/cpu.max", encoding="ascii") as f:
        quota, period = map(int, f.read(256).split())
    with open("/sys/fs/cgroup/memory.events", encoding="ascii") as f:
        events = dict(line.split() for line in f.read(4096).splitlines())

    def mount(path):
        s = os.statvfs(path)
        return {"bytes": s.f_blocks * s.f_frsize, "inodes": s.f_files,
                "nodev": bool(s.f_flag & os.ST_NODEV), "nosuid": bool(s.f_flag & os.ST_NOSUID),
                "noexec": bool(s.f_flag & os.ST_NOEXEC)}

    return {"uid": os.getuid(), "gid": os.getgid(), "noNewPrivs": int(status["NoNewPrivs"]),
            "seccomp": int(status["Seccomp"]), "memoryMax": integer("/sys/fs/cgroup/memory.max"),
            "swapMax": integer("/sys/fs/cgroup/memory.swap.max"),
            "pidsMax": integer("/sys/fs/cgroup/pids.max"), "cpuQuota": quota, "cpuPeriod": period,
            "oomKills": int(events["oom_kill"]), "workspace": mount("/workspace"), "tmp": mount("/tmp"),
            "rootReadonly": bool(os.statvfs("/").f_flag & os.ST_RDONLY),
            "pids": processes(), "selfPid": os.getpid()}


def enter_directory(path):
    if not path or len(path.encode("utf-8")) > 1024 or path != unicodedata.normalize("NFC", path):
        raise ValueError("INVALID_CWD")
    parts = [] if path == "." else path.split("/")
    if any(not p or p in (".", "..") or "\\" in p or p.endswith((".", " ")) or
           any(ord(c) < 32 or ord(c) == 127 for c in p) for p in parts):
        raise ValueError("INVALID_CWD")
    fd = os.open("/workspace", os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        for part in parts:
            child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
            os.close(fd)
            fd = child
        os.fchdir(fd)
    finally:
        os.close(fd)


def cleanup_background(baseline):
    # PID + start-time comparisons prevent accidentally signalling a reused PID.
    for sig, seconds in ((signal.SIGTERM, 0.2), (signal.SIGKILL, 3.0)):
        deadline = time.monotonic() + seconds
        while True:
            remaining = {pid: start for pid, start in processes().items() if baseline.get(pid) != start}
            if not remaining:
                return
            for pid, start in remaining.items():
                if processes().get(pid) != start:
                    continue
                try:
                    os.kill(int(pid), sig)
                except ProcessLookupError:
                    pass
            if time.monotonic() >= deadline:
                break
            time.sleep(0.02)
    raise RuntimeError("BACKGROUND_NOT_QUIESCENT")


def main():
    if len(sys.argv) == 2 and sys.argv[1] == "idle":
        signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))
        signal.signal(signal.SIGINT, lambda *_: sys.exit(0))
        while True:
            time.sleep(3600)
    if len(sys.argv) == 2 and sys.argv[1] == "probe":
        print(json.dumps(probe(), separators=(",", ":")))
        return 0
    if len(sys.argv) == 4 and sys.argv[1] == "command":
        command = sys.argv[3]
        if not command.strip() or len(command.encode("utf-8")) > 16384 or "\x00" in command:
            raise ValueError("INVALID_COMMAND")
        enter_directory(sys.argv[2])
        baseline = processes()
        child = subprocess.Popen(["/bin/sh", "-lc", command], stdin=subprocess.DEVNULL, close_fds=True)
        try:
            code = child.wait()
        finally:
            cleanup_background(baseline)
        return code if code >= 0 else 128 - code
    raise ValueError("UNSUPPORTED_OPERATION")


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (OSError, ValueError, RuntimeError):
        sys.stderr.write("SANDBOX_SUPERVISOR_FAILED\n")
        sys.exit(125)
