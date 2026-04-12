from __future__ import annotations

import json
import os
import shutil
import sqlite3
import subprocess
import sys
import tempfile
from pathlib import Path

from django.test import SimpleTestCase


REPO_ROOT = Path(__file__).resolve().parents[3]


class BackupAndPerfSmokeScriptTests(SimpleTestCase):
    maxDiff = None

    def _base_env(self) -> dict[str, str]:
        env = os.environ.copy()
        env.setdefault("PYTHONPATH", str(REPO_ROOT))
        env.setdefault("SECRET_KEY", "test-secret")
        env.setdefault("DJANGO_DEBUG", "false")
        env.setdefault("HANDOVER_DEPLOYMENT_MODE", "test")
        env.setdefault("HANDOVER_ALLOWED_ORIGINS", "http://localhost:3000")
        env.pop("PYTEST_CURRENT_TEST", None)
        return env

    def _run_python(self, *args: str, env: dict[str, str]) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [sys.executable, *args],
            cwd=REPO_ROOT,
            env=env,
            capture_output=True,
            text=True,
        )

    def _looks_like_problematic_windows_bash(self, candidate: str) -> bool:
        normalized = str(Path(candidate)).lower().replace("/", "\\")
        return (
            normalized.endswith("\\windows\\system32\\bash.exe")
            or "\\windowsapps\\bash.exe" in normalized
        )

    def _git_bash_candidates(self) -> list[str]:
        if os.name != "nt":
            return []
        git_executable = shutil.which("git")
        if not git_executable:
            return []
        git_root = Path(git_executable).resolve().parent.parent
        candidates: list[str] = []
        for relative_path in ("bin/bash.exe", "usr/bin/bash.exe"):
            candidate = git_root / relative_path
            if candidate.exists():
                candidates.append(str(candidate))
        return candidates

    def _resolve_bash(self) -> str:
        override = os.environ.get("HANDOVER_TEST_BASH")
        if override:
            resolved_override = shutil.which(override) or (override if Path(override).exists() else None)
            if resolved_override:
                return resolved_override
            self.skipTest(
                f"HANDOVER_TEST_BASH is set but not executable: {override}"
            )

        path_entries = os.environ.get("PATH", "").split(os.pathsep)
        candidates: list[str] = []
        for entry in path_entries:
            if not entry:
                continue
            entry_path = Path(entry)
            for name in ("bash.exe", "bash"):
                candidate = entry_path / name
                if candidate.exists():
                    candidates.append(str(candidate))

        if candidates:
            candidates.extend(self._git_bash_candidates())
            candidates = list(dict.fromkeys(candidates))
            non_shim_candidates = [
                candidate for candidate in candidates if not self._looks_like_problematic_windows_bash(candidate)
            ]
            if non_shim_candidates:
                return non_shim_candidates[0]
            if os.name != "nt":
                return candidates[0]

        resolved = shutil.which("bash")
        if resolved and not (os.name == "nt" and self._looks_like_problematic_windows_bash(resolved)):
            return resolved

        self.skipTest(
            "A usable bash executable is not available. Install bash, expose Git Bash in PATH, or set HANDOVER_TEST_BASH."
        )

    def _run_bash_script(self, script_path: str, env: dict[str, str]) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [self._resolve_bash(), script_path],
            cwd=REPO_ROOT,
            env=env,
            capture_output=True,
            text=True,
        )

    def _create_sqlite_fixture(self, db_path: Path) -> None:
        connection = sqlite3.connect(db_path)
        try:
            connection.execute("CREATE TABLE sample (id INTEGER PRIMARY KEY, value TEXT NOT NULL)")
            connection.execute("INSERT INTO sample (value) VALUES (?)", ("seed",))
            connection.commit()
        finally:
            connection.close()

    def test_perf_smoke_forces_ephemeral_sqlite_by_default(self):
        env = self._base_env()
        env["DJANGO_DB_ENGINE"] = "django.db.backends.postgresql"
        env["DJANGO_DB_NAME"] = "live-preprod-db"

        result = self._run_python("scripts/perf-smoke.py", "--iterations", "1", "--json", env=env)

        self.assertEqual(result.returncode, 0, msg=result.stderr)
        payload = json.loads(result.stdout)
        database = payload["database"]
        self.assertTrue(database["ephemeral"])
        self.assertEqual(database["engine"], "django.db.backends.sqlite3")
        self.assertNotEqual(database["name"], "live-preprod-db")
        self.assertIn("handover-perf-smoke-", database["name"])
        self.assertIn("ignored unless the dangerous override is enabled", database["note"])
        measured = {item["scenario"] for item in payload["measured"]}
        self.assertEqual(
            measured,
            {"fhir_transaction_synthetic", "icea_dashboard_summary", "icea_ops_summary"},
        )

    def test_backup_db_fails_closed_without_plaintext_artifacts_when_encryption_required(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_root = Path(temp_dir)
            db_path = temp_root / "fixture.sqlite3"
            backup_root = temp_root / "backups"
            self._create_sqlite_fixture(db_path)

            env = self._base_env()
            env["BACKUP_DIR"] = str(backup_root)
            env["BACKUP_SKIP_REMOTE"] = "true"
            env["BACKUP_REQUIRE_ENCRYPTION"] = "true"
            env["DJANGO_DB_ENGINE"] = "django.db.backends.sqlite3"
            env["DJANGO_DB_NAME"] = str(db_path)

            result = self._run_bash_script("scripts/backup-db.sh", env=env)

            self.assertNotEqual(result.returncode, 0)
            self.assertIn("BACKUP_ENCRYPTION_PASSPHRASE is required", result.stdout + result.stderr)
            self.assertEqual(list(backup_root.rglob("*")), [])

    def test_backup_media_fails_closed_without_plaintext_artifacts_when_encryption_required(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_root = Path(temp_dir)
            media_root = temp_root / "uploads"
            backup_root = temp_root / "backups"
            media_root.mkdir(parents=True)
            (media_root / "attachment.txt").write_text("synthetic attachment", encoding="utf-8")

            env = self._base_env()
            env["BACKUP_DIR"] = str(backup_root)
            env["BACKUP_SKIP_REMOTE"] = "true"
            env["BACKUP_REQUIRE_ENCRYPTION"] = "true"
            env["MEDIA_DIR"] = str(media_root)

            result = self._run_bash_script("scripts/backup-media.sh", env=env)

            self.assertNotEqual(result.returncode, 0)
            self.assertIn("BACKUP_ENCRYPTION_PASSPHRASE is required", result.stdout + result.stderr)
            self.assertEqual(list(backup_root.rglob("*")), [])

    def test_backup_db_still_writes_encrypted_artifact_and_checksum(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_root = Path(temp_dir)
            db_path = temp_root / "fixture.sqlite3"
            backup_root = temp_root / "backups"
            self._create_sqlite_fixture(db_path)

            env = self._base_env()
            env["BACKUP_DIR"] = str(backup_root)
            env["BACKUP_SKIP_REMOTE"] = "true"
            env["BACKUP_REQUIRE_ENCRYPTION"] = "true"
            env["BACKUP_ENCRYPTION_PASSPHRASE"] = "local-drill-passphrase"
            env["DJANGO_DB_ENGINE"] = "django.db.backends.sqlite3"
            env["DJANGO_DB_NAME"] = str(db_path)

            result = self._run_bash_script("scripts/backup-db.sh", env=env)

            self.assertEqual(result.returncode, 0, msg=result.stdout + result.stderr)
            encrypted_artifacts = list(backup_root.glob("backup_*.sqlite3.gz.gpg"))
            checksums = list(backup_root.glob("backup_*.sqlite3.gz.gpg.sha256"))
            plaintext_archives = list(backup_root.glob("backup_*.sqlite3.gz"))
            self.assertEqual(len(encrypted_artifacts), 1)
            self.assertEqual(len(checksums), 1)
            self.assertEqual(plaintext_archives, [])
