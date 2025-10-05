import {
  DefaultAzureCredential,
  TokenCredential,
  getBearerTokenProvider,
} from "@azure/identity";
import { AzureOpenAI } from "openai";
import { OpenAIRealtimeWS } from "openai/beta/realtime/ws";

/**
 * Configuration overrides used when instantiating {@link AzureService}.
 */
export interface AzureServiceOptions {
  /**
   * Azure OpenAI endpoint, typically in the format `https://{resource}.openai.azure.com`.
   */
  endpoint?: string;
  /**
   * Deployment name of the targeted Azure OpenAI model (for example, `gpt-realtime`).
   */
  deploymentName?: string;
  /**
   * API version used for Azure OpenAI requests.
   */
  apiVersion?: string;
  /**
   * Token credential used for Azure Active Directory authentication.
   */
  credential?: TokenCredential;
  /**
   * Scope required for obtaining Azure Active Directory tokens.
   */
  scope?: string;
}

/**
 * Provides helpers for constructing Azure OpenAI realtime websocket clients.
 */
export class AzureService {
  private readonly endpoint: string;
  private readonly deploymentName: string;
  private readonly apiVersion: string;
  private readonly credential: TokenCredential;
  private readonly scope: string;

  /**
   * Creates a new Azure service that generates realtime OpenAI clients using Azure Active Directory authentication.
   *
   * @param options - Optional overrides for endpoint configuration and credential injection.
   */
  constructor(options: AzureServiceOptions = {}) {
    const {
      endpoint = process.env.AZURE_OPENAI_ENDPOINT ?? "AZURE_OPENAI_ENDPOINT",
      deploymentName = process.env.AZURE_OPENAI_DEPLOYMENT_NAME ??
        "gpt-realtime",
      apiVersion = process.env.OPENAI_API_VERSION ?? "2025-08-28",
      credential = new DefaultAzureCredential(),
      scope = "https://cognitiveservices.azure.com/.default",
    } = options;

    this.endpoint = endpoint;
    this.deploymentName = deploymentName;
    this.apiVersion = apiVersion;
    this.credential = credential;
    this.scope = scope;
  }

  /**
   * Creates an `OpenAIRealtimeWS` client that connects to the configured Azure OpenAI deployment.
   *
   * @returns A websocket transport configured for Azure OpenAI realtime interactions.
   * @throws {Error} Propagates errors encountered while creating the token provider or websocket transport.
   */
  public async initializeRealtimeClient(): Promise<OpenAIRealtimeWS> {
    const azureADTokenProvider = getBearerTokenProvider(
      this.credential,
      this.scope,
    );

    const azureOpenAIClient = new AzureOpenAI({
      azureADTokenProvider,
      apiVersion: this.apiVersion,
      deployment: this.deploymentName,
      endpoint: this.endpoint,
    });

    return OpenAIRealtimeWS.azure(azureOpenAIClient);
  }
}
