import hmac
import json
from hashlib import sha256
from typing import Any


def canonical_json(obj: Any) -> bytes:
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def hash_payload(obj: Any, secret: str) -> str:
    payload = canonical_json(obj)
    return hmac.new(secret.encode("utf-8"), payload, sha256).hexdigest()
