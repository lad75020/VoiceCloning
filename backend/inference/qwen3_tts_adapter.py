"""Qwen3 TTS reference-voice cloning adapter.

The adapter keeps network transcription and model loading in small helpers so
they can be contract-tested without an Apple Metal/MPS runtime, model weights,
or an MCP server.
"""

import argparse
import base64
import gc
import json
import math
import re
import sys
from pathlib import Path
from urllib.request import Request, urlopen


DEFAULT_MODEL_ID = "Qwen/Qwen3-TTS-12Hz-1.7B-Base"
DEFAULT_DEVICE_MAP = "mps"
DEFAULT_DTYPE = "float16"
DEFAULT_ATTN_IMPLEMENTATION = "sdpa"
DEFAULT_WHISPER_MCP_URL = "https://whisper.dubertrand.fr/mcp"
DEFAULT_WHISPER_TIMEOUT_SECONDS = 120.0
DEFAULT_MAX_NEW_TOKENS = 128
DEFAULT_MAX_CHARS_PER_CHUNK = 120
MAX_MAX_NEW_TOKENS = 128
MAX_MAX_CHARS_PER_CHUNK = 120
MAX_WHISPER_TIMEOUT_SECONDS = 600.0
WHISPER_MCP_USER_AGENT = "VoiceCloning/1.0 (+https://github.com/lad75020/VoiceCloning)"
QWEN_LANGUAGES = {"en": "English", "fr": "French", "es": "Spanish"}


def positive_int(value: object) -> int:
    """Parse a strictly positive integer for bounded generation settings."""
    if isinstance(value, bool):
        raise argparse.ArgumentTypeError("must be a positive integer")
    if isinstance(value, int):
        parsed = value
    elif isinstance(value, str):
        try:
            parsed = int(value)
        except ValueError as exc:
            raise argparse.ArgumentTypeError("must be a positive integer") from exc
    else:
        raise argparse.ArgumentTypeError("must be a positive integer")
    if parsed <= 0:
        raise argparse.ArgumentTypeError("must be a positive integer")
    return parsed


def bounded_positive_int(value: object, maximum: int, label: str) -> int:
    parsed = positive_int(value)
    if parsed > maximum:
        raise argparse.ArgumentTypeError(f"{label} must be at most {maximum}")
    return parsed


def bounded_positive_float(value: object, maximum: float, label: str) -> float:
    try:
        parsed = float(value)
    except (TypeError, ValueError) as exc:
        raise argparse.ArgumentTypeError(f"{label} must be a positive finite number") from exc
    if not math.isfinite(parsed) or parsed <= 0 or parsed > maximum:
        raise argparse.ArgumentTypeError(
            f"{label} must be greater than zero and at most {maximum:g}"
        )
    return parsed


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run Qwen3 TTS reference-voice cloning.")
    parser.add_argument("--text", required=True)
    parser.add_argument("--language", required=True, choices=sorted(QWEN_LANGUAGES))
    parser.add_argument("--ref-audio", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--model", default=DEFAULT_MODEL_ID)
    parser.add_argument("--device-map", default=DEFAULT_DEVICE_MAP)
    parser.add_argument("--dtype", default=DEFAULT_DTYPE)
    parser.add_argument("--attn-implementation", default=DEFAULT_ATTN_IMPLEMENTATION)
    parser.add_argument("--whisper-mcp-url", default=DEFAULT_WHISPER_MCP_URL)
    parser.add_argument(
        "--whisper-timeout-seconds",
        type=lambda value: bounded_positive_float(
            value, MAX_WHISPER_TIMEOUT_SECONDS, "whisper timeout"
        ),
        default=DEFAULT_WHISPER_TIMEOUT_SECONDS,
    )
    parser.add_argument(
        "--max-new-tokens",
        type=lambda value: bounded_positive_int(
            value, MAX_MAX_NEW_TOKENS, "max new tokens"
        ),
        default=DEFAULT_MAX_NEW_TOKENS,
    )
    parser.add_argument(
        "--max-chars-per-chunk",
        type=lambda value: bounded_positive_int(
            value, MAX_MAX_CHARS_PER_CHUNK, "max chars per chunk"
        ),
        default=DEFAULT_MAX_CHARS_PER_CHUNK,
    )
    return parser.parse_args(argv)


def qwen_language(language: str) -> str:
    try:
        return QWEN_LANGUAGES[language.strip().lower()]
    except (AttributeError, KeyError) as exc:
        raise RuntimeError("Qwen3 TTS supports only en, fr, or es output language codes.") from exc


def build_transcribe_request(reference_wav: str) -> bytes:
    encoded_audio = base64.b64encode(Path(reference_wav).read_bytes()).decode("ascii")
    payload = {
        "jsonrpc": "2.0",
        "id": "qwen3-tts-transcribe",
        "method": "tools/call",
        "params": {
            "name": "transcribe",
            "arguments": {
                "type": "transcribe",
                "language": "auto",
                "audio": f"data:audio/wav;base64,{encoded_audio}",
            },
        },
    }
    return json.dumps(payload).encode("utf-8")


def _json_payloads_from_mcp_response(response_text: str) -> list[object]:
    """Parse JSON or SSE data records returned by a stateless MCP endpoint."""
    text = response_text.lstrip("\ufeff").strip()
    if not text:
        raise RuntimeError("Whisper MCP returned an empty response.")

    payloads = []
    if text.startswith("data:") or "\ndata:" in text:
        for event in text.replace("\r\n", "\n").replace("\r", "\n").split("\n\n"):
            data_lines = [line[5:].lstrip() for line in event.split("\n") if line.startswith("data:")]
            if not data_lines:
                continue
            payloads.append(json.loads("\n".join(data_lines)))
    else:
        payloads.append(json.loads(text))
    if not payloads:
        raise RuntimeError("Whisper MCP response contained no JSON data events.")
    return payloads


def extract_tool_text(response_text: str) -> str:
    """Return non-empty MCP tool text and turn JSON-RPC/tool errors into failures."""
    text_parts = []
    for payload in _json_payloads_from_mcp_response(response_text):
        if not isinstance(payload, dict):
            continue
        if payload.get("error"):
            raise RuntimeError(f"Whisper MCP error: {payload['error']}")
        result = payload.get("result")
        if not isinstance(result, dict):
            continue
        if result.get("isError"):
            raise RuntimeError(f"Whisper MCP tool error: {result}")
        content = result.get("content")
        if not isinstance(content, list):
            continue
        for item in content:
            if isinstance(item, dict) and item.get("type") == "text" and isinstance(item.get("text"), str):
                value = item["text"].strip()
                if value:
                    text_parts.append(value)
    transcript = "\n".join(text_parts).strip()
    if not transcript:
        raise RuntimeError("Whisper MCP returned an empty transcript.")
    return transcript


def transcribe_reference_audio(
    reference_wav: str,
    mcp_url: str,
    timeout_seconds: float,
    *,
    open_url=urlopen,
) -> str:
    request = Request(
        mcp_url,
        data=build_transcribe_request(reference_wav),
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json, text/event-stream",
            "MCP-Protocol-Version": "2025-03-26",
            # Cloudflare rejects urllib's default Python user agent on the
            # deployed endpoint, so identify this application explicitly.
            "User-Agent": WHISPER_MCP_USER_AGENT,
        },
        method="POST",
    )
    try:
        with open_url(request, timeout=timeout_seconds) as response:
            response_text = response.read().decode("utf-8")
    except Exception as exc:
        raise RuntimeError(f"Whisper MCP transcription request failed: {exc}") from exc
    return extract_tool_text(response_text)


def load_model(model_id: str, device_map: str, dtype_name: str, attn_implementation: str, *, torch_module=None, model_class=None):
    if torch_module is None:
        try:
            import torch as torch_module
        except ImportError as exc:
            raise RuntimeError("torch is required in the Qwen3 TTS Conda environment.") from exc
    if model_class is None:
        try:
            from qwen_tts import Qwen3TTSModel
        except ImportError as exc:
            raise RuntimeError("qwen-tts is required in the Qwen3 TTS Conda environment.") from exc
        model_class = Qwen3TTSModel
    try:
        dtype = getattr(torch_module, dtype_name)
    except AttributeError as exc:
        raise RuntimeError(f"torch does not provide requested dtype '{dtype_name}'.") from exc
    return model_class.from_pretrained(
        model_id,
        device_map=device_map,
        dtype=dtype,
        attn_implementation=attn_implementation,
    )


def normalize_text(text: str) -> str:
    """Collapse whitespace so each generation chunk has a predictable size."""
    return " ".join(text.split())


def split_text_into_chunks(text: str, max_chars_per_chunk: int = DEFAULT_MAX_CHARS_PER_CHUNK) -> list[str]:
    """Split normalized text at sentence or whitespace boundaries without exceeding the cap."""
    max_chars_per_chunk = bounded_positive_int(
        max_chars_per_chunk, MAX_MAX_CHARS_PER_CHUNK, "max chars per chunk"
    )
    remaining = normalize_text(text)
    chunks = []

    while remaining:
        if len(remaining) <= max_chars_per_chunk:
            chunks.append(remaining)
            break

        prefix = remaining[:max_chars_per_chunk]
        sentence_boundaries = list(re.finditer(r"[.!?]+(?=\s|$)", prefix))
        if sentence_boundaries:
            split_at = sentence_boundaries[-1].end()
        else:
            split_at = prefix.rfind(" ")
            if split_at <= 0:
                split_at = max_chars_per_chunk

        chunks.append(remaining[:split_at].strip())
        remaining = remaining[split_at:].strip()

    return chunks


def release_mps_cache(*, torch_module=None, gc_module=gc) -> None:
    """Best-effort release of completed MPS allocations between generation chunks."""
    if torch_module is None:
        try:
            import torch as torch_module
        except ImportError:
            torch_module = None

    mps = getattr(torch_module, "mps", None) if torch_module is not None else None
    for operation in ("synchronize", "empty_cache"):
        method = getattr(mps, operation, None)
        if callable(method):
            try:
                method()
            except Exception:
                # Cache reclamation must never hide an otherwise valid result.
                pass
    try:
        gc_module.collect()
    except Exception:
        pass


def synthesize(
    model,
    text: str,
    language: str,
    reference_wav: str,
    transcript: str,
    output: str,
    *,
    max_new_tokens: int = DEFAULT_MAX_NEW_TOKENS,
    max_chars_per_chunk: int = DEFAULT_MAX_CHARS_PER_CHUNK,
    soundfile_module=None,
    numpy_module=None,
    torch_module=None,
    gc_module=gc,
) -> None:
    if soundfile_module is None:
        try:
            import soundfile as sf
        except ImportError as exc:
            raise RuntimeError("soundfile is required in the Qwen3 TTS Conda environment.") from exc
    else:
        sf = soundfile_module
    max_new_tokens = bounded_positive_int(
        max_new_tokens, MAX_MAX_NEW_TOKENS, "max new tokens"
    )
    chunks = split_text_into_chunks(text, max_chars_per_chunk)
    if not chunks:
        raise RuntimeError("Qwen3 TTS requires non-empty text after whitespace normalization.")

    audio_chunks = []
    sample_rate = None
    for index, chunk in enumerate(chunks):
        wavs, current_sample_rate = model.generate_voice_clone(
            text=chunk,
            language=qwen_language(language),
            ref_audio=reference_wav,
            ref_text=transcript,
            non_streaming_mode=True,
            max_new_tokens=max_new_tokens,
        )
        if len(wavs) == 0:
            raise RuntimeError("Qwen3 TTS returned no generated audio.")
        if sample_rate is None:
            sample_rate = current_sample_rate
        elif current_sample_rate != sample_rate:
            raise RuntimeError("Qwen3 TTS returned inconsistent sample rates across text chunks.")
        audio_chunks.append(wavs[0])

        if index < len(chunks) - 1:
            release_mps_cache(torch_module=torch_module, gc_module=gc_module)

    audio = audio_chunks[0]
    if len(audio_chunks) > 1:
        if numpy_module is None:
            try:
                import numpy as numpy_module
            except ImportError as exc:
                raise RuntimeError("numpy is required to concatenate Qwen3 TTS text chunks.") from exc
        audio = numpy_module.concatenate(audio_chunks)
    Path(output).parent.mkdir(parents=True, exist_ok=True)
    sf.write(output, audio, sample_rate)


def main() -> int:
    args = parse_args()
    transcript = transcribe_reference_audio(
        args.ref_audio,
        args.whisper_mcp_url,
        args.whisper_timeout_seconds,
    )
    model = load_model(args.model, args.device_map, args.dtype, args.attn_implementation)
    synthesize(
        model,
        args.text,
        args.language,
        args.ref_audio,
        transcript,
        args.output,
        max_new_tokens=args.max_new_tokens,
        max_chars_per_chunk=args.max_chars_per_chunk,
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"Qwen3 TTS adapter failed: {exc}", file=sys.stderr)
        raise SystemExit(1)
