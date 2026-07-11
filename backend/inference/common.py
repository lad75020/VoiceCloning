from __future__ import annotations

import sys
import wave
from pathlib import Path

import numpy as np


def add_repo_path(repo_path: str | None) -> None:
    if not repo_path:
        return

    resolved = str(Path(repo_path).expanduser().resolve())
    if resolved not in sys.path:
        sys.path.insert(0, resolved)


def choose_torch_device(requested: str) -> str:
    try:
        import torch
    except ImportError as exc:
        raise RuntimeError("PyTorch is required in the selected Conda environment.") from exc

    desired = (requested or "auto").strip().lower()
    cuda_available = bool(torch.cuda.is_available())
    mps_available = bool(
        getattr(torch.backends, "mps", None)
        and torch.backends.mps.is_available()
        and torch.backends.mps.is_built()
    )

    if desired == "auto":
        if cuda_available:
            return "cuda"
        if mps_available:
            return "mps"
        return "cpu"

    if desired == "cuda":
        if not cuda_available:
            raise RuntimeError("CUDA was requested but is not available in this environment.")
        return "cuda"

    if desired == "mps":
        if not mps_available:
            raise RuntimeError("MPS was requested but is not available. On Apple Silicon, verify a PyTorch build with MPS support.")
        return "mps"

    if desired == "cpu":
        return "cpu"

    raise RuntimeError(f"Unsupported device '{requested}'. Use auto, cpu, mps, or cuda.")


def tensor_to_numpy(audio) -> np.ndarray:
    if audio is None:
        raise RuntimeError("The engine returned no audio.")

    if hasattr(audio, "detach"):
        audio = audio.detach()
    if hasattr(audio, "cpu"):
        audio = audio.cpu()
    if hasattr(audio, "numpy"):
        audio = audio.numpy()

    array = np.asarray(audio, dtype=np.float32).squeeze()
    if array.ndim == 0:
        array = np.expand_dims(array, 0)
    if array.ndim > 1:
        array = array.reshape(-1)
    if array.size == 0:
        raise RuntimeError("The engine returned empty audio.")
    return array


def write_pcm16_wav(output_path: str, sample_rate: int, audio) -> None:
    samples = np.clip(tensor_to_numpy(audio), -1.0, 1.0)
    pcm = (samples * 32767.0).astype(np.int16)

    target = Path(output_path).expanduser().resolve()
    target.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(target), "wb") as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(int(sample_rate))
        wav_file.writeframes(pcm.tobytes())

    if not target.is_file() or target.stat().st_size <= 44:
        raise RuntimeError(f"Expected a non-empty WAV file at {target}, but the write was incomplete.")
