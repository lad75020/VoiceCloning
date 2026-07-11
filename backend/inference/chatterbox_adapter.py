import argparse
import sys
from pathlib import Path

from common import add_repo_path, choose_torch_device, write_pcm16_wav


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run Chatterbox multilingual voice cloning.")
    parser.add_argument("--text", required=True)
    parser.add_argument("--language", required=True)
    parser.add_argument("--ref-audio", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--model", default="ResembleAI/chatterbox")
    parser.add_argument("--device", default="auto")
    parser.add_argument("--t3-model", default="v3")
    parser.add_argument("--repo-path")
    return parser.parse_args()


def build_model(args: argparse.Namespace, device: str):
    add_repo_path(args.repo_path)
    try:
        from chatterbox.mtl_tts import ChatterboxMultilingualTTS
    except ImportError as exc:
        raise RuntimeError(
            "Could not import chatterbox.mtl_tts. Install Chatterbox in the selected Conda environment or set CHATTERBOX_REPO_PATH."
        ) from exc

    model_id = args.model.strip()
    if model_id and model_id != "ResembleAI/chatterbox":
        checkpoint_dir = Path(model_id).expanduser()
        if not checkpoint_dir.is_dir():
            raise RuntimeError(
                "CHATTERBOX_MODEL must be 'ResembleAI/chatterbox' or a local Chatterbox checkpoint directory."
            )
        try:
            return ChatterboxMultilingualTTS.from_local(
                checkpoint_dir,
                device=device,
                t3_model=args.t3_model,
            )
        except TypeError as exc:
            if "t3_model" not in str(exc):
                raise
            return ChatterboxMultilingualTTS.from_local(checkpoint_dir, device=device)
    try:
        return ChatterboxMultilingualTTS.from_pretrained(device=device, t3_model=args.t3_model)
    except TypeError as exc:
        if "t3_model" not in str(exc):
            raise
        return ChatterboxMultilingualTTS.from_pretrained(device=device)


def detect_sample_rate(model) -> int:
    for attr in ("sample_rate", "sr"):
        value = getattr(model, attr, None)
        if isinstance(value, int) and value > 0:
            return value
    return 24000


def main() -> int:
    args = parse_args()
    device = choose_torch_device(args.device)
    model = build_model(args, device)
    audio = model.generate(
        text=args.text,
        language_id=args.language,
        audio_prompt_path=args.ref_audio,
    )
    write_pcm16_wav(args.output, detect_sample_rate(model), audio)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"Chatterbox adapter failed: {exc}", file=sys.stderr)
        raise SystemExit(1)
