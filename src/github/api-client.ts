import axios from "axios";

/**
 * Thin wrapper around the GitHub REST API used by Agent Voice to manage issues.
 */
export class ApiClient {
  /** GitHub API base URL (enterprise or public). */
  private baseUrl: string;
  /**
   * Optional personal access token or installation token used for
   * authenticated calls.
   */
  private token: string | null;

  /**
   * Creates a GitHub API client instance.
   *
   * @param baseUrl Base URL for the GitHub REST API.
   * @param token Optional bearer token for authenticated requests.
   */
  constructor(baseUrl: string, token: string | null = null) {
    this.baseUrl = baseUrl;
    this.token = token;
  }

  /**
   * Updates the bearer token used for authenticated GitHub requests.
   */
  public setToken(token: string): void {
    this.token = token;
  }

  /**
   * Builds the HTTP headers required for GitHub REST interactions.
   */
  private getHeaders(): { [key: string]: string } {
    const headers: { [key: string]: string } = {
      "Content-Type": "application/json",
    };
    if (this.token) {
      headers["Authorization"] = `Bearer ${this.token}`;
    }
    return headers;
  }

  /**
   * Retrieves issues for the given repository, respecting token scope.
   *
   * @param repo Repository identifier in the form "owner/name".
   * @returns Array of GitHub issue objects.
   */
  public async getIssues(repo: string): Promise<any> {
    const url = `${this.baseUrl}/repos/${repo}/issues`;
    const response = await axios.get(url, { headers: this.getHeaders() });
    return response.data;
  }

  /**
   * Creates a new issue within the specified repository.
   *
   * @param repo Repository identifier in the form "owner/name".
   * @param title Issue title.
   * @param body Markdown-formatted issue description.
   */
  public async createIssue(
    repo: string,
    title: string,
    body: string,
  ): Promise<any> {
    const url = `${this.baseUrl}/repos/${repo}/issues`;
    const response = await axios.post(
      url,
      { title, body },
      { headers: this.getHeaders() },
    );
    return response.data;
  }

  // Additional methods for interacting with the GitHub API can be added here
}
