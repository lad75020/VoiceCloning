import argparse
import contextlib
import io
import sys
import unittest
from pathlib import Path

INFERENCE_DIR = Path(__file__).resolve().parents[1] / "inference"
if str(INFERENCE_DIR) not in sys.path:
    sys.path.insert(0, str(INFERENCE_DIR))

from chatterbox_adapter import (
    DEFAULT_MAX_CHARS_PER_CHUNK,
    DEFAULT_MAX_NEW_TOKENS,
    MAX_MAX_CHARS_PER_CHUNK,
    MAX_MAX_NEW_TOKENS,
    bounded_positive_int,
    generate_chunk_audio,
    install_chatterbox_memory_patch,
    parse_args,
    split_text_into_chunks,
    synthesize,
)


class FakeAttentionLayer:
    def __init__(self):
        self.pre_hook = None
        self.forward_hook = None

    def register_forward_pre_hook(self, hook, *, with_kwargs=False):
        self.pre_hook = hook
        self.with_kwargs = with_kwargs

    def register_forward_hook(self, hook):
        self.forward_hook = hook


class FakeHeadTensor:
    def __init__(self):
        self.cpu_calls = 0

    def cpu(self):
        self.cpu_calls += 1
        return f"cpu-head-{self.cpu_calls}"


class FakeStepAttention:
    def __init__(self):
        self.detach_calls = 0
        self.cpu_calls = 0
        self.requested_indices = []
        self.selected_head = FakeHeadTensor()

    def detach(self):
        self.detach_calls += 1
        return self

    def cpu(self):
        self.cpu_calls += 1
        return self

    def __getitem__(self, key):
        self.requested_indices.append(key)
        return self.selected_head


class FakeBackend:
    def forward(self, *args, **kwargs):
        return kwargs.get("output_attentions")


class FakeAnalyzer:
    def __init__(self):
        self.step_calls = []
        self.curr_frame_pos = 0

    def _add_attention_spy(self, *args, **kwargs):
        raise AssertionError("unpatched analyzer implementation was called")

    def step(self, logits, next_token=None):
        self.step_calls.append((self.curr_frame_pos, logits, next_token))
        self.curr_frame_pos += 1
        return logits


class FakeCacheModule:
    def __init__(self):
        self.synchronize_calls = 0
        self.empty_cache_calls = 0

    def synchronize(self, *_args, **_kwargs):
        self.synchronize_calls += 1

    def empty_cache(self):
        self.empty_cache_calls += 1


class FakeTorchForCache:
    class Tensor:
        pass

    def __init__(self):
        self.mps = FakeCacheModule()
        self.cuda = FakeCacheModule()


class FakeLogits:
    def __init__(self, device_type):
        self.device = type("Device", (), {"type": device_type})()


class FakeModel:
    def __init__(self, *, raise_on_generate=False):
        self.prepare_conditionals_calls = []
        self.generate_calls = []
        self.inference_max_new_tokens = []
        self.device = "mps"
        self.conds = None
        self.sample_rate = 24000
        self.raise_on_generate = raise_on_generate
        self.t3 = type("T3Module", (), {})()
        self.t3.inference = self._inference

    def _inference(self, *args, **kwargs):
        self.inference_max_new_tokens.append(kwargs.get("max_new_tokens"))
        return [len(self.inference_max_new_tokens)]

    def generate(self, **kwargs):
        self.generate_calls.append(kwargs)
        audio_prompt_path = kwargs.get("audio_prompt_path")
        if audio_prompt_path:
            self.prepare_conditionals_calls.append((audio_prompt_path, 0.5))
            self.conds = {"reference": audio_prompt_path}
        elif self.conds is None:
            raise AssertionError("expected prepared conditionals to be reused")
        if self.raise_on_generate:
            raise RuntimeError("generate failed")
        self.t3.inference(max_new_tokens=1000)
        return [len(self.generate_calls)]


class FakeNumpy:
    def __init__(self):
        self.concatenate_calls = []

    def concatenate(self, chunks):
        self.concatenate_calls.append(chunks)
        return [sample for chunk in chunks for sample in chunk]


class FakeReleaseTracker:
    def __init__(self):
        self.calls = []

    def __call__(self, device, **_kwargs):
        self.calls.append(device)


class ChatterboxMemoryPatchTests(unittest.TestCase):
    def test_generation_limits_default_to_safe_bounded_values(self):
        self.assertEqual(DEFAULT_MAX_NEW_TOKENS, 256)
        self.assertEqual(DEFAULT_MAX_CHARS_PER_CHUNK, 120)

    def test_unsafe_generation_limits_are_rejected_by_helper_and_cli(self):
        with self.assertRaises(argparse.ArgumentTypeError):
            bounded_positive_int(257, MAX_MAX_NEW_TOKENS, "max new tokens")
        with self.assertRaises(argparse.ArgumentTypeError):
            bounded_positive_int(121, MAX_MAX_CHARS_PER_CHUNK, "max chars per chunk")

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
                    "--max-new-tokens", "257",
                ])

    def test_chunking_prefers_sentence_then_whitespace_boundaries(self):
        chunks = split_text_into_chunks("  One.   Two three four  ", 10)

        self.assertEqual(chunks, ["One.", "Two three", "four"])
        self.assertTrue(all(len(chunk) <= 10 for chunk in chunks))

    def test_patch_disables_global_attentions_and_enables_only_spied_layer(self):
        install_chatterbox_memory_patch(FakeBackend, FakeAnalyzer)

        self.assertFalse(FakeBackend().forward(output_attentions=True))

        attention = FakeAttentionLayer()
        config = type("Config", (), {
            "output_attentions": True,
            "_attn_implementation": "sdpa",
        })()
        transformer = type("Transformer", (), {
            "layers": [type("Layer", (), {"self_attn": attention})()],
            "config": config,
        })()
        analyzer = FakeAnalyzer()
        analyzer.last_aligned_attns = [None]

        analyzer._add_attention_spy(transformer, 0, 0, 0)

        self.assertTrue(attention.with_kwargs)
        _, kwargs = attention.pre_hook(attention, (), {"output_attentions": False})
        self.assertTrue(kwargs["output_attentions"])
        self.assertFalse(config.output_attentions)
        self.assertEqual(config._attn_implementation, "eager")

    def test_patch_selects_requested_head_before_cpu_transfer(self):
        install_chatterbox_memory_patch(FakeBackend, FakeAnalyzer)

        attention = FakeAttentionLayer()
        transformer = type("Transformer", (), {
            "layers": [type("Layer", (), {"self_attn": attention})()],
            "config": None,
        })()
        analyzer = FakeAnalyzer()
        analyzer.last_aligned_attns = [None]

        analyzer._add_attention_spy(transformer, 0, 0, 2)
        step_attention = FakeStepAttention()
        attention.forward_hook(attention, (), (None, step_attention))

        self.assertEqual(step_attention.detach_calls, 1)
        self.assertEqual(step_attention.requested_indices, [(0, 2)])
        self.assertEqual(step_attention.cpu_calls, 0)
        self.assertEqual(step_attention.selected_head.cpu_calls, 1)
        self.assertEqual(analyzer.last_aligned_attns[0], "cpu-head-1")

    def test_patch_releases_accelerator_cache_every_sixteen_frames(self):
        install_chatterbox_memory_patch(FakeBackend, FakeAnalyzer, torch_module=FakeTorchForCache())

        analyzer = FakeAnalyzer()
        logits = FakeLogits("mps")
        for _ in range(32):
            analyzer.step(logits, next_token=1)

        torch_module = FakeTorchForCache()
        install_chatterbox_memory_patch(FakeBackend, FakeAnalyzer, torch_module=torch_module)
        analyzer = FakeAnalyzer()
        for _ in range(32):
            analyzer.step(logits, next_token=1)

        self.assertEqual(torch_module.mps.synchronize_calls, 2)
        self.assertEqual(torch_module.mps.empty_cache_calls, 2)

    def test_generate_chunk_audio_caps_upstream_inference_tokens(self):
        model = FakeModel()
        original_inference = model.t3.inference

        audio = generate_chunk_audio(
            model,
            text="Hello there.",
            language_id="en",
            audio_prompt_path="reference.wav",
            max_new_tokens=64,
        )

        self.assertEqual(audio, [1])
        self.assertEqual(model.inference_max_new_tokens, [64])
        self.assertEqual(model.prepare_conditionals_calls, [("reference.wav", 0.5)])
        self.assertEqual(
            model.generate_calls,
            [{
                "text": "Hello there.",
                "language_id": "en",
                "audio_prompt_path": "reference.wav",
                "exaggeration": 0.5,
                "cfg_weight": 0.5,
                "temperature": 0.8,
                "repetition_penalty": 2.0,
                "min_p": 0.05,
                "top_p": 1.0,
            }],
        )
        self.assertIs(model.t3.inference, original_inference)

    def test_generate_chunk_audio_restores_original_inference_on_error(self):
        model = FakeModel(raise_on_generate=True)
        original_inference = model.t3.inference

        with self.assertRaisesRegex(RuntimeError, "generate failed"):
            generate_chunk_audio(
                model,
                text="Hello there.",
                language_id="en",
                audio_prompt_path="reference.wav",
                max_new_tokens=64,
            )

        self.assertIs(model.t3.inference, original_inference)
        self.assertEqual(model.inference_max_new_tokens, [])

    def test_synthesize_chunks_text_reuses_conditionals_and_concatenates_audio(self):
        model = FakeModel()
        numpy_module = FakeNumpy()
        release_tracker = FakeReleaseTracker()

        audio = synthesize(
            model,
            "First chunk. Second chunk.",
            "en",
            "reference.wav",
            max_new_tokens=64,
            max_chars_per_chunk=13,
            numpy_module=numpy_module,
            release_cache_fn=release_tracker,
            generate_chunk_fn=generate_chunk_audio,
        )

        self.assertEqual(model.prepare_conditionals_calls, [("reference.wav", 0.5)])
        self.assertEqual(
            [call["text"] for call in model.generate_calls],
            ["First chunk.", "Second chunk."],
        )
        self.assertEqual([call["audio_prompt_path"] for call in model.generate_calls], ["reference.wav", None])
        self.assertEqual(model.inference_max_new_tokens, [64, 64])
        self.assertEqual(numpy_module.concatenate_calls, [[[1], [2]]])
        self.assertEqual(audio, [1, 2])
        self.assertEqual(release_tracker.calls, ["mps"])


if __name__ == "__main__":
    unittest.main()
