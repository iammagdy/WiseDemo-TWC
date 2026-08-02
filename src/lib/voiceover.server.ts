export type GeneratedVoiceover = {
  url: string;
  durationSeconds: number;
  provider: string;
};

export interface VoiceoverProvider {
  generate(input: { text: string; voice?: string; locale: string }): Promise<GeneratedVoiceover>;
}

export class DisabledVoiceoverProvider implements VoiceoverProvider {
  async generate(): Promise<GeneratedVoiceover> {
    throw new Error(
      "Voiceover is not configured. The storyboard will render with timed captions only.",
    );
  }
}

export function configuredVoiceoverProvider(): VoiceoverProvider {
  return new DisabledVoiceoverProvider();
}
