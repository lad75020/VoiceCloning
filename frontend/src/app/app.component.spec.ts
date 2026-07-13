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
