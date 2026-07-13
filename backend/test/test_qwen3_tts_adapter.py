import argparse
import contextlib
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path

INFERENCE_DIR = Path(__file__).resolve().parents[1] / "inference"
if str(INFERENCE_DIR) not in sys.path:
    sys.path.insert(0, str(INFERENCE_DIR))

from qwen3_tts_adapter import (
    DEFAULT_ATTN_IMPLEMENTATION,
    DEFAULT_MAX_CHARS_PER_CHUNK,
    DEFAULT_MAX_NEW_TOKENS,
    DEFAULT_DEVICE_MAP,
    DEFAULT_DTYPE,
    DEFAULT_MODEL_ID,
    MAX_MAX_CHARS_PER_CHUNK,
    MAX_MAX_NEW_TOKENS,
    bounded_positive_float,
    bounded_positive_int,
    extract_tool_text,
    load_model,
    parse_args,
    positive_int,
    split_text_into_chunks,
    synthesize,
    transcribe_reference_audio,
)


class FakeResponse:
    def __init__(self, body):
        self.body = body

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def read(self):
        return self.body.encode("utf-8")


class FakeModel:
    def __init__(self):
        self.calls = []

    def generate_voice_clone(self, **kwargs):
        self.calls.append(kwargs)
        return [[0.1, -0.1]], 24000


class FakeSoundfile:
    def __init__(self):
        self.calls = []

    def write(self, path, wav, sample_rate):
        self.calls.append((path, wav, sample_rate))


class FakeModelClass:
    calls = []

    @classmethod
    def from_pretrained(cls, *args, **kwargs):
        cls.calls.append((args, kwargs))
        return FakeModel()


class FakeTorch:
    float16 = "float16-token"


class ChunkingFakeModel:
    def __init__(self):
        self.calls = []

    def generate_voice_clone(self, **kwargs):
        self.calls.append(kwargs)
        return [[len(self.calls)]], 24000


class FakeNumpy:
    def __init__(self):
        self.calls = []

    def concatenate(self, chunks):
        self.calls.append(chunks)
        return [sample for chunk in chunks for sample in chunk]


class FakeMps:
    def __init__(self):
        self.calls = []

    def synchronize(self):
        self.calls.append("synchronize")

    def empty_cache(self):
        self.calls.append("empty_cache")


class FakeTorchWithMps:
    def __init__(self):
        self.mps = FakeMps()


class FakeGc:
    def __init__(self):
        self.collect_calls = 0

    def collect(self):
        self.collect_calls += 1


class Qwen3TtsAdapterTests(unittest.TestCase):
    def test_default_model_is_qwen_base_checkpoint(self):
        self.assertEqual(DEFAULT_MODEL_ID, "Qwen/Qwen3-TTS-12Hz-1.7B-Base")
        self.assertEqual(DEFAULT_DEVICE_MAP, "mps")
        self.assertEqual(DEFAULT_DTYPE, "float16")
        self.assertEqual(DEFAULT_ATTN_IMPLEMENTATION, "sdpa")
        self.assertEqual(DEFAULT_MAX_NEW_TOKENS, 128)
        self.assertEqual(DEFAULT_MAX_CHARS_PER_CHUNK, 120)

    def test_mcp_transcription_parses_sse_tool_result_and_synthesis_uses_clone_contract(self):
        captured = {}

        def fake_open(request, timeout):
            captured["request"] = request
            captured["timeout"] = timeout
            return FakeResponse('event: message\ndata: {"jsonrpc":"2.0","result":{"content":[{"type":"text","text":" Bonjour le monde "}]}}\n\n')

        model = FakeModel()
        soundfile = FakeSoundfile()
        with tempfile.TemporaryDirectory() as temp_dir:
            reference = Path(temp_dir) / "reference.wav"
            reference.write_bytes(b"RIFFfake")
            output = Path(temp_dir) / "output.wav"
            transcript = transcribe_reference_audio(str(reference), "https://whisper.example/mcp", 42, open_url=fake_open)
            synthesize(model, "Target text", "fr", str(reference), transcript, str(output), soundfile_module=soundfile)

        payload = json.loads(captured["request"].data.decode("utf-8"))
        self.assertEqual(payload["method"], "tools/call")
        self.assertEqual(payload["params"]["name"], "transcribe")
        self.assertEqual(payload["params"]["arguments"]["type"], "transcribe")
        self.assertEqual(payload["params"]["arguments"]["language"], "auto")
        self.assertTrue(payload["params"]["arguments"]["audio"].startswith("data:audio/wav;base64,"))
        self.assertEqual(captured["request"].get_header("Mcp-protocol-version"), "2025-03-26")
        self.assertEqual(
            captured["request"].get_header("User-agent"),
            "VoiceCloning/1.0 (+https://github.com/lad75020/VoiceCloning)",
        )
        self.assertEqual(captured["timeout"], 42)
        self.assertEqual(model.calls, [{
            "text": "Target text",
            "language": "French",
            "ref_audio": str(reference),
            "ref_text": "Bonjour le monde",
            "non_streaming_mode": True,
            "max_new_tokens": 128,
        }])
        self.assertEqual(soundfile.calls, [(str(output), [0.1, -0.1], 24000)])

    def test_chunking_prefers_sentence_then_whitespace_boundaries(self):
        chunks = split_text_into_chunks("  One.   Two three four  ", 10)

        self.assertEqual(chunks, ["One.", "Two three", "four"])
        self.assertTrue(all(len(chunk) <= 10 for chunk in chunks))

    def test_chunked_synthesis_concatenates_audio_and_releases_mps_cache_between_chunks(self):
        model = ChunkingFakeModel()
        soundfile = FakeSoundfile()
        numpy = FakeNumpy()
        torch = FakeTorchWithMps()
        fake_gc = FakeGc()

        with tempfile.TemporaryDirectory() as temp_dir:
            output = Path(temp_dir) / "output.wav"
            synthesize(
                model,
                "First chunk. Second chunk.",
                "en",
                "reference.wav",
                "Reference transcript.",
                str(output),
                max_new_tokens=64,
                max_chars_per_chunk=13,
                soundfile_module=soundfile,
                numpy_module=numpy,
                torch_module=torch,
                gc_module=fake_gc,
            )

        self.assertEqual([call["text"] for call in model.calls], ["First chunk.", "Second chunk."])
        self.assertTrue(all(call["non_streaming_mode"] is True for call in model.calls))
        self.assertEqual([call["max_new_tokens"] for call in model.calls], [64, 64])
        self.assertEqual(numpy.calls, [[[1], [2]]])
        self.assertEqual(soundfile.calls, [(str(output), [1, 2], 24000)])
        self.assertEqual(torch.mps.calls, ["synchronize", "empty_cache"])
        self.assertEqual(fake_gc.collect_calls, 1)

    def test_non_positive_generation_limits_are_rejected_by_helper_and_cli(self):
        for value in (0, -1, "0", "-1"):
            with self.assertRaises(argparse.ArgumentTypeError):
                positive_int(value)

        with contextlib.redirect_stderr(io.StringIO()):
            with self.assertRaises(SystemExit):
                parse_args([
                    "--text", "hello",
                    "--language", "en",
                    "--ref-audio", "reference.wav",
                    "--output", "output.wav",
                    "--max-new-tokens", "0",
                ])
            with self.assertRaises(SystemExit):
                parse_args([
                    "--text", "hello",
                    "--language", "en",
                    "--ref-audio", "reference.wav",
                    "--output", "output.wav",
                    "--max-chars-per-chunk", "-1",
                ])

    def test_unsafe_generation_limits_and_timeouts_are_rejected(self):
        with self.assertRaises(argparse.ArgumentTypeError):
            bounded_positive_int(129, MAX_MAX_NEW_TOKENS, "max new tokens")
        with self.assertRaises(argparse.ArgumentTypeError):
            bounded_positive_int(121, MAX_MAX_CHARS_PER_CHUNK, "max chars per chunk")
        for value in ("nan", "inf", 0, 601):
            with self.assertRaises(argparse.ArgumentTypeError):
                bounded_positive_float(value, 600, "whisper timeout")

        with contextlib.redirect_stderr(io.StringIO()):
            with self.assertRaises(SystemExit):
                parse_args([
                    "--text", "hello",
                    "--language", "en",
                    "--ref-audio", "reference.wav",
                    "--output", "output.wav",
                    "--max-new-tokens", "129",
                ])

    def test_model_load_uses_requested_mps_settings(self):
        FakeModelClass.calls.clear()
        load_model(
            "Qwen/Qwen3-TTS-12Hz-1.7B-Base",
            "mps",
            "float16",
            "sdpa",
            torch_module=FakeTorch,
            model_class=FakeModelClass,
        )
        self.assertEqual(FakeModelClass.calls, [
            (("Qwen/Qwen3-TTS-12Hz-1.7B-Base",), {
                "device_map": "mps",
                "dtype": "float16-token",
                "attn_implementation": "sdpa",
            }),
        ])

    def test_empty_or_error_mcp_tool_results_fail(self):
        with self.assertRaisesRegex(RuntimeError, "empty transcript"):
            extract_tool_text('{"jsonrpc":"2.0","result":{"content":[{"type":"text","text":"   "}]}}')
        with self.assertRaisesRegex(RuntimeError, "tool error"):
            extract_tool_text('{"jsonrpc":"2.0","result":{"isError":true,"content":[]}}')


if __name__ == "__main__":
    unittest.main()
