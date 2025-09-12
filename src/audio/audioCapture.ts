export class AudioCapture {
    private mediaRecorder: MediaRecorder | null = null;
    private audioChunks: Blob[] = [];

    constructor() {
        this.initializeAudioCapture();
    }

    private async initializeAudioCapture() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            this.mediaRecorder = new MediaRecorder(stream);

            this.mediaRecorder.ondataavailable = (event) => {
                this.audioChunks.push(event.data);
            };

            this.mediaRecorder.onstop = this.onStopRecording.bind(this);
        } catch (error) {
            console.error("Error accessing microphone:", error);
        }
    }

    public startRecording() {
        if (this.mediaRecorder) {
            this.audioChunks = []; // Reset audio chunks
            this.mediaRecorder.start();
        }
    }

    public stopRecording() {
        if (this.mediaRecorder) {
            this.mediaRecorder.stop();
        }
    }

    private onStopRecording() {
        const audioBlob = new Blob(this.audioChunks, { type: 'audio/wav' });
        // Handle the audioBlob (e.g., send it to STT service)
        console.log("Recording stopped. Audio blob ready for processing.");
    }
}