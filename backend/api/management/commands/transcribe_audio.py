from __future__ import annotations

from pathlib import Path

from asgiref.sync import async_to_sync
from django.core.management.base import BaseCommand, CommandError

from backend.ai_client import transcribe_audio


class _UploadedAudioFile:
    def __init__(self, path: Path):
        self._path = path
        self.filename = path.name

    def read(self) -> bytes:
        return self._path.read_bytes()


class Command(BaseCommand):
    help = "Transcribe a local audio file using the same AI pipeline as /api/ai/transcribe."

    def add_arguments(self, parser):
        parser.add_argument("file_path", type=str, help="Path to audio file (m4a, mp3, wav, ogg)")
        parser.add_argument("--language", type=str, default="es", help="Language hint (default: es)")

    def handle(self, *args, **options):
        path = Path(options["file_path"]).expanduser().resolve()
        language = (options.get("language") or "es").strip()

        if not path.exists() or not path.is_file():
            raise CommandError(f"Audio file not found: {path}")

        uploaded = _UploadedAudioFile(path)

        try:
            text = async_to_sync(transcribe_audio)(file=uploaded, language=language)
        except TypeError:
            text = async_to_sync(transcribe_audio)(uploaded, language)
        except Exception as exc:  # pragma: no cover
            raise CommandError(f"Transcription failed: {type(exc).__name__}") from exc

        self.stdout.write((text or "").strip())
