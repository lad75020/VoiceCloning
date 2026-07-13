import argparse
import sys
from pathlib import Path

import numpy as np

from common import add_repo_path, tensor_to_numpy, write_pcm16_wav


DEFAULT_MODEL_ID = "FunAudioLLM/Fun-CosyVoice3-0.5B-2512"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run Fun-CosyVoice 3 instructed voice cloning.")
    parser.add_argument("--text", required=True)
    parser.add_argument("--ref-audio", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--model", default=DEFAULT_MODEL_ID)
    parser.add_argument(
        "--model-path",
        dest="model_path",
        help="Deprecated local-model override retained for older command integrations.",
    )
    parser.add_argument("--tone-tags", required=True)
    parser.add_argument("--repo-path")
    return parser.parse_args()


def resolve_model_dir(model: str) -> str:
    """Resolve a local model folder or download/cache a Hugging Face model id."""
    model_source = model.strip()
    if not model_source:
        raise RuntimeError("CosyVoice model must be a local directory or Hugging Face model id.")

    local_path = Path(model_source).expanduser()
    if local_path.is_dir():
        return str(local_path.resolve())

    try:
        from huggingface_hub import snapshot_download
    except ImportError as exc:
        raise RuntimeError(
            "huggingface_hub is required to download the default Fun-CosyVoice model. "
            "Install it in the CosyVoice environment or configure COSYVOICE_MODEL_PATH."
        ) from exc

    try:
        return snapshot_download(repo_id=model_source)
    except Exception as exc:
        raise RuntimeError(
            f"Could not resolve CosyVoice model '{model_source}' from the local filesystem or Hugging Face."
        ) from exc


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

    model_source = args.model_path or args.model
    return AutoModel(model_dir=resolve_model_dir(model_source))


def build_instruction(tone_tags: str) -> str:
    """Build the sole model instruction from backend-validated canonical tags."""
    return f"You are a helpful assistant. Speak with a {tone_tags} tone."


def synthesize(model, text: str, tone_tags: str, reference_audio: str, output: str) -> None:
    chunks = list(
        model.inference_instruct2(
            text,
            build_instruction(tone_tags),
            reference_audio,
            stream=False,
        )
    )
    if not chunks:
        raise RuntimeError("Fun-CosyVoice returned no synthesis chunks.")


    sample_rate = getattr(model, "sample_rate", None)
    segments = []
    for chunk in chunks:
        chunk_audio = chunk.get("tts_speech")
        if chunk_audio is None:
            raise RuntimeError("Fun-CosyVoice returned a chunk without 'tts_speech'.")
        segments.append(tensor_to_numpy(chunk_audio))

        chunk_rate = chunk.get("sample_rate")
        if isinstance(chunk_rate, int) and chunk_rate > 0:
            sample_rate = chunk_rate

    if not isinstance(sample_rate, int) or sample_rate <= 0:
        raise RuntimeError("Fun-CosyVoice did not expose a valid sample rate.")

    merged = np.concatenate(segments, axis=0)
    write_pcm16_wav(output, sample_rate, merged)


def main() -> int:
    args = parse_args()
    model = load_model(args)
    synthesize(model, args.text, args.tone_tags, args.ref_audio, args.output)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"CosyVoice adapter failed: {exc}", file=sys.stderr)
        raise SystemExit(1)
