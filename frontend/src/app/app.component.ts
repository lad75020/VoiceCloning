import { Component, ElementRef, OnDestroy, ViewChild, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AudioRecorderService } from './audio-recorder.service';
import { OpenVoiceStyleAmounts, VoiceCloningService } from './voice-cloning.service';
import { AuthService } from './auth.service';

interface LanguageOption {
  code: string;
  label: string;
}

interface EngineOption {
  id: string;
  label: string;
  subtitle: string;
}

type VoicePromptEngine = 'omnivoice' | 'mlx-qwen';

interface StoredVoiceSample {
  id: string;
  name: string;
  dataUrl: string;
  mimeType: string;
  language: string;
  createdAt: string;
  voiceId?: string;
}

type OpenVoiceStyleKey = keyof OpenVoiceStyleAmounts;

const OPENVOICE_STYLE_CONTROLS: ReadonlyArray<{ key: OpenVoiceStyleKey; label: string }> = [
  { key: 'happy', label: 'Happy' },
  { key: 'sad', label: 'Sad' },
  { key: 'terrified', label: 'Terrified' },
  { key: 'cheerful', label: 'Cheerful' },
  { key: 'friendly', label: 'Friendly' },
];

function emptyOpenVoiceStyles(): OpenVoiceStyleAmounts {
  return { happy: 0, sad: 0, terrified: 0, cheerful: 0, friendly: 0 };
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
  private readonly themeKey = 'voice-cloning.theme.v1';
  private themeMediaQuery: MediaQueryList | null = null;
  private themeChangeListener: ((event: MediaQueryListEvent) => void) | null = null;
  private themeOverride: 'light' | 'dark' | null = null;
  private styleModalReturnFocus: HTMLElement | null = null;
  private voicePromptModalReturnFocus: HTMLElement | null = null;

  @ViewChild('styleDialog') styleDialog?: ElementRef<HTMLDivElement>;
  @ViewChild('voicePromptDialog') voicePromptDialog?: ElementRef<HTMLDivElement>;

  readonly omnivoiceInstructOptions = [
    'male', 'female', 'child', 'teenager', 'young adult', 'middle-aged', 'elderly',
    'american accent', 'australian accent', 'british accent', 'canadian accent',
    'chinese accent', 'indian accent', 'japanese accent', 'korean accent',
    'portuguese accent', 'russian accent', 'very high pitch', 'high pitch',
    'moderate pitch', 'low pitch', 'very low pitch', 'whisper',
  ] as const;

  readonly engines: EngineOption[] = [
    { id: 'omnivoice', label: 'OmniVoice', subtitle: 'k2-fsa · multilingual' },
    { id: 'mlx-qwen', label: 'MLX/Qwen', subtitle: 'Apple Silicon · MLX' },
    { id: 'chatterbox', label: 'Chatterbox', subtitle: 'Reference prompt · multilingual' },
    { id: 'cosyvoice', label: 'CosyVoice', subtitle: 'Cross-lingual · no ref transcript' },
    { id: 'f5-tts', label: 'F5-TTS', subtitle: 'Built-in ASR · CLI clone' },
    { id: 'openvoice', label: 'OpenVoice V2', subtitle: 'MeloTTS + tone conversion' },
  ];

  readonly languages: LanguageOption[] = [
    { code: 'en', label: 'English' },
    { code: 'fr', label: 'Français' },
    { code: 'es', label: 'Español' },
  ];

  readonly openVoiceStyleControls = OPENVOICE_STYLE_CONTROLS;

  recordLanguage = signal<string>('en');
  textLanguage = signal<string>('en');
  engine = signal<string>('omnivoice');
  openVoiceStyles = signal<OpenVoiceStyleAmounts>(emptyOpenVoiceStyles());
  draftOpenVoiceStyles = signal<OpenVoiceStyleAmounts>(emptyOpenVoiceStyles());
  styleModalOpen = signal<boolean>(false);
  voicePrompts = signal<Record<VoicePromptEngine, string>>({ omnivoice: '', 'mlx-qwen': '' });
  draftVoicePrompt = signal<string>('');
  voicePromptModalEngine = signal<VoicePromptEngine | null>(null);
  text = signal<string>('');
  loginUsername = signal<string>('');
  loginPassword = signal<string>('');
  loginError = signal<string | null>(null);
  loggingIn = signal<boolean>(false);
  voiceName = signal<string>('');
  storedVoices = signal<StoredVoiceSample[]>([]);
  selectedStoredVoiceId = signal<string | null>(null);

  isRecording = signal<boolean>(false);
  recordedBlobUrl = signal<string | null>(null);
  recordedBlob: Blob | null = null;

  voiceId = signal<string | null>(null);
  uploading = signal<boolean>(false);
  generating = signal<boolean>(false);
  cancellingGeneration = signal<boolean>(false);
  currentGenerationJobId = signal<string | null>(null);

  generatedUrl = signal<string | null>(null);
  generationSeconds = signal<string | null>(null);
  error = signal<string | null>(null);

  canSaveVoice = computed(
    () => !!this.recordedBlobUrl() && this.voiceName().trim().length > 0 && !this.uploading(),
  );

  selectedVoicePrompt = computed(() => {
    const selectedEngine = this.engine();
    return this.supportsVoicePrompt(selectedEngine)
      ? this.voicePrompts()[selectedEngine]
      : '';
  });

  canGenerate = computed(
    () => (this.engine() === 'mlx-qwen' || !!this.voiceId())
      && this.text().trim().length > 0
      && (!this.supportsVoicePrompt(this.engine()) || this.selectedVoicePrompt().trim().length > 0)
      && !this.generating(),
  );

  modalOpen = computed(() => this.styleModalOpen() || this.voicePromptModalEngine() !== null);

  voicePromptSummary = computed(() => {
    const prompt = this.selectedVoicePrompt().trim();
    if (!prompt) return 'Not set';
    return prompt.length > 96 ? `${prompt.slice(0, 93)}…` : prompt;
  });

  hasActiveOpenVoiceStyles = computed(() => (
    Object.values(this.openVoiceStyles()).some((amount) => amount > 0)
  ));

  openVoiceStyleSummary = computed(() => {
    const active = OPENVOICE_STYLE_CONTROLS
      .map(({ key, label }) => ({ label, amount: this.openVoiceStyles()[key] }))
      .filter(({ amount }) => amount > 0)
      .map(({ label, amount }) => `${label} ${Math.round(amount * 100)}%`);
    return active.length ? active.join(' · ') : 'Neutral V2 voice';
  });

  constructor(
    private recorder: AudioRecorderService,
    private api: VoiceCloningService,
    public auth: AuthService,
  ) {
    this.loadStoredVoices();
    this.watchSystemTheme();
    this.auth.refreshSession();
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

  async login(): Promise<void> {
    const username = this.loginUsername().trim();
    const password = this.loginPassword();
    if (!username || !password) {
      this.loginError.set('Username and password are required.');
      return;
    }

    this.loginError.set(null);
    this.loggingIn.set(true);
    try {
      await this.auth.login(username, password);
      this.loginPassword.set('');
      this.error.set(null);
    } catch (err: any) {
      this.loginError.set(err?.error?.error || err?.message || 'Login failed.');
    } finally {
      this.loggingIn.set(false);
    }
  }

  async logout(): Promise<void> {
    if (this.generating()) {
      await this.cancelGeneration();
    }
    await this.auth.logout();
    this.clearRecording();
    this.revokeUrl(this.generatedUrl());
    this.generatedUrl.set(null);
    this.error.set(null);
    this.loginError.set(null);
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
    if (!textVal || (!id && this.engine() !== 'mlx-qwen')) return;

    if (this.engine() === 'openvoice' && this.hasActiveOpenVoiceStyles() && this.textLanguage() !== 'en') {
      this.error.set('OpenVoice styles are supported only for English output. Select English or reset the styles to zero.');
      return;
    }

    this.error.set(null);
    this.generating.set(true);
    const jobId = this.createId();
    this.currentGenerationJobId.set(jobId);
    this.revokeUrl(this.generatedUrl());
    this.generatedUrl.set(null);
    this.generationSeconds.set(null);

    try {
      const res = await this.api.generate({
        jobId,
        ...(typeof id === 'string' ? { voiceId: id } : {}),
        text: textVal,
        language: this.textLanguage(),
        engine: this.engine(),
        ...(this.engine() === 'openvoice' ? { styles: { ...this.openVoiceStyles() } } : {}),
        ...(this.supportsVoicePrompt(this.engine()) ? { voice_prompt: this.selectedVoicePrompt().trim() } : {}),
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
      if (String(detail).toLowerCase().includes('cancelled')) {
        this.error.set(null);
      } else {
        this.error.set(`Generation failed: ${detail}`);
      }
    } finally {
      this.generating.set(false);
      this.cancellingGeneration.set(false);
      if (this.currentGenerationJobId() === jobId) {
        this.currentGenerationJobId.set(null);
      }
    }
  }

  async cancelGeneration(): Promise<void> {
    const jobId = this.currentGenerationJobId();
    if (!jobId || this.cancellingGeneration()) return;

    this.cancellingGeneration.set(true);
    try {
      await this.api.cancelGeneration(jobId).toPromise();
    } catch (err: any) {
      const detail = err?.error?.error || err?.message || err;
      this.error.set(`Cancel failed: ${detail}`);
      this.cancellingGeneration.set(false);
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

  supportsVoicePrompt(engineId: string): engineId is VoicePromptEngine {
    return engineId === 'omnivoice' || engineId === 'mlx-qwen';
  }

  selectEngine(engineId: string, trigger: EventTarget | null = null): void {
    if (this.supportsVoicePrompt(engineId)) {
      this.openVoicePromptModal(engineId, trigger);
    } else if (engineId === 'openvoice') {
      this.openOpenVoiceStyleModal(trigger);
    } else {
      this.engine.set(engineId);
    }
  }

  openVoicePromptModal(engineId: string, trigger: EventTarget | null = null): void {
    if (!this.supportsVoicePrompt(engineId)) return;
    this.voicePromptModalReturnFocus = trigger instanceof HTMLElement
      ? trigger
      : (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    this.draftVoicePrompt.set(this.voicePrompts()[engineId]);
    this.voicePromptModalEngine.set(engineId);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => this.voicePromptDialog?.nativeElement.focus());
    });
  }

  closeVoicePromptModal(): void {
    this.voicePromptModalEngine.set(null);
    const returnFocus = this.voicePromptModalReturnFocus;
    this.voicePromptModalReturnFocus = null;
    setTimeout(() => returnFocus?.focus());
  }

  applyVoicePrompt(): void {
    const prompt = this.draftVoicePrompt().trim();
    const selectedEngine = this.voicePromptModalEngine();
    if (!prompt || !selectedEngine) return;
    this.voicePrompts.update((prompts) => ({ ...prompts, [selectedEngine]: prompt }));
    this.engine.set(selectedEngine);
    this.closeVoicePromptModal();
  }

  voicePromptModalLabel(): string {
    return this.voicePromptModalEngine() === 'omnivoice' ? 'OMNIVOICE' : 'QWEN MLX';
  }

  voicePromptModalDescription(): string {
    return this.voicePromptModalEngine() === 'omnivoice'
      ? 'Choose one or more supported voice attributes. OmniVoice does not accept free-form descriptions.'
      : 'Describe how the generated voice should sound. This is sent to Qwen as voice_prompt.';
  }

  voicePromptPlaceholder(): string {
    return 'A composed middle-aged male announcer with a deep, rich and magnetic voice…';
  }

  isOmniVoiceInstructSelected(option: string): boolean {
    return this.draftVoicePrompt().split(',').map((item) => item.trim()).includes(option);
  }

  toggleOmniVoiceInstruct(option: string): void {
    const selected = new Set(
      this.draftVoicePrompt().split(',').map((item) => item.trim()).filter(Boolean),
    );
    if (selected.has(option)) selected.delete(option);
    else selected.add(option);
    this.draftVoicePrompt.set(
      this.omnivoiceInstructOptions.filter((item) => selected.has(item)).join(', '),
    );
  }

  onVoicePromptModalKeydown(event: KeyboardEvent): void {
    this.trapModalFocus(event, this.voicePromptDialog?.nativeElement, () => this.closeVoicePromptModal());
  }

  closeVoicePromptModalOnBackdrop(event: MouseEvent): void {
    if (event.target === event.currentTarget) {
      this.closeVoicePromptModal();
    }
  }

  openOpenVoiceStyleModal(trigger: EventTarget | null = null): void {
    this.styleModalReturnFocus = trigger instanceof HTMLElement
      ? trigger
      : (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    this.draftOpenVoiceStyles.set({ ...this.openVoiceStyles() });
    this.styleModalOpen.set(true);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => this.styleDialog?.nativeElement.focus());
    });
  }

  closeOpenVoiceStyleModal(): void {
    this.styleModalOpen.set(false);
    const returnFocus = this.styleModalReturnFocus;
    this.styleModalReturnFocus = null;
    setTimeout(() => returnFocus?.focus());
  }

  applyOpenVoiceStyles(): void {
    this.openVoiceStyles.set({ ...this.draftOpenVoiceStyles() });
    this.engine.set('openvoice');
    this.closeOpenVoiceStyleModal();
  }

  resetOpenVoiceStyles(): void {
    this.draftOpenVoiceStyles.set(emptyOpenVoiceStyles());
  }

  setDraftOpenVoiceStyle(key: OpenVoiceStyleKey, percentage: number): void {
    const amount = Math.max(0, Math.min(100, Number(percentage) || 0)) / 100;
    this.draftOpenVoiceStyles.update((styles) => ({ ...styles, [key]: amount }));
  }

  openVoiceStylePercent(key: OpenVoiceStyleKey): number {
    return Math.round(this.draftOpenVoiceStyles()[key] * 100);
  }

  onStyleModalKeydown(event: KeyboardEvent): void {
    this.trapModalFocus(event, this.styleDialog?.nativeElement, () => this.closeOpenVoiceStyleModal());
  }

  private trapModalFocus(event: KeyboardEvent, dialog: HTMLElement | undefined, close: () => void): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }

    if (event.key !== 'Tab' || !dialog) return;

    const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(
      'button:not([disabled]), textarea:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
    )).filter((element) => !element.hasAttribute('hidden'));
    if (!focusable.length) {
      event.preventDefault();
      dialog.focus();
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  closeStyleModalOnBackdrop(event: MouseEvent): void {
    if (event.target === event.currentTarget) {
      this.closeOpenVoiceStyleModal();
    }
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

    try {
      const stored = window.localStorage?.getItem(this.themeKey);
      if (stored === 'light' || stored === 'dark') this.themeOverride = stored;
    } catch { /* ignore */ }

    this.themeMediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    this.applyColorMode(this.themeOverride ? this.themeOverride === 'dark' : this.themeMediaQuery.matches);
    this.themeChangeListener = (event) => {
      if (!this.themeOverride) this.applyColorMode(event.matches);
    };
    this.themeMediaQuery.addEventListener('change', this.themeChangeListener);
  }

  toggleTheme(): void {
    const currentDark = document.documentElement.getAttribute('data-bs-theme') !== 'light';
    this.themeOverride = currentDark ? 'light' : 'dark';
    try { window.localStorage?.setItem(this.themeKey, this.themeOverride); } catch { /* ignore */ }
    this.applyColorMode(this.themeOverride === 'dark');
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
