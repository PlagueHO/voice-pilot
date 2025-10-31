import { randomUUID } from "crypto";
import type {
  ErrorPresentationAdapter,
  AgentVoiceError,
} from "../types/error/agent-voice-error";
import { StatusBar } from "./status-bar";
import type { VoiceControlPanel } from "./voice-control-panel";

/**
 * Coordinates user-facing error notifications across the Agent Voice UI.
 * @remarks
 *  Propagates service-layer errors to both the status bar and control panel to
 *  keep the experience consistent across surfaces.
 */
export class ErrorPresenter implements ErrorPresentationAdapter {
  constructor(
    private readonly panel: VoiceControlPanel,
    private readonly statusBar: StatusBar,
  ) {}

  /**
   * Shows a status bar badge that reflects the active error state.
   * @param error - The Agent Voice error to surface.
   */
  async showStatusBarBadge(error: AgentVoiceError): Promise<void> {
    this.statusBar.showError(error);
  }

  /**
   * Displays an error banner within the control panel webview.
   * @param error - The error whose details should appear in the banner.
   */
  async showPanelBanner(error: AgentVoiceError): Promise<void> {
    this.panel.setErrorBanner({
      code: error.code,
      summary: error.message,
      remediation: error.remediation,
    });
  }

  /**
   * Adds a transcript entry summarizing the error for historical context.
   * @param error - The error that should be logged to the transcript view.
   */
  async appendTranscriptNotice(error: AgentVoiceError): Promise<void> {
    const entryId = `error-${error.id}-${randomUUID()}`;
    const summary = `[${error.faultDomain.toUpperCase()}] ${error.message}`;
    this.panel.appendTranscript({
      entryId,
      speaker: "agentvoice",
      content: summary,
      timestamp: new Date().toISOString(),
      confidence: 1,
    });
  }

  /**
   * Clears any error indicators associated with the specified fault domain.
   * @param _domain - The fault domain whose notifications should be reset.
   */
  async clearSuppressedNotifications(
    _domain: AgentVoiceError["faultDomain"],
  ): Promise<void> {
    this.statusBar.showReady();
    this.panel.setErrorBanner(null);
  }
}
