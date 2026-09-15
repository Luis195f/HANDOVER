from __future__ import annotations

import os
from pathlib import Path

from asgiref.sync import async_to_sync
from django.core.management.base import BaseCommand, CommandError

from backend.ai_client import is_openai_enabled, transcribe_audio


ALLOWED_AUDIO_SUFFIXES = {".aac", ".m4a", ".mp4", ".mp3", ".mpeg", ".ogg", ".wav", ".webm"}
DEFAULT_MAX_AUDIO_BYTES = 25 * 1024 * 1024


class _UploadedAudioFile:
    def __init__(self, path: Path):
        self._path = path
        self.filename = path.name

    def read(self) -> bytes:
        return self._path.read_bytes()


class Command(BaseCommand):
    help = "@deprecated Transcribe local audio; removal is scheduled for C19B."

    def add_arguments(self, parser):
        parser.add_argument("file_path", type=str, help="Path to audio file (m4a, mp3, wav, ogg)")
        parser.add_argument("--language", type=str, default="es", help="Language hint (default: es)")

    def handle(self, *args, **options):
        path = Path(options["file_path"]).expanduser().resolve()
        language = (options.get("language") or "es").strip()

        if not path.exists() or not path.is_file():
            raise CommandError("Audio file not found.")
        if path.suffix.lower() not in ALLOWED_AUDIO_SUFFIXES:
            raise CommandError("Unsupported audio format.")
        try:
            max_bytes = int(os.getenv("HANDOVER_MAX_AUDIO_BYTES", DEFAULT_MAX_AUDIO_BYTES))
        except ValueError as exc:
            raise CommandError("Invalid audio size configuration.") from exc
        if path.stat().st_size <= 0 or path.stat().st_size > max_bytes:
            raise CommandError("Audio file size is outside the allowed range.")
        if not is_openai_enabled():
            raise CommandError("External AI transcription is disabled.")

        uploaded = _UploadedAudioFile(path)

        try:
            text = async_to_sync(transcribe_audio)(file=uploaded, language=language)
        except TypeError:
            text = async_to_sync(transcribe_audio)(uploaded, language)
        except Exception as exc:  # pragma: no cover
            raise CommandError("Transcription failed.") from exc

        self.stdout.write((text or "").strip())
