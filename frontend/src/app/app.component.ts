import { Component, OnDestroy, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AudioRecorderService } from './audio-recorder.service';
import { VoiceCloningService } from './voice-cloning.service';

interface LanguageOption {
  code: string;
  label: string;
}

interface EngineOption {
  id: string;
  label: string;
}

interface StoredVoiceSample {
  id: string;
  name: string;
  dataUrl: string;
  mimeType: string;
  language: string;
  createdAt: string;
  voiceId?: string;
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
})
export class AppComponent implements OnDestroy {
  private readonly storedVoicesKey = 'voice-cloning.stored-voices.v1';
  private themeMediaQuery: MediaQueryList | null = null;
  private themeChangeListener: ((event: MediaQueryListEvent) => void) | null = null;

  readonly engines: EngineOption[] = [
    { id: 'omnivoice', label: 'OmniVoice' },
    { id: 'mlx-qwen', label: 'MLX/Qwen' },
  ];

  readonly languages: LanguageOption[] = [
    { code: 'en', label: 'English' },
    { code: 'fr', label: 'Français' },
    { code: 'es', label: 'Español' },
  ];

  recordLanguage = signal<string>('en');
  textLanguage = signal<string>('en');
  engine = signal<string>('omnivoice');
  text = signal<string>('');
  voiceName = signal<string>('');
  storedVoices = signal<StoredVoiceSample[]>([]);
  selectedStoredVoiceId = signal<string | null>(null);

  isRecording = signal<boolean>(false);
  recordedBlobUrl = signal<string | null>(null);
  recordedBlob: Blob | null = null;

  voiceId = signal<string | null>(null);
  uploading = signal<boolean>(false);
  generating = signal<boolean>(false);

  generatedUrl = signal<string | null>(null);
  generationSeconds = signal<string | null>(null);
  error = signal<string | null>(null);

  canSaveVoice = computed(
    () => !!this.recordedBlobUrl() && this.voiceName().trim().length > 0 && !this.uploading(),
  );

  canGenerate = computed(
    () => !!this.voiceId() && this.text().trim().length > 0 && !this.generating(),
  );

  constructor(
    private recorder: AudioRecorderService,
    private api: VoiceCloningService,
  ) {
    this.loadStoredVoices();
    this.watchSystemTheme();
  }

  ngOnDestroy(): void {
    this.revokeUrl(this.recordedBlobUrl());
    this.revokeUrl(this.generatedUrl());
    this.recorder.cancel();
    if (this.themeMediaQuery && this.themeChangeListener) {
      this.themeMediaQuery.removeEventListener('change', this.themeChangeListener);
    }
  }

  async toggleRecording(): Promise<void> {
    this.error.set(null);
    if (this.isRecording()) {
      try {
        const blob = await this.recorder.stop();
        this.isRecording.set(false);
        this.selectedStoredVoiceId.set(null);
        this.voiceName.set('');
        this.setRecordedBlob(blob);
        await this.uploadVoice(blob);
      } catch (err: any) {
        this.isRecording.set(false);
        this.error.set(`Recording error: ${err?.message || err}`);
      }
    } else {
      try {
        await this.recorder.start();
        this.isRecording.set(true);
      } catch (err: any) {
        this.error.set(`Microphone error: ${err?.message || err}`);
      }
    }
  }

  private setRecordedBlob(blob: Blob): void {
    this.revokeUrl(this.recordedBlobUrl());
    this.recordedBlob = blob;
    this.recordedBlobUrl.set(URL.createObjectURL(blob));
  }

  async saveCurrentVoice(): Promise<void> {
    const name = this.voiceName().trim();
    if (!this.recordedBlob || !name) return;

    this.error.set(null);
    try {
      const dataUrl = await this.blobToDataUrl(this.recordedBlob);
      const existing = this.storedVoices().find(
        (voice) => voice.name.trim().toLowerCase() === name.toLowerCase(),
      );
      const savedVoice: StoredVoiceSample = {
        id: existing?.id || this.createId(),
        name,
        dataUrl,
        mimeType: this.recordedBlob.type || 'audio/webm',
        language: this.recordLanguage(),
        createdAt: existing?.createdAt || new Date().toISOString(),
        voiceId: this.voiceId() || existing?.voiceId,
      };

      const voices = [
        savedVoice,
        ...this.storedVoices().filter((voice) => voice.id !== savedVoice.id),
      ];
      this.persistStoredVoices(voices);
      this.selectedStoredVoiceId.set(savedVoice.id);
    } catch (err: any) {
      this.error.set(`Could not save voice locally: ${err?.message || err}`);
    }
  }

  async selectStoredVoice(id: string): Promise<void> {
    const voice = this.storedVoices().find((item) => item.id === id);
    if (!voice) return;

    this.error.set(null);
    this.selectedStoredVoiceId.set(id);
    this.voiceName.set(voice.name);
    this.recordLanguage.set(voice.language || 'en');

    try {
      const blob = await this.dataUrlToBlob(voice.dataUrl, voice.mimeType);
      this.setRecordedBlob(blob);
      await this.uploadVoice(blob);
      const uploadedVoiceId = this.voiceId();
      if (uploadedVoiceId) {
        this.updateStoredVoice(id, { voiceId: uploadedVoiceId });
      }
    } catch (err: any) {
      this.error.set(`Could not load saved voice: ${err?.message || err}`);
    }
  }

  deleteStoredVoice(id: string): void {
    const voices = this.storedVoices().filter((voice) => voice.id !== id);
    this.persistStoredVoices(voices);
    if (this.selectedStoredVoiceId() === id) {
      this.selectedStoredVoiceId.set(null);
    }
  }

  private async uploadVoice(blob: Blob): Promise<void> {
    this.uploading.set(true);
    this.voiceId.set(null);
    try {
      const res = await this.api.uploadVoice(blob, this.recordLanguage()).toPromise();
      if (res?.voiceId) {
        this.voiceId.set(res.voiceId);
      } else {
        this.error.set('Upload succeeded but no voiceId returned.');
      }
    } catch (err: any) {
      this.error.set(`Upload failed: ${err?.error?.error || err?.message || err}`);
    } finally {
      this.uploading.set(false);
    }
  }

  async generate(): Promise<void> {
    const id = this.voiceId();
    const textVal = this.text().trim();
    if (!id || !textVal) return;

    this.error.set(null);
    this.generating.set(true);
    this.revokeUrl(this.generatedUrl());
    this.generatedUrl.set(null);
    this.generationSeconds.set(null);

    try {
      const res = await this.api.generate({
        voiceId: id,
        text: textVal,
        language: this.textLanguage(),
        engine: this.engine(),
      }).toPromise();
      if (!res?.body) throw new Error('Empty response from server.');
      const url = URL.createObjectURL(res.body);
      this.generatedUrl.set(url);
      this.generationSeconds.set(res.headers.get('X-Generation-Duration-Seconds'));
    } catch (err: any) {
      let detail = err?.message || err;
      if (err?.error instanceof Blob) {
        try {
          const txt = await err.error.text();
          const parsed = JSON.parse(txt);
          detail = parsed?.detail || parsed?.error || txt;
        } catch { /* ignore */ }
      } else if (err?.error?.error) {
        detail = err.error.error;
      }
      this.error.set(`Generation failed: ${detail}`);
    } finally {
      this.generating.set(false);
    }
  }

  clearRecording(): void {
    this.revokeUrl(this.recordedBlobUrl());
    this.recordedBlobUrl.set(null);
    this.recordedBlob = null;
    this.voiceId.set(null);
    this.selectedStoredVoiceId.set(null);
    this.voiceName.set('');
    this.generationSeconds.set(null);
  }

  private loadStoredVoices(): void {
    if (!this.canUseLocalStorage()) return;

    try {
      const raw = window.localStorage.getItem(this.storedVoicesKey);
      if (!raw) return;

      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return;

      this.storedVoices.set(parsed.filter((voice) => (
        voice
        && typeof voice.id === 'string'
        && typeof voice.name === 'string'
        && typeof voice.dataUrl === 'string'
      )));
    } catch {
      this.storedVoices.set([]);
    }
  }

  private persistStoredVoices(voices: StoredVoiceSample[]): void {
    if (!this.canUseLocalStorage()) {
      throw new Error('Browser local storage is not available.');
    }

    window.localStorage.setItem(this.storedVoicesKey, JSON.stringify(voices));
    this.storedVoices.set(voices);
  }

  private updateStoredVoice(id: string, patch: Partial<StoredVoiceSample>): void {
    const voices = this.storedVoices().map((voice) => (
      voice.id === id ? { ...voice, ...patch } : voice
    ));
    try {
      this.persistStoredVoices(voices);
    } catch {
      // The selected voice is still usable for this session even if metadata cannot be updated.
    }
  }

  private blobToDataUrl(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.addEventListener('load', () => resolve(String(reader.result || '')));
      reader.addEventListener('error', () => reject(reader.error || new Error('Failed to read audio sample.')));
      reader.readAsDataURL(blob);
    });
  }

  private async dataUrlToBlob(dataUrl: string, mimeType: string): Promise<Blob> {
    const res = await fetch(dataUrl);
    const blob = await res.blob();
    return blob.type ? blob : new Blob([blob], { type: mimeType || 'audio/webm' });
  }

  private createId(): string {
    return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  private canUseLocalStorage(): boolean {
    try {
      return typeof window !== 'undefined' && !!window.localStorage;
    } catch {
      return false;
    }
  }

  private watchSystemTheme(): void {
    if (typeof window === 'undefined' || typeof document === 'undefined' || !window.matchMedia) {
      return;
    }

    this.themeMediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    this.applyColorMode(this.themeMediaQuery.matches);
    this.themeChangeListener = (event) => this.applyColorMode(event.matches);
    this.themeMediaQuery.addEventListener('change', this.themeChangeListener);
  }

  private applyColorMode(prefersDark: boolean): void {
    document.documentElement.setAttribute('data-bs-theme', prefersDark ? 'dark' : 'light');
    document.documentElement.style.colorScheme = prefersDark ? 'dark' : 'light';
  }

  private revokeUrl(url: string | null): void {
    if (url) {
      try { URL.revokeObjectURL(url); } catch { /* ignore */ }
    }
  }
}
