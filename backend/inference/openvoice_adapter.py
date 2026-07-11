import argparse
import json
import sys
import tempfile
from pathlib import Path
from typing import Optional

from common import add_repo_path, choose_torch_device


STYLE_SPEAKER_IDS = {
    "happy": 4,  # OpenVoice V1 calls this upstream speaker "excited".
    "cheerful": 5,
    "terrified": 6,
    "sad": 8,
    "friendly": 9,
}
NEUTRAL_SPEAKER_ID = 1


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run OpenVoice neutral V2 or styled English V1 synthesis.")
    parser.add_argument("--text", required=True)
    parser.add_argument("--language", required=True)
    parser.add_argument("--ref-audio", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--device", default="auto")
    # V2 neutral assets. Required only when --styles is absent or all zero.
    parser.add_argument("--checkpoints-path")
    parser.add_argument("--converter-config")
    parser.add_argument("--converter-checkpoint")
    parser.add_argument("--melo-language")
    parser.add_argument("--speaker-id")
    parser.add_argument("--source-se-path")
    # A nonzero JSON style object switches to V1's English expressive model.
    parser.add_argument("--styles")
    parser.add_argument("--v1-base-config")
    parser.add_argument("--v1-base-checkpoint")
    parser.add_argument("--v1-style-se-path")
    parser.add_argument("--v1-converter-config")
    parser.add_argument("--v1-converter-checkpoint")
    parser.add_argument("--repo-path")
    return parser.parse_args()


def parse_styles(raw_styles: Optional[str]) -> dict[str, float]:
    if raw_styles is None:
        return {name: 0.0 for name in STYLE_SPEAKER_IDS}
    try:
        value = json.loads(raw_styles)
    except json.JSONDecodeError as exc:
        raise RuntimeError("--styles must be a JSON object.") from exc
    if not isinstance(value, dict) or set(value) != set(STYLE_SPEAKER_IDS):
        raise RuntimeError("--styles must contain exactly happy, sad, terrified, cheerful, and friendly.")

    styles = {}
    for name in STYLE_SPEAKER_IDS:
        amount = value[name]
        if isinstance(amount, bool) or not isinstance(amount, (int, float)) or not 0 <= amount <= 1:
            raise RuntimeError(f"Style '{name}' must be a finite number from 0 to 1.")
        if amount != amount or amount in (float("inf"), float("-inf")):
            raise RuntimeError(f"Style '{name}' must be a finite number from 0 to 1.")
        styles[name] = float(amount)
    return styles


def require_args(args: argparse.Namespace, names: tuple[str, ...], mode: str) -> None:
    missing = [f"--{name.replace('_', '-')}" for name in names if not getattr(args, name)]
    if missing:
        raise RuntimeError(f"OpenVoice {mode} assets are missing required arguments: {', '.join(missing)}.")


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


def normalized_style_weights(styles: dict[str, float]) -> dict[int, float]:
    """Return a continuous V1 speaker blend including neutral speaker 1.

    Neutral gets max(0, 1 - max(style amount)); each requested style keeps its
    original amount. All weights are then normalized, so multiple controls can
    be combined without clipping or discrete speaker selection.
    """
    neutral_weight = max(0.0, 1.0 - max(styles.values(), default=0.0))
    weights = {NEUTRAL_SPEAKER_ID: neutral_weight}
    for style_name, speaker_id in STYLE_SPEAKER_IDS.items():
        weights[speaker_id] = styles[style_name]
    total = sum(weights.values())
    if total <= 0:
        return {NEUTRAL_SPEAKER_ID: 1.0}
    return {speaker_id: weight / total for speaker_id, weight in weights.items() if weight > 0}


def resolve_v1_speaker_name(tts, speaker_id: int) -> str:
    speakers = getattr(getattr(tts, "hps", None), "speakers", {})
    for speaker_name, configured_id in speakers.items():
        if int(configured_id) == speaker_id:
            return str(speaker_name)
    raise RuntimeError(
        f"OpenVoice V1 base checkpoint does not map speaker ID {speaker_id}. "
        f"Available mappings: {dict(speakers)}."
    )


def synthesize_styled_v1(args: argparse.Namespace, styles: dict[str, float], device: str, output_path: str, temp_dir: str) -> None:
    if args.language != "en":
        raise RuntimeError("Nonzero OpenVoice styles are supported only for English output.")
    require_args(
        args,
        (
            "v1_base_config",
            "v1_base_checkpoint",
            "v1_style_se_path",
            "v1_converter_config",
            "v1_converter_checkpoint",
        ),
        "V1 styled synthesis",
    )
    add_repo_path(args.repo_path)
    try:
        import torch
        from openvoice import se_extractor
        from openvoice.api import BaseSpeakerTTS, ToneColorConverter
    except ImportError as exc:
        raise RuntimeError("Could not import OpenVoice V1 BaseSpeakerTTS and ToneColorConverter.") from exc

    try:
        base_tts = BaseSpeakerTTS(args.v1_base_config, device=device)
    except TypeError:
        base_tts = BaseSpeakerTTS(args.v1_base_config, device)
    base_tts.load_ckpt(args.v1_base_checkpoint)
    try:
        converter = ToneColorConverter(args.v1_converter_config, device=device)
    except TypeError:
        converter = ToneColorConverter(args.v1_converter_config, device)
    converter.load_ckpt(args.v1_converter_checkpoint)

    embeddings = base_tts.model.emb_g.weight
    weights = normalized_style_weights(styles)
    if max(weights) >= embeddings.shape[0]:
        raise RuntimeError("OpenVoice V1 base checkpoint does not include the requested expressive speaker IDs.")

    # BaseSpeakerTTS accepts a speaker ID, not an arbitrary embedding. Replace
    # the neutral row for this single-process invocation with the weighted
    # embedding, synthesize as speaker 1, then restore it. This is model-level
    # speaker-embedding interpolation, never post-synthesis audio mixing.
    with torch.no_grad():
        original_neutral = embeddings[NEUTRAL_SPEAKER_ID].detach().clone()
        blended_embedding = sum(
            (embeddings[speaker_id].detach() * weight for speaker_id, weight in weights.items()),
            torch.zeros_like(original_neutral),
        )
        embeddings[NEUTRAL_SPEAKER_ID].copy_(blended_embedding)
    try:
        base_wav = str(Path(temp_dir) / "styled_base_speaker.wav")
        neutral_speaker = resolve_v1_speaker_name(base_tts, NEUTRAL_SPEAKER_ID)
        base_tts.tts(args.text, base_wav, speaker=neutral_speaker, language="English")
    finally:
        with torch.no_grad():
            embeddings[NEUTRAL_SPEAKER_ID].copy_(original_neutral)

    source_se = torch.load(args.v1_style_se_path, map_location=device)
    if hasattr(source_se, "to"):
        source_se = source_se.to(device)
    target_se = extract_target_se(args, converter, se_extractor, temp_dir)
    convert_voice(converter, base_wav, source_se, target_se, output_path)


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
    styles = parse_styles(args.styles)
    styled = any(styles.values())

    output_path = Path(args.output).expanduser().resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory(prefix="openvoice-") as temp_dir:
        if styled:
            synthesize_styled_v1(args, styles, device, str(output_path), temp_dir)
        else:
            require_args(
                args,
                ("checkpoints_path", "converter_config", "converter_checkpoint", "melo_language", "speaker_id", "source_se_path"),
                "V2 neutral synthesis",
            )
            _, _, converter, melo_tts, se_extractor, source_se = load_converter(args, device)
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
