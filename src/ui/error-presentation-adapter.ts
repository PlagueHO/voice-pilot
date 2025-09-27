import { randomUUID } from 'crypto';
import type { ErrorPresentationAdapter, VoicePilotError } from '../types/error/voice-pilot-error';
import { StatusBar } from './status-bar';
import type { VoiceControlPanel } from './voice-control-panel';

export class ErrorPresenter implements ErrorPresentationAdapter {
  constructor(private readonly panel: VoiceControlPanel, private readonly statusBar: StatusBar) {}

  async showStatusBarBadge(error: VoicePilotError): Promise<void> {
    this.statusBar.showError(error);
  }

  async showPanelBanner(error: VoicePilotError): Promise<void> {
    this.panel.setErrorBanner({
      code: error.code,
      summary: error.message,
      remediation: error.remediation
    });
  }

  async appendTranscriptNotice(error: VoicePilotError): Promise<void> {
    const entryId = `error-${error.id}-${randomUUID()}`;
    const summary = `[${error.faultDomain.toUpperCase()}] ${error.message}`;
    this.panel.appendTranscript({
      entryId,
      speaker: 'voicepilot',
      content: summary,
      timestamp: new Date().toISOString(),
      confidence: 1
    });
  }

  async clearSuppressedNotifications(_domain: VoicePilotError['faultDomain']): Promise<void> {
    this.statusBar.showReady();
    this.panel.setErrorBanner(null);
  }
}
