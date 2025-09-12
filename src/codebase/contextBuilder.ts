import { FileAnalyzer } from './fileAnalyzer';
import { SearchService } from './searchService';

export class ContextBuilder {
    private fileAnalyzer: FileAnalyzer;
    private searchService: SearchService;

    constructor() {
        this.fileAnalyzer = new FileAnalyzer();
        this.searchService = new SearchService();
    }

    public async buildContext(): Promise<string> {
        const openFiles = this.fileAnalyzer.analyzeOpenFiles();
        const relevantCodeSnippets = await this.searchService.searchRelevantCode(openFiles);
        
        return this.constructContextString(relevantCodeSnippets);
    }

    private constructContextString(snippets: string[]): string {
        return snippets.join('\n');
    }
}