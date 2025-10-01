import { DefaultAzureCredential } from "@azure/identity";

/**
 * Provides Azure Active Directory authentication primitives for the extension.
 *
 * @remarks
 * The service encapsulates {@link DefaultAzureCredential} so callers can request
 * scoped access tokens without handling credential fallbacks directly.
 */
export class AuthService {
  private credential: DefaultAzureCredential;

  constructor() {
    this.credential = new DefaultAzureCredential();
  }

  /**
   * Retrieves an Azure Active Directory access token for the requested scope.
   *
   * @param scope - The target resource scope, for example
   * `'https://cognitiveservices.azure.com/.default'`.
   * @returns A bearer token string suitable for authorization headers.
   * @throws Error when a token cannot be obtained.
   */
  public async getToken(scope: string): Promise<string> {
    const tokenResponse = await this.credential.getToken(scope);

    if (!tokenResponse?.token) {
      throw new Error(`Failed to acquire access token for scope: ${scope}`);
    }

    return tokenResponse.token;
  }

  /**
   * Performs authentication housekeeping such as prefetching or refreshing tokens.
   */
  public async authenticate(): Promise<void> {
    // Implement authentication logic here
    // This could involve checking for existing tokens, refreshing them, etc.
  }

  /**
   * Clears any authentication state maintained by the extension.
   */
  public async logout(): Promise<void> {
    // Implement logout logic here
    // This could involve clearing tokens or session data
  }
}
