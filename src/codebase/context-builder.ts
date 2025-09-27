import { FileAnalyzer } from "./file-analyzer";
import { SearchService } from "./search-service";

export class ContextBuilder {
  private fileAnalyzer: FileAnalyzer;
  private searchService: SearchService;

  constructor() {
    this.fileAnalyzer = new FileAnalyzer([]);
    this.searchService = new SearchService([]);
  }

  public async buildContext(): Promise<string> {
    const openFiles = this.fileAnalyzer.analyzeFiles();
    const relevantCodeSnippets = this.searchService.search(""); // placeholder search

    return this.constructContextString(relevantCodeSnippets);
  }

  private constructContextString(snippets: string[]): string {
    return snippets.join("\n");
  }
}
