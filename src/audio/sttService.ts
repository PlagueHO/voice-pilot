import {
    DefaultAzureCredential,
    getBearerTokenProvider,
} from "@azure/identity";
import { AzureOpenAI } from "openai";
import { OpenAIRealtimeWS } from "openai/beta/realtime/ws";

export class STTService {
    private realtimeClient: OpenAIRealtimeWS | null = null;
    private isRecording: boolean = false;

    constructor(
        private endpoint: string,
        private deploymentName: string,
        private apiVersion: string
    ) {}

    private async initializeClient() {
        const credential = new DefaultAzureCredential();
        const scope = "https://cognitiveservices.azure.com/.default";
        const azureADTokenProvider = getBearerTokenProvider(credential, scope);

        const azureOpenAIClient = new AzureOpenAI({
            azureADTokenProvider,
            apiVersion: this.apiVersion,
            deployment: this.deploymentName,
            endpoint: this.endpoint,
        });

        this.realtimeClient = await OpenAIRealtimeWS.azure(azureOpenAIClient);
    }

    public async startRecording() {
        if (this.isRecording) {
            console.log("Already recording.");
            return;
        }

        if (!this.realtimeClient) {
            await this.initializeClient();
        }

        this.isRecording = true;
        this.realtimeClient!.socket.on("open", () => {
            console.log("STT connection opened!");
            this.realtimeClient!.send({
                type: "session.update",
                session: {
                    modalities: ["text", "audio"],
                    model: "gpt-4o-realtime-preview",
                },
            });
        });

        this.realtimeClient!.socket.on("close", () => {
            console.log("STT connection closed!");
            this.isRecording = false;
        });

        this.realtimeClient!.on("response.text.delta", (event: any) => {
            // Handle text output from speech recognition
            console.log("Speech to text:", event.delta);
        });
    }

    public async start() {
        return this.startRecording();
    }

    public stopRecording() {
        if (!this.isRecording || !this.realtimeClient) {
            console.log("Not currently recording.");
            return;
        }

        this.realtimeClient.close();
        this.isRecording = false;
        console.log("Stopped recording.");
    }

    public stop() {
        return this.stopRecording();
    }
}
