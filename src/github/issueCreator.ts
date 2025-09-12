export class IssueCreator {
    private apiClient: ApiClient;

    constructor(apiClient: ApiClient) {
        this.apiClient = apiClient;
    }

    async createIssue(repo: string, title: string, body: string): Promise<void> {
        const issueData = {
            title: title,
            body: body,
        };

        try {
            await this.apiClient.post(`/repos/${repo}/issues`, issueData);
            console.log(`Issue created successfully in ${repo}`);
        } catch (error) {
            console.error("Error creating issue:", error);
        }
    }

    async draftIssue(title: string, description: string): Promise<string> {
        return `### ${title}\n\n${description}`;
    }
}