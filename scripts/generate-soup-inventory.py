"""Deterministic, local dependency inventory; not a CycloneDX or SPDX SBOM."""

import argparse
import hashlib
import json
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SOURCES = (
    "package.json",
    "pnpm-lock.yaml",
    "requirements.txt",
    "requirements-dev.txt",
    "backend/requirements.txt",
)


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes().replace(b"\r\n", b"\n")).hexdigest()


def lock_packages(path: Path) -> list[dict[str, str]]:
    in_packages = False
    entries: set[tuple[str, str]] = set()
    for line in path.read_text(encoding="utf-8").splitlines():
        if line == "packages:":
            in_packages = True
            continue
        if in_packages and line and not line.startswith(" "):
            break
        if not in_packages or not line.startswith("  ") or line.startswith("    "):
            continue
        if not line.endswith(":"):
            continue
        key = line[2:-1].strip().strip("'\"")
        if "@" not in key:
            raise ValueError(f"Unrecognized lockfile package key: {key}")
        name, version = key.rsplit("@", 1)
        if not name or not version:
            raise ValueError(f"Incomplete lockfile package key: {key}")
        entries.add((name, version))
    if not in_packages or not entries:
        raise ValueError("No packages found in pnpm lockfile")
    return [{"name": name, "version": version} for name, version in sorted(entries)]


def requirements(path: Path, relative_path: str) -> list[dict[str, str]]:
    entries = []
    for line in path.read_text(encoding="utf-8").splitlines():
        value = line.split(" #", 1)[0].strip()
        if value and not value.startswith("#"):
            entries.append({"manifest": relative_path, "requirement": value})
    return entries


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, help="Write deterministic UTF-8 JSON bytes to this path")
    args = parser.parse_args()
    package = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
    direct = [
        {"name": name, "specifier": specifier, "group": group}
        for group in ("dependencies", "devDependencies", "optionalDependencies")
        for name, specifier in package.get(group, {}).items()
    ]
    inventory = {
        "format": "handover-soup-inventory-v1",
        "source_sha256": {source: sha256(ROOT / source) for source in SOURCES},
        "javascript_direct": sorted(direct, key=lambda entry: (entry["group"], entry["name"])),
        "javascript_lock_packages": lock_packages(ROOT / "pnpm-lock.yaml"),
        "python_requirements": sorted(
            (entry for source in SOURCES[2:] for entry in requirements(ROOT / source, source)),
            key=lambda entry: (entry["manifest"], entry["requirement"]),
        ),
        "limits": [
            "Python manifests contain ranges and are not a resolved lockfile.",
            "Licenses, deployed reachability, downloaded tools and transitive Action code are not verified.",
        ],
    }
    content = (json.dumps(inventory, ensure_ascii=False, sort_keys=True, indent=2) + "\n").encode("utf-8")
    if args.output is None:
        sys.stdout.buffer.write(content)
    else:
        args.output.write_bytes(content)


if __name__ == "__main__":
    main()
