import argparse
import sys
import tempfile
from pathlib import Path

from common import add_repo_path, choose_torch_device


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run OpenVoice V2 tone conversion.")
    parser.add_argument("--text", required=True)
    parser.add_argument("--language", required=True)
    parser.add_argument("--ref-audio", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--device", default="auto")
    parser.add_argument("--checkpoints-path", required=True)
    parser.add_argument("--converter-config", required=True)
    parser.add_argument("--converter-checkpoint", required=True)
    parser.add_argument("--melo-language", required=True)
    parser.add_argument("--speaker-id", required=True)
    parser.add_argument("--source-se-path", required=True)
    parser.add_argument("--repo-path")
    return parser.parse_args()


def load_converter(args: argparse.Namespace, device: str):
    add_repo_path(args.repo_path)
    try:
        import torch
        from melo.api import TTS as MeloTTS
        from openvoice import se_extractor
        from openvoice.api import ToneColorConverter
    except ImportError as exc:
        raise RuntimeError(
            "Could not import OpenVoice V2 and MeloTTS. Install both in the selected Conda environment or set OPENVOICE_REPO_PATH."
        ) from exc

    try:
        converter = ToneColorConverter(args.converter_config, device=device)
    except TypeError:
        converter = ToneColorConverter(args.converter_config, device)

    converter.load_ckpt(args.converter_checkpoint)
    melo_tts = MeloTTS(language=args.melo_language, device=device)
    source_se = torch.load(args.source_se_path, map_location=device)
    return torch, MeloTTS, converter, melo_tts, se_extractor, source_se


def resolve_speaker_id(tts, speaker_key: str) -> int:
    if speaker_key.isdigit():
        return int(speaker_key)

    speakers = getattr(getattr(getattr(tts, "hps", None), "data", None), "spk2id", {})
    if speaker_key in speakers:
        return int(speakers[speaker_key])

    normalized = speaker_key.lower().replace("_", "-")
    for key, value in speakers.items():
        if str(key).lower().replace("_", "-") == normalized:
            return int(value)

    available = ", ".join(map(str, speakers.keys())) or "none"
    raise RuntimeError(f"MeloTTS speaker '{speaker_key}' was not found. Available speakers: {available}.")


def synthesize_base_speaker(tts, text: str, speaker_id: int, output_path: str) -> None:
    try:
        tts.tts_to_file(text, speaker_id, output_path)
        return
    except TypeError:
        pass

    try:
        tts.tts_to_file(text=text, speaker_id=speaker_id, output_path=output_path)
        return
    except TypeError:
        pass

    try:
        tts.tts_to_file(text=text, speaker=speaker_id, output_path=output_path)
    except TypeError as exc:
        raise RuntimeError(
            "Unsupported MeloTTS tts_to_file signature. Verify the installed MeloTTS version for OpenVoice V2."
        ) from exc


def extract_target_se(args: argparse.Namespace, converter, se_extractor, temp_dir: str):
    try:
        target = se_extractor.get_se(args.ref_audio, converter, target_dir=temp_dir, vad=True)
    except TypeError:
        try:
            target = se_extractor.get_se(args.ref_audio, converter, temp_dir, vad=True)
        except TypeError:
            target = se_extractor.get_se(args.ref_audio, converter, temp_dir)

    if isinstance(target, tuple):
        target = target[0]
    return target


def convert_voice(converter, source_wav: str, source_se, target_se, output_path: str) -> None:
    try:
        converter.convert(
            audio_src_path=source_wav,
            src_se=source_se,
            tgt_se=target_se,
            output_path=output_path,
            message="@VoiceCloning",
        )
        return
    except TypeError:
        pass

    try:
        converter.convert(source_wav, source_se, target_se, output_path)
    except TypeError as exc:
        raise RuntimeError(
            "Unsupported ToneColorConverter.convert signature. Verify the installed OpenVoice V2 version."
        ) from exc


def main() -> int:
    args = parse_args()
    device = choose_torch_device(args.device)
    _, _, converter, melo_tts, se_extractor, source_se = load_converter(args, device)

    output_path = Path(args.output).expanduser().resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory(prefix="openvoice-") as temp_dir:
        base_wav = str(Path(temp_dir) / "base_speaker.wav")
        speaker_id = resolve_speaker_id(melo_tts, args.speaker_id)
        synthesize_base_speaker(melo_tts, args.text, speaker_id, base_wav)
        target_se = extract_target_se(args, converter, se_extractor, temp_dir)
        convert_voice(converter, base_wav, source_se, target_se, str(output_path))

    if not output_path.is_file() or output_path.stat().st_size <= 44:
        raise RuntimeError(f"OpenVoice did not create the expected non-empty WAV file at {output_path}.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"OpenVoice adapter failed: {exc}", file=sys.stderr)
        raise SystemExit(1)
