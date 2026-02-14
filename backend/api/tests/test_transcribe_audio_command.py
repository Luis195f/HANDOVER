from __future__ import annotations

from pathlib import Path

import pytest
from django.core.management import call_command
from django.core.management.base import CommandError


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
