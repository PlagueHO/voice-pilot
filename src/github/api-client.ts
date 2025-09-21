import axios from 'axios';

export class ApiClient {
    private baseUrl: string;
    private token: string | null;

    constructor(baseUrl: string, token: string | null = null) {
        this.baseUrl = baseUrl;
        this.token = token;
    }

    public setToken(token: string): void {
        this.token = token;
    }

    private getHeaders(): { [key: string]: string } {
        const headers: { [key: string]: string } = {
            'Content-Type': 'application/json',
        };
        if (this.token) {
            headers['Authorization'] = `Bearer ${this.token}`;
        }
        return headers;
    }

    public async getIssues(repo: string): Promise<any> {
        const url = `${this.baseUrl}/repos/${repo}/issues`;
        const response = await axios.get(url, { headers: this.getHeaders() });
        return response.data;
    }

    public async createIssue(repo: string, title: string, body: string): Promise<any> {
        const url = `${this.baseUrl}/repos/${repo}/issues`;
        const response = await axios.post(url, { title, body }, { headers: this.getHeaders() });
        return response.data;
    }

    // Additional methods for interacting with the GitHub API can be added here
}