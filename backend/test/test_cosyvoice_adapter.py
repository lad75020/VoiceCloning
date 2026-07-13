import sys
import tempfile
import unittest
import wave
from pathlib import Path

import numpy as np

INFERENCE_DIR = Path(__file__).resolve().parents[1] / "inference"
if str(INFERENCE_DIR) not in sys.path:
    sys.path.insert(0, str(INFERENCE_DIR))

from cosyvoice_adapter import DEFAULT_MODEL_ID, build_instruction, synthesize


class FakeCosyVoiceModel:
    sample_rate = 24000

    def __init__(self):
        self.calls = []

    def inference_instruct2(self, text, instruction, reference_audio, stream):
        self.calls.append((text, instruction, reference_audio, stream))
        return [{"tts_speech": np.array([0.0, 0.5, -0.5], dtype=np.float32)}]


class CosyVoiceAdapterTests(unittest.TestCase):
    def test_default_model_is_the_fun_cosyvoice_3_hugging_face_id(self):
        self.assertEqual(DEFAULT_MODEL_ID, "FunAudioLLM/Fun-CosyVoice3-0.5B-2512")

    def test_instruction_is_fixed_and_uses_only_canonical_tags_passed_by_backend(self):
        self.assertEqual(
            build_instruction("calm, heroic"),
            "You are a helpful assistant. Speak with a calm, heroic tone.",
        )

    def test_synthesis_uses_inference_instruct2_and_writes_a_wav(self):
        model = FakeCosyVoiceModel()
        with tempfile.TemporaryDirectory() as temp_dir:
            output = Path(temp_dir) / "output.wav"
            synthesize(model, "Hello", "calm, heroic", "reference.wav", str(output))

            self.assertEqual(
                model.calls,
                [("Hello", "You are a helpful assistant. Speak with a calm, heroic tone.", "reference.wav", False)],
            )
            with wave.open(str(output), "rb") as wav_file:
                self.assertEqual(wav_file.getframerate(), 24000)
                self.assertEqual(wav_file.getnframes(), 3)


if __name__ == "__main__":
    unittest.main()
