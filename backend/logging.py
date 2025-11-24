import logging
import re
from typing import Any

SENSITIVE_KEYS = {"user_id", "user", "fullName", "full_name", "patient", "patient_id"}


def _mask_value(value: Any) -> Any:
    if isinstance(value, str):
        return "****"
    if isinstance(value, (int, float)):
        return 0
    if value is None:
        return None
    return "****"


class RemovePersonalDataFilter(logging.Filter):
    patterns = [
        (re.compile(r"Patient/[A-Za-z0-9\-]+", re.IGNORECASE), "Patient/****"),
        (re.compile(r"fullName\s*:\s*['\"]([^'\"]+)['\"]", re.IGNORECASE), "fullName:'****'"),
        (re.compile(r"user_id\s*[:=]\s*['\"]?([A-Za-z0-9\-]+)['\"]?", re.IGNORECASE), "user_id=****"),
    ]

    def sanitize_text(self, text: Any) -> Any:
        if not isinstance(text, str):
            return text

        cleaned = text
        for pattern, repl in self.patterns:
            cleaned = pattern.sub(repl, cleaned)
        return cleaned

    def sanitize_args(self, args: Any) -> Any:
        if isinstance(args, (list, tuple)):
            return type(args)(self.sanitize_text(a) for a in args)
        return args

    def sanitize_extras(self, record: logging.LogRecord) -> None:
        for key in list(record.__dict__.keys()):
            if key in {"msg", "args", "levelname", "levelno", "pathname", "lineno", "exc_info", "exc_text"}:
                continue
            if key in SENSITIVE_KEYS:
                record.__dict__[key] = _mask_value(record.__dict__[key])
            else:
                record.__dict__[key] = self.sanitize_text(record.__dict__[key])

    def filter(self, record: logging.LogRecord) -> bool:
        record.msg = self.sanitize_text(record.getMessage())
        record.args = ()
        self.sanitize_extras(record)
        return True
