import argparse
import gc
import re
import sys
from pathlib import Path

from common import add_repo_path, choose_torch_device, tensor_to_numpy, write_pcm16_wav


DEFAULT_MAX_NEW_TOKENS = 256
DEFAULT_MAX_CHARS_PER_CHUNK = 120
MAX_MAX_NEW_TOKENS = 256
MAX_MAX_CHARS_PER_CHUNK = 120


def positive_int(value: object) -> int:
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


def normalize_text(text: str) -> str:
    return " ".join(text.split())


def split_text_into_chunks(
    text: str,
    max_chars_per_chunk: int = DEFAULT_MAX_CHARS_PER_CHUNK,
) -> list[str]:
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


def _normalize_device_type(device: object) -> str | None:
    if device is None:
        return None
    if hasattr(device, "type"):
        device = device.type
    if isinstance(device, str):
        return device.strip().lower() or None
    return None


def release_accelerator_cache(
    device: object,
    *,
    torch_module=None,
    gc_module=gc,
) -> None:
    device_type = _normalize_device_type(device)
    if torch_module is None:
        try:
            import torch as torch_module
        except ImportError:
            return

    if device_type == "mps":
        accelerator = getattr(torch_module, "mps", None)
    elif device_type == "cuda":
        accelerator = getattr(torch_module, "cuda", None)
    else:
        return

    synchronize = getattr(accelerator, "synchronize", None)
    if callable(synchronize):
        try:
            synchronize()
        except Exception:
            pass

    empty_cache = getattr(accelerator, "empty_cache", None)
    if callable(empty_cache):
        try:
            empty_cache()
        except Exception:
            pass

    collect = getattr(gc_module, "collect", None)
    if callable(collect):
        try:
            collect()
        except Exception:
            pass


def install_chatterbox_memory_patch(backend_cls=None, analyzer_cls=None, *, torch_module=None) -> None:
    """Limit Chatterbox attention capture to the layers used for alignment.

    Chatterbox 0.1.7 asks every transformer layer to return its growing
    attention matrix even though the multilingual alignment analyzer consumes
    only three selected layers. On MPS this causes allocator growth during
    autoregressive generation. Keep the analyzer behavior, but request
    attention tensors only from the layers where its hooks are installed.
    """
    if backend_cls is None or analyzer_cls is None:
        from chatterbox.models.t3.inference.alignment_stream_analyzer import (
            AlignmentStreamAnalyzer,
        )
        from chatterbox.models.t3.inference.t3_hf_backend import (
            T3HuggingfaceBackend,
        )

        backend_cls = backend_cls or T3HuggingfaceBackend
        analyzer_cls = analyzer_cls or AlignmentStreamAnalyzer

    if not getattr(backend_cls, "_voice_cloning_memory_patch", False):
        original_forward = backend_cls.forward

        def forward_without_global_attentions(self, *args, **kwargs):
            kwargs["output_attentions"] = False
            return original_forward(self, *args, **kwargs)

        backend_cls.forward = forward_without_global_attentions
        backend_cls._voice_cloning_memory_patch = True

    analyzer_cls._voice_cloning_cache_torch_module = torch_module

    if getattr(analyzer_cls, "_voice_cloning_memory_patch", False):
        return

    def add_selective_attention_spy(self, tfmr, buffer_idx, layer_idx, head_idx):
        def request_attention(_module, args, kwargs):
            kwargs["output_attentions"] = True
            return args, kwargs

        def capture_attention(_module, _inputs, output):
            if isinstance(output, tuple) and len(output) > 1 and output[1] is not None:
                step_attention = output[1].detach()
                selected_head = step_attention[0, head_idx]
                if hasattr(selected_head, "cpu"):
                    selected_head = selected_head.cpu()
                self.last_aligned_attns[buffer_idx] = selected_head

        target_layer = tfmr.layers[layer_idx].self_attn
        target_layer.register_forward_pre_hook(request_attention, with_kwargs=True)
        target_layer.register_forward_hook(capture_attention)

        config = getattr(tfmr, "config", None)
        if config is not None:
            self.original_output_attentions = getattr(config, "output_attentions", False)
            self.original_attn_implementation = getattr(config, "_attn_implementation", None)
            if self.original_attn_implementation == "sdpa":
                config._attn_implementation = "eager"
            config.output_attentions = False

    original_step = getattr(analyzer_cls, "step", None)

    def step_with_periodic_cache_release(self, logits, next_token=None):
        result = original_step(self, logits, next_token=next_token)
        if getattr(self, "curr_frame_pos", 0) % 16 == 0:
            release_accelerator_cache(
                getattr(logits, "device", None),
                torch_module=getattr(analyzer_cls, "_voice_cloning_cache_torch_module", None),
            )
        return result

    analyzer_cls._add_attention_spy = add_selective_attention_spy
    if callable(original_step):
        analyzer_cls.step = step_with_periodic_cache_release
    analyzer_cls._voice_cloning_memory_patch = True


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run Chatterbox multilingual voice cloning.")
    parser.add_argument("--text", required=True)
    parser.add_argument("--language", required=True)
    parser.add_argument("--ref-audio", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--model", default="ResembleAI/chatterbox")
    parser.add_argument("--device", default="auto")
    parser.add_argument("--t3-model", default="v3")
    parser.add_argument(
        "--max-new-tokens",
        type=lambda value: bounded_positive_int(value, MAX_MAX_NEW_TOKENS, "max new tokens"),
        default=DEFAULT_MAX_NEW_TOKENS,
    )
    parser.add_argument(
        "--max-chars-per-chunk",
        type=lambda value: bounded_positive_int(
            value, MAX_MAX_CHARS_PER_CHUNK, "max chars per chunk"
        ),
        default=DEFAULT_MAX_CHARS_PER_CHUNK,
    )
    parser.add_argument("--repo-path")
    return parser.parse_args(argv)


def build_model(args: argparse.Namespace, device: str):
    add_repo_path(args.repo_path)
    try:
        from chatterbox.mtl_tts import ChatterboxMultilingualTTS
    except ImportError as exc:
        raise RuntimeError(
            "Could not import chatterbox.mtl_tts. Install Chatterbox in the selected Conda environment or set CHATTERBOX_REPO_PATH."
        ) from exc

    install_chatterbox_memory_patch()

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


def generate_chunk_audio(
    model,
    *,
    text: str,
    language_id: str,
    audio_prompt_path: str | None,
    max_new_tokens: int,
    reuse_conditionals: bool = False,
    exaggeration: float = 0.5,
    cfg_weight: float = 0.5,
    temperature: float = 0.8,
    repetition_penalty: float = 2.0,
    min_p: float = 0.05,
    top_p: float = 1.0,
):
    max_new_tokens = bounded_positive_int(
        max_new_tokens, MAX_MAX_NEW_TOKENS, "max new tokens"
    )
    if audio_prompt_path is None and reuse_conditionals and getattr(model, "conds", None) is None:
        raise AssertionError("Please `prepare_conditionals` first or specify `audio_prompt_path`")

    original_inference = model.t3.inference

    def capped_inference(*args, **kwargs):
        kwargs["max_new_tokens"] = max_new_tokens
        return original_inference(*args, **kwargs)

    model.t3.inference = capped_inference
    try:
        return model.generate(
            text=text,
            language_id=language_id,
            audio_prompt_path=audio_prompt_path,
            exaggeration=exaggeration,
            cfg_weight=cfg_weight,
            temperature=temperature,
            repetition_penalty=repetition_penalty,
            min_p=min_p,
            top_p=top_p,
        )
    finally:
        model.t3.inference = original_inference


def synthesize(
    model,
    text: str,
    language: str,
    reference_wav: str,
    *,
    max_new_tokens: int = DEFAULT_MAX_NEW_TOKENS,
    max_chars_per_chunk: int = DEFAULT_MAX_CHARS_PER_CHUNK,
    numpy_module=None,
    release_cache_fn=release_accelerator_cache,
    generate_chunk_fn=generate_chunk_audio,
):
    max_new_tokens = bounded_positive_int(
        max_new_tokens, MAX_MAX_NEW_TOKENS, "max new tokens"
    )
    chunks = split_text_into_chunks(text, max_chars_per_chunk)
    if not chunks:
        raise RuntimeError("Chatterbox requires non-empty text after whitespace normalization.")

    if numpy_module is None:
        import numpy as numpy_module

    audio_chunks = []
    for index, chunk in enumerate(chunks):
        audio_chunks.append(
            tensor_to_numpy(
                generate_chunk_fn(
                    model,
                    text=chunk,
                    language_id=language,
                    audio_prompt_path=reference_wav if index == 0 else None,
                    max_new_tokens=max_new_tokens,
                    reuse_conditionals=index > 0,
                )
            )
        )
        if index < len(chunks) - 1:
            release_cache_fn(getattr(model, "device", None))

    if len(audio_chunks) == 1:
        return audio_chunks[0]
    return numpy_module.concatenate(audio_chunks)


def main() -> int:
    args = parse_args()
    device = choose_torch_device(args.device)
    print(f"Chatterbox adapter using device: {device}", file=sys.stderr)
    model = build_model(args, device)
    audio = synthesize(
        model,
        args.text,
        args.language,
        args.ref_audio,
        max_new_tokens=args.max_new_tokens,
        max_chars_per_chunk=args.max_chars_per_chunk,
    )
    write_pcm16_wav(args.output, detect_sample_rate(model), audio)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"Chatterbox adapter failed: {exc}", file=sys.stderr)
        raise SystemExit(1)
