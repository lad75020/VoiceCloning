import { describe, expect, it, vi } from 'vitest';
import { AppComponent } from './app.component';

function createComponent(): AppComponent {
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callback(0);
    return 0;
  });
  return new AppComponent(
    {} as never,
    {} as never,
    { refreshSession: vi.fn() } as never,
  );
}

describe('AppComponent Fun-CosyVoice tone picker', () => {
  it('opens before changing engines and applies selected lowercase tone tags', () => {
    const component = createComponent();

    component.selectEngine('cosyvoice');
    expect(component.voicePromptModalEngine()).toBe('cosyvoice');
    expect(component.engine()).toBe('omnivoice');

    component.toggleCosyVoiceTone('calm');
    component.toggleCosyVoiceTone('heroic');
    component.applyVoicePrompt();

    expect(component.engine()).toBe('cosyvoice');
    expect(component.selectedVoicePrompt()).toBe('calm, heroic');
  });

  it('cancelling a Fun-CosyVoice selection leaves the active engine unchanged', () => {
    const component = createComponent();

    component.selectEngine('cosyvoice');
    component.toggleCosyVoiceTone('wise');
    component.closeVoicePromptModal();

    expect(component.engine()).toBe('omnivoice');
    expect(component.selectedVoicePrompt()).toBe('');
  });
});

describe('AppComponent Qwen3 TTS selection', () => {
  it('selects Qwen immediately without a prompt modal and still requires a reference voice', () => {
    const component = createComponent();

    component.selectEngine('mlx-qwen');

    expect(component.engine()).toBe('mlx-qwen');
    expect(component.voicePromptModalEngine()).toBeNull();
    expect(component.supportsVoicePrompt('mlx-qwen')).toBe(false);

    component.text.set('Reference-cloned Qwen speech.');
    expect(component.canGenerate()).toBe(false);
    component.voiceId.set('reference-voice-id');
    expect(component.canGenerate()).toBe(true);
  });

  it('sends the required reference voice but no voice_prompt', async () => {
    const generate = vi.fn((..._args: unknown[]) => ({
      toPromise: vi.fn().mockRejectedValue(new Error('stop after request capture')),
    }));
    const component = new AppComponent(
      {} as never,
      { generate } as never,
      { refreshSession: vi.fn() } as never,
    );
    component.selectEngine('mlx-qwen');
    component.voiceId.set('reference-voice-id');
    component.text.set('Qwen clones this reference voice.');

    await component.generate();

    expect(generate).toHaveBeenCalledWith(expect.objectContaining({
      engine: 'mlx-qwen',
      voiceId: 'reference-voice-id',
    }));
    expect(generate.mock.calls[0][0] as Record<string, unknown>).not.toHaveProperty('voice_prompt');
  });
});
