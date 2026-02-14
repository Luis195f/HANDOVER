"""Local pytest plugin to disable outbound sockets in CI/dev smoke runs.

Provides compatibility with `--disable-socket` and `--allow-hosts=...` options
without requiring the external pytest-socket dependency.
"""

from __future__ import annotations

import socket
from typing import Iterable


def pytest_addoption(parser):
    group = parser.getgroup("socket-control")
    group.addoption(
        "--disable-socket",
        action="store_true",
        default=False,
        help="Disable network sockets except allowed hosts.",
    )
    group.addoption(
        "--allow-hosts",
        action="store",
        default="",
        help="Comma-separated hosts allowed when --disable-socket is enabled.",
    )


def _is_allowed(host: str, allowed_hosts: Iterable[str]) -> bool:
    host = (host or "").strip().lower()
    if not host:
        return False
    return host in allowed_hosts


def pytest_configure(config):
    if not config.getoption("--disable-socket"):
        return

    allowed = {
        h.strip().lower()
        for h in str(config.getoption("--allow-hosts") or "").split(",")
        if h.strip()
    }

    original_connect = socket.socket.connect
    original_create_connection = socket.create_connection

    def guarded_connect(sock, address):
        host = address[0] if isinstance(address, tuple) and address else ""
        if not _is_allowed(host, allowed):
            raise OSError(f"Socket disabled by pytest (blocked host: {host!r})")
        return original_connect(sock, address)

    def guarded_create_connection(address, *args, **kwargs):
        host = address[0] if isinstance(address, tuple) and address else ""
        if not _is_allowed(host, allowed):
            raise OSError(f"Socket disabled by pytest (blocked host: {host!r})")
        return original_create_connection(address, *args, **kwargs)

    socket.socket.connect = guarded_connect
    socket.create_connection = guarded_create_connection
