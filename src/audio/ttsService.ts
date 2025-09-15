import * as speechsdk from "microsoft-cognitiveservices-speech-sdk";

export class TTSService {
    private speechSynthesizer: speechsdk.SpeechSynthesizer;

    constructor() {
        const speechConfig = speechsdk.SpeechConfig.fromSubscription(
            process.env.AZURE_TTS_KEY || "",
            process.env.AZURE_TTS_REGION || ""
        );
        this.speechSynthesizer = new speechsdk.SpeechSynthesizer(speechConfig);
    }

    public async speak(text: string): Promise<void> {
        return new Promise((resolve, reject) => {
            this.speechSynthesizer.speakTextAsync(
                text,
                (result) => {
                    if (
                        result.reason ===
                        speechsdk.ResultReason.SynthesizingAudioCompleted
                    ) {
                        resolve();
                    } else {
                        reject(
                            new Error(
                                `Speech synthesis failed: ${result.errorDetails}`
                            )
                        );
                    }
                },
                (error) => {
                    reject(error);
                }
            );
        });
    }

    public stop(): void {
        this.speechSynthesizer.close();
    }
}
