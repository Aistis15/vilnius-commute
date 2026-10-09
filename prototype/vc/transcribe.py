"""Lithuanian speech to text on this computer, with Whisper.

An iPhone has no Lithuanian recogniser at all: Safari's SpeechRecognition,
keyboard dictation and SFSpeechRecognizer all lack lt-LT. So inside the
phone shells the page records the words (MediaRecorder) and sends them
here (/api/transcribe); this answers with the text, and the page carries on
as if the browser had heard it.

Needs `pip3 install faster-whisper`. The model (VC_WHISPER, "small" by
default, ~480 MB) is downloaded on first use and kept; the server loads it
in the background at start, so the first question does not wait for it.
"""

from __future__ import annotations

import os
import tempfile
import threading

MODEL = os.environ.get("VC_WHISPER", "small")
# Words Whisper should expect: how a trip is asked for, and place names it
# would otherwise spell as common words.
PROMPT = ("Man reikia į Akropolį keturiolika dvidešimt. Noriu būti OZE iki antros. "
          "ISM, OZAS, Akropolis, Katedros aikštė, Gedimino prospektas, Stotis, Žirmūnai.")

_model = None
_error: str | None = None
_lock = threading.Lock()


def available() -> bool:
    try:
        import faster_whisper  # noqa: F401
    except ImportError:
        return False
    return _error is None


def _load():
    global _model, _error
    with _lock:
        if _model is None and _error is None:
            try:
                from faster_whisper import WhisperModel
                _model = WhisperModel(MODEL, device="cpu", compute_type="int8")
            except Exception as error:  # noqa: BLE001 - said once, in the reply
                _error = str(error)
    return _model


def preload() -> None:
    """Loads the model in the background, when faster-whisper is installed."""
    if available():
        threading.Thread(target=_load, daemon=True).start()


def transcribe(audio: bytes, suffix: str = ".mp4") -> str:
    """The words in a short recording (any format ffmpeg reads)."""
    model = _load()
    if model is None:
        raise RuntimeError(_error or "Whisper nepasiekiamas.")
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as file:
        file.write(audio)
        path = file.name
    try:
        segments, _info = model.transcribe(path, language="lt", initial_prompt=PROMPT,
                                           beam_size=5, vad_filter=True)
        return " ".join(segment.text.strip() for segment in segments).strip()
    finally:
        os.unlink(path)
