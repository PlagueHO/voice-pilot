import { SearchService } from "./search-service";

// Temporary context aggregation scaffold parked under src/codebase until
// SP-020..SP-023 project-context tooling is implemented and the modules are
// relocated into their permanent home.

export class ContextBuilder {
  private searchService: SearchService;

  constructor() {
    this.searchService = new SearchService([]);
  }

  public async buildContext(): Promise<string> {
    const relevantCodeSnippets = this.searchService.search(""); // placeholder search

    return this.constructContextString(relevantCodeSnippets);
  }

  private constructContextString(snippets: string[]): string {
    return snippets.join("\n");
  }
}
