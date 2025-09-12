import { DefaultAzureCredential } from "@azure/identity";
import { OpenAIRealtimeWS } from "openai/beta/realtime/ws";
import { AzureOpenAI } from "openai";

export class AzureService {
    private endpoint: string;
    private deploymentName: string;
    private apiVersion: string;
    private credential: DefaultAzureCredential;

    constructor() {
        this.endpoint = process.env.AZURE_OPENAI_ENDPOINT || "AZURE_OPENAI_ENDPOINT";
        this.deploymentName = process.env.AZURE_OPENAI_DEPLOYMENT_NAME || "gpt-realtime";
        this.apiVersion = process.env.OPENAI_API_VERSION || "2025-08-28";
        this.credential = new DefaultAzureCredential();
    }

    public async initializeRealtimeClient(): Promise<OpenAIRealtimeWS> {
        const scope = "https://cognitiveservices.azure.com/.default";
        const azureADTokenProvider = this.credential.getToken(scope);
        
        const azureOpenAIClient = new AzureOpenAI({
            azureADTokenProvider,
            apiVersion: this.apiVersion,
            deployment: this.deploymentName,
            endpoint: this.endpoint,
        });

        return await OpenAIRealtimeWS.azure(azureOpenAIClient);
    }
}