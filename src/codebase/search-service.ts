export class SearchService {
    private files: string[];

    constructor(files: string[]) {
        this.files = files;
    }

    public search(query: string): string[] {
        const results: string[] = [];
        this.files.forEach(file => {
            const content = this.readFileContent(file);
            if (this.matchesQuery(content, query)) {
                results.push(file);
            }
        });
        return results;
    }

    private readFileContent(file: string): string {
        // Logic to read the content of the file
        // This is a placeholder; actual implementation will depend on the file system access
        return ""; // Return file content as a string
    }

    private matchesQuery(content: string, query: string): boolean {
        return content.includes(query);
    }
}