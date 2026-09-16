from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

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


@pytest.mark.django_db
def test_transcribe_audio_command_sends_only_server_filename(monkeypatch, tmp_path: Path, caplog):
    from backend import ai_client

    audio = tmp_path / "patient.sensitive.name.mp3"
    audio.write_bytes(b"fake-audio")
    provider_calls = []

    def fake_create(**kwargs):
        provider_calls.append(kwargs)
        return SimpleNamespace(text="texto transcrito")

    monkeypatch.setattr(ai_client, "get_client", lambda: SimpleNamespace(audio=SimpleNamespace(transcriptions=SimpleNamespace(create=fake_create))))

    call_command("transcribe_audio", str(audio), "--language", "es")

    assert len(provider_calls) == 1
    assert provider_calls[0]["file"].name == "audio_input.mp3"
    assert "patient.sensitive.name" not in caplog.text


def test_transcribe_audio_command_rejects_unsupported_suffix_before_provider(monkeypatch, tmp_path: Path, caplog):
    from backend import ai_client

    audio = tmp_path / "PHI-audio.invalid"
    audio.write_bytes(b"fake-audio")
    provider_calls = []
    monkeypatch.setattr(ai_client, "get_client", lambda: provider_calls.append(True))

    with pytest.raises(CommandError, match="Unsupported audio format"):
        call_command("transcribe_audio", str(audio), "--language", "es")

    assert provider_calls == []
    assert "PHI-audio" not in caplog.text
