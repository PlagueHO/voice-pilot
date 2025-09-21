import { ApiClient } from "./apiClient";

export class IssueCreator {
    private apiClient: ApiClient;

    constructor(apiClient: ApiClient) {
        this.apiClient = apiClient;
    }

    async createIssue(
        repo: string,
        title: string,
        body: string
    ): Promise<void> {
        try {
            await this.apiClient.createIssue(repo, title, body);
            console.log(`Issue created successfully in ${repo}`);
        } catch (error) {
            console.error("Failed to create issue:", error);
            throw error;
        }
    }

    async draftIssue(title: string, description: string): Promise<string> {
        return `### ${title}\n\n${description}`;
    }
}
