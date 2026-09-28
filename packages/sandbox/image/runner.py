"""Trusted, read-only container supervisor. Command execution is added separately."""
import signal
import sys
import time

if len(sys.argv) != 2 or sys.argv[1] != "idle":
    sys.stderr.write("UNSUPPORTED_OPERATION\n")
    sys.exit(2)
signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))
signal.signal(signal.SIGINT, lambda *_: sys.exit(0))
while True:
    time.sleep(3600)
