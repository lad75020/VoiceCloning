import sys
import unittest
from pathlib import Path

INFERENCE_DIR = Path(__file__).resolve().parents[1] / "inference"
if str(INFERENCE_DIR) not in sys.path:
    sys.path.insert(0, str(INFERENCE_DIR))

from chatterbox_adapter import install_chatterbox_memory_patch


class FakeAttentionLayer:
    def __init__(self):
        self.pre_hook = None
        self.forward_hook = None

    def register_forward_pre_hook(self, hook, *, with_kwargs=False):
        self.pre_hook = hook
        self.with_kwargs = with_kwargs

    def register_forward_hook(self, hook):
        self.forward_hook = hook


class FakeBackend:
    def forward(self, *args, **kwargs):
        return kwargs.get("output_attentions")


class FakeAnalyzer:
    def _add_attention_spy(self, *args, **kwargs):
        raise AssertionError("unpatched analyzer implementation was called")


class ChatterboxMemoryPatchTests(unittest.TestCase):
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


if __name__ == "__main__":
    unittest.main()
