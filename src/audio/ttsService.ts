import { SpeechSynthesis, SpeechSynthesisVoice } from '@azure/cognitiveservices-speech-sdk';

export class TTSService {
    private speechSynthesizer: SpeechSynthesis;

    constructor() {
        const speechConfig = SpeechSynthesis.createSpeechConfig({
            subscriptionKey: process.env.AZURE_TTS_KEY || '',
            region: process.env.AZURE_TTS_REGION || ''
        });
        this.speechSynthesizer = new SpeechSynthesis(speechConfig);
    }

    public async speak(text: string): Promise<void> {
        return new Promise((resolve, reject) => {
            const result = this.speechSynthesizer.speakText(text);
            result.onComplete = () => {
                resolve();
            };
            result.onError = (error) => {
                reject(error);
            };
        });
    }

    public stop(): void {
        this.speechSynthesizer.stopSpeaking();
    }
}