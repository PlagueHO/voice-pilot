import * as vscode from "vscode";

import { Logger } from "../core/logger";

const COPILOT_ID = "GitHub.copilot-chat";
const INSTALL_ACTION = "Install Copilot Chat";
const LATER_ACTION = "Later";
const RELOAD_ACTION = "Reload Window";

export interface EnsureCopilotChatOptions {
  logger?: Logger;
}

export async function ensureCopilotChatInstalled(
  options: EnsureCopilotChatOptions = {},
): Promise<boolean> {
  const { logger } = options;
  const existingExtension = vscode.extensions.getExtension(COPILOT_ID);

  if (existingExtension) {
    if (!existingExtension.isActive) {
      try {
        await existingExtension.activate();
        logger?.info("Activated Copilot Chat extension");
      } catch (error) {
        logger?.error("Failed to activate Copilot Chat extension", {
          error: describeError(error),
        });
        return false;
      }
    }
    return true;
  }

  const choice = await vscode.window.showInformationMessage(
    "The GitHub Copilot Chat extension is recommended for Copilot-based actions. Install it now?",
    INSTALL_ACTION,
    LATER_ACTION,
  );

  if (choice !== INSTALL_ACTION) {
    logger?.info("User deferred Copilot Chat installation");
    return false;
  }

  try {
    await vscode.commands.executeCommand(
      "workbench.extensions.installExtension",
      COPILOT_ID,
    );
    logger?.info("Triggered Copilot Chat marketplace installation");
  } catch (error) {
    logger?.error("Failed to install Copilot Chat extension", {
      error: describeError(error),
    });
    await vscode.window.showErrorMessage(
      `Failed to install Copilot Chat: ${getErrorMessage(error)}`,
    );
    return false;
  }

  const reloadChoice = await vscode.window.showInformationMessage(
    "Copilot Chat installed. Reload to finish setup.",
    RELOAD_ACTION,
  );
  if (reloadChoice === RELOAD_ACTION) {
    await vscode.commands.executeCommand("workbench.action.reloadWindow");
  }

  return true;
}

export function isCopilotChatAvailable(): boolean {
  return !!vscode.extensions.getExtension(COPILOT_ID);
}

function describeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      message: error.message,
      stack: error.stack,
      name: error.name,
    };
  }
  return { message: String(error) };
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
