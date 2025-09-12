import { OpenAIRealtimeWS } from "openai/beta/realtime/ws";
import { DefaultAzureCredential, getBearerTokenProvider } from "@azure/identity";

export class STTService {
    private realtimeClient: any;
    private isRecording: boolean = false;

    constructor(private endpoint: string, private deploymentName: string, private apiVersion: string) {
        this.initializeClient();
    }

    private async initializeClient() {
        const credential = new DefaultAzureCredential();
        const scope = "https://cognitiveservices.azure.com/.default";
        const azureADTokenProvider = getBearerTokenProvider(credential, scope);

        this.realtimeClient = await OpenAIRealtimeWS.azure({
            azureADTokenProvider,
            apiVersion: this.apiVersion,
            deployment: this.deploymentName,
            endpoint: this.endpoint,
        });
    }

    public startRecording() {
        if (this.isRecording) {
            console.log("Already recording.");
            return;
        }

        this.isRecording = true;
        this.realtimeClient.socket.on("open", () => {
            console.log("STT connection opened!");
            // Additional logic to handle audio input can be added here
        });

        this.realtimeClient.socket.on("close", () => {
            console.log("STT connection closed!");
            this.isRecording = false;
        });
    }

    public stopRecording() {
        if (!this.isRecording) {
            console.log("Not currently recording.");
            return;
        }

        this.realtimeClient.close();
        this.isRecording = false;
        console.log("Stopped recording.");
    }

    // Additional methods for processing audio input can be added here
}