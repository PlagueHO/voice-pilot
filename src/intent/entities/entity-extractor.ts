import * as path from "node:path";
import { Logger } from "../../core/logger";
import type {
    ExtractedEntity,
    WorkspaceContext,
} from "../intent-processor";

/**
 * Entity extraction pipeline using Chain of Responsibility pattern.
 */
export class EntityExtractor {
  private readonly logger: Logger;
  private readonly extractors: EntityExtractorStrategy[] = [];

  constructor(logger?: Logger) {
    this.logger = logger ?? new Logger("EntityExtractor");
    this.registerDefaultExtractors();
  }

  /**
   * Extract entities from transcript with workspace context.
   */
  async extract(
    transcript: string,
    workspaceContext?: WorkspaceContext,
  ): Promise<ExtractedEntity[]> {
    const entities: ExtractedEntity[] = [];

    for (const extractor of this.extractors) {
      try {
        const extracted = await extractor.extract(transcript, workspaceContext);
        entities.push(...extracted);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn("Entity extractor failed", {
          extractor: extractor.constructor.name,
          error: message,
        });
      }
    }

    return entities;
  }

  /**
   * Register default entity extractors.
   */
  private registerDefaultExtractors(): void {
    this.extractors.push(
      new FilePathExtractor(this.logger),
      new LineNumberExtractor(this.logger),
      new NumberExtractor(this.logger),
    );
  }
}

/**
 * Base interface for entity extraction strategies.
 */
interface EntityExtractorStrategy {
  extract(
    transcript: string,
    workspaceContext?: WorkspaceContext,
  ): Promise<ExtractedEntity[]>;
}

/**
 * Extract file path entities with workspace resolution.
 */
class FilePathExtractor implements EntityExtractorStrategy {
  constructor(_logger: Logger) {
    // Logger parameter kept for interface consistency but not currently used
  }

  async extract(
    transcript: string,
    workspaceContext?: WorkspaceContext,
  ): Promise<ExtractedEntity[]> {
    const pattern = /(?:file|open|edit|navigate to)\s+([a-zA-Z0-9_\-\/\\.]+)/gi;
    const matches = [...transcript.matchAll(pattern)];
    const entities: ExtractedEntity[] = [];

    for (const match of matches) {
      const rawPath = match[1];
      const resolvedPath = await this.resolveWorkspacePath(
        rawPath,
        workspaceContext,
      );

      entities.push({
        type: "FilePath",
        value: rawPath,
        normalizedValue: resolvedPath,
        confidence: resolvedPath ? 0.9 : 0.5,
        startIndex: match.index!,
        endIndex: match.index! + match[0].length,
        metadata: {
          resolved: !!resolvedPath,
          validationError: resolvedPath
            ? undefined
            : "File not found in workspace",
          extractorType: "regex",
        },
      });
    }

    return entities;
  }

  private async resolveWorkspacePath(
    rawPath: string,
    context?: WorkspaceContext,
  ): Promise<string | undefined> {
    if (!context || context.workspaceFolders.length === 0) {
      return undefined;
    }

    // Try as-is
    if (context.openFiles.includes(rawPath)) {
      return rawPath;
    }

    // Try relative to workspace root
    const candidatePath = path.join(context.workspaceFolders[0], rawPath);
    if (context.openFiles.includes(candidatePath)) {
      return candidatePath;
    }

    // Try suffix match
    const suffixMatch = context.openFiles.find((f) => f.endsWith(rawPath));
    if (suffixMatch) {
      return suffixMatch;
    }

    return undefined;
  }
}

/**
 * Extract line number entities.
 */
class LineNumberExtractor implements EntityExtractorStrategy {
  constructor(_logger: Logger) {
    // Logger parameter kept for interface consistency but not currently used
  }

  async extract(
    transcript: string,
    _workspaceContext?: WorkspaceContext,
  ): Promise<ExtractedEntity[]> {
    const pattern = /\b(?:line|row)\s+(\d+)/gi;
    const matches = [...transcript.matchAll(pattern)];
    const entities: ExtractedEntity[] = [];

    for (const match of matches) {
      const lineNumber = parseInt(match[1], 10);

      entities.push({
        type: "LineNumber",
        value: match[1],
        normalizedValue: lineNumber,
        confidence: 0.95,
        startIndex: match.index!,
        endIndex: match.index! + match[0].length,
        metadata: {
          extractorType: "regex",
          resolved: true,
        },
      });
    }

    return entities;
  }
}

/**
 * Extract generic number entities.
 */
class NumberExtractor implements EntityExtractorStrategy {
  constructor(_logger: Logger) {
    // Logger parameter kept for interface consistency but not currently used
  }

  async extract(
    transcript: string,
    _workspaceContext?: WorkspaceContext,
  ): Promise<ExtractedEntity[]> {
    const pattern = /\b(\d+(?:\.\d+)?)\b/g;
    const matches = [...transcript.matchAll(pattern)];
    const entities: ExtractedEntity[] = [];

    for (const match of matches) {
      const numValue = parseFloat(match[1]);

      entities.push({
        type: "Number",
        value: match[1],
        normalizedValue: numValue,
        confidence: 0.9,
        startIndex: match.index!,
        endIndex: match.index! + match[0].length,
        metadata: {
          extractorType: "regex",
          resolved: true,
        },
      });
    }

    return entities;
  }
}
