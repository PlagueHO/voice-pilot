import { ApiClient } from "./api-client";

/**
 * Provides helper methods for preparing and creating GitHub issues through the
 * configured {@link ApiClient}. The class is responsible for orchestrating API
 * calls and exposing convenience helpers used by higher-level workflows.
 */
export class IssueCreator {
  private apiClient: ApiClient;

  /**
   * Creates a new {@link IssueCreator} bound to the supplied API client.
   *
   * @param apiClient - Client used to communicate with the GitHub issue API.
   */
  constructor(apiClient: ApiClient) {
    this.apiClient = apiClient;
  }

  /**
   * Creates a GitHub issue in the provided repository.
   *
   * @param repo - Repository slug in the form `owner/name`.
   * @param title - Issue title to submit.
   * @param body - Markdown-formatted issue body.
   *
   * @throws Error when the underlying API request fails.
   */
  async createIssue(repo: string, title: string, body: string): Promise<void> {
    try {
      await this.apiClient.createIssue(repo, title, body);
      console.log(`Issue created successfully in ${repo}`);
    } catch (error) {
      console.error("Failed to create issue:", error);
      throw error;
    }
  }

  /**
   * Generates a Markdown issue draft that callers can further edit before
   * submission.
   *
   * @param title - Proposed issue title.
   * @param description - Description or reproduction details for the issue.
   *
   * @returns Markdown suitable for use as an issue body.
   */
  async draftIssue(title: string, description: string): Promise<string> {
    return `### ${title}\n\n${description}`;
  }
}
