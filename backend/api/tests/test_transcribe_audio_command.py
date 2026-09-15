from __future__ import annotations

from pathlib import Path

import pytest
from django.core.management import call_command
from django.core.management.base import CommandError


@pytest.fixture(autouse=True)
def _enable_external_ai_for_existing_tests(monkeypatch):
    monkeypatch.setenv("HANDOVER_AI_ENABLED", "true")
    monkeypatch.setenv("HANDOVER_EXTERNAL_CLINICAL_AI_ENABLED", "true")
    monkeypatch.setenv("HANDOVER_OPENAI_DISABLED", "false")
    monkeypatch.setenv("HANDOVER_DEPLOYMENT_MODE", "test")


@pytest.mark.django_db
def test_transcribe_audio_command_writes_text(monkeypatch, tmp_path: Path, capsys):
    audio = tmp_path / "note.m4a"
    audio.write_bytes(b"fake-audio")

    async def _fake_transcribe(*args, **kwargs):
        return "texto transcrito"

    monkeypatch.setattr("backend.api.management.commands.transcribe_audio.transcribe_audio", _fake_transcribe)

    call_command("transcribe_audio", str(audio), "--language", "es")
    captured = capsys.readouterr()

    assert "texto transcrito" in captured.out


@pytest.mark.django_db
def test_transcribe_audio_command_missing_file_raises():
    with pytest.raises(CommandError):
        call_command("transcribe_audio", "/tmp/does-not-exist.m4a")


@pytest.mark.django_db
def test_transcribe_audio_command_respects_external_ai_gate(monkeypatch, tmp_path: Path):
    audio = tmp_path / "note.m4a"
    audio.write_bytes(b"fake-audio")
    calls = 0

    async def _unexpected_transcribe(*_args, **_kwargs):
        nonlocal calls
        calls += 1
        raise AssertionError("CLI must not bypass the external AI gate")

    monkeypatch.setenv("HANDOVER_EXTERNAL_CLINICAL_AI_ENABLED", "false")
    monkeypatch.setattr("backend.api.management.commands.transcribe_audio.transcribe_audio", _unexpected_transcribe)

    with pytest.raises(CommandError, match="disabled"):
        call_command("transcribe_audio", str(audio), "--language", "es")

    assert calls == 0


def test_transcribe_audio_command_is_marked_deprecated():
    from backend.api.management.commands.transcribe_audio import Command

    assert "@deprecated" in Command.help
