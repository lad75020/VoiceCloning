import argparse
import sys
from pathlib import Path

from common import add_repo_path, choose_torch_device, write_pcm16_wav


def install_chatterbox_memory_patch(backend_cls=None, analyzer_cls=None) -> None:
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

    if getattr(analyzer_cls, "_voice_cloning_memory_patch", False):
        return

    def add_selective_attention_spy(self, tfmr, buffer_idx, layer_idx, head_idx):
        def request_attention(_module, args, kwargs):
            kwargs["output_attentions"] = True
            return args, kwargs

        def capture_attention(_module, _inputs, output):
            if isinstance(output, tuple) and len(output) > 1 and output[1] is not None:
                step_attention = output[1].detach().cpu()
                self.last_aligned_attns[buffer_idx] = step_attention[0, head_idx]

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

    analyzer_cls._add_attention_spy = add_selective_attention_spy
    analyzer_cls._voice_cloning_memory_patch = True


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
