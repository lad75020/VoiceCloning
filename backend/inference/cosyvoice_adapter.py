import argparse
import sys
from pathlib import Path

import numpy as np

from common import add_repo_path, tensor_to_numpy, write_pcm16_wav


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run CosyVoice cross-lingual voice cloning.")
    parser.add_argument("--text", required=True)
    parser.add_argument("--ref-audio", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--model-path", required=True)
    parser.add_argument("--repo-path")
    return parser.parse_args()


def load_model(args: argparse.Namespace):
    repo_path = Path(args.repo_path).expanduser().resolve() if args.repo_path else None
    add_repo_path(str(repo_path) if repo_path else None)
    if repo_path:
        add_repo_path(str(repo_path / "third_party" / "Matcha-TTS"))
    try:
        from cosyvoice.cli.cosyvoice import AutoModel
    except ImportError as exc:
        raise RuntimeError(
            "Could not import cosyvoice.cli.cosyvoice.AutoModel. Install CosyVoice in the selected Conda environment or set COSYVOICE_REPO_PATH."
        ) from exc

    model_path = args.model_path.strip()
    if not model_path:
        raise RuntimeError("COSYVOICE_MODEL_PATH must point to a prepared model directory.")

    return AutoModel(model_dir=model_path)


def main() -> int:
    args = parse_args()
    model = load_model(args)

    chunks = list(model.inference_cross_lingual(args.text, args.ref_audio, stream=False))
    if not chunks:
        raise RuntimeError("CosyVoice returned no synthesis chunks.")

    sample_rate = getattr(model, "sample_rate", None)
    segments = []
    for chunk in chunks:
        chunk_audio = chunk.get("tts_speech")
        if chunk_audio is None:
            raise RuntimeError("CosyVoice returned a chunk without 'tts_speech'.")
        segments.append(tensor_to_numpy(chunk_audio))

        chunk_rate = chunk.get("sample_rate")
        if isinstance(chunk_rate, int) and chunk_rate > 0:
            sample_rate = chunk_rate

    if not isinstance(sample_rate, int) or sample_rate <= 0:
        raise RuntimeError("CosyVoice did not expose a valid sample rate.")

    merged = np.concatenate(segments, axis=0)
    write_pcm16_wav(args.output, sample_rate, merged)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"CosyVoice adapter failed: {exc}", file=sys.stderr)
        raise SystemExit(1)
