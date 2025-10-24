import * as vscode from "vscode";
import type { VoicePilotError } from "../../../src/types/error/voice-pilot-error";
import { StatusBar } from "../../../src/ui/status-bar";
import { expect } from "../../helpers/chai-setup";
import { after, afterEach, before, beforeEach, suite, test } from "../../mocha-globals";

class StatusBarItemTestDouble {
  readonly id = "voicepilot.status-bar";
  alignment = vscode.StatusBarAlignment.Right;
  priority: number | undefined = undefined;
  name: string | undefined;
  tooltip: string | vscode.MarkdownString | undefined;
  text = "";
  color: string | vscode.ThemeColor | undefined;
  backgroundColor: vscode.ThemeColor | undefined;
  command: string | vscode.Command | undefined;
  accessibilityInformation: vscode.AccessibilityInformation | undefined;
  showCalls = 0;
  disposeCalls = 0;

  show(): void {
    this.showCalls += 1;
  }

  hide(): void {}

  dispose(): void {
    this.disposeCalls += 1;
  }
}

suite("Unit: StatusBar", () => {
  let statusBarAlignmentPatched = false;
  let themeColorPatched = false;

  class ThemeColorStub {
    readonly id: string;

    constructor(id: string) {
      this.id = id;
    }
  }

  before(() => {
    if (!(vscode as unknown as Record<string, unknown>).StatusBarAlignment) {
      (vscode as unknown as Record<string, unknown>).StatusBarAlignment = {
        Left: 1,
        Right: 2,
      } satisfies Record<string, number>;
      statusBarAlignmentPatched = true;
    }

    if (!(vscode as unknown as Record<string, unknown>).ThemeColor) {
      (vscode as unknown as Record<string, unknown>).ThemeColor = ThemeColorStub;
      themeColorPatched = true;
    }
  });

  after(() => {
    if (statusBarAlignmentPatched) {
      delete (vscode as unknown as Record<string, unknown>).StatusBarAlignment;
      statusBarAlignmentPatched = false;
    }

    if (themeColorPatched) {
      delete (vscode as unknown as Record<string, unknown>).ThemeColor;
      themeColorPatched = false;
    }
  });
  const originalCreateStatusBarItem = vscode.window.createStatusBarItem;

  let createdItems: StatusBarItemTestDouble[];
  let factoryInvocations: Array<{
    alignment?: vscode.StatusBarAlignment;
    priority?: number;
  }>;
  let disposables: StatusBar[];

  beforeEach(() => {
    createdItems = [];
    factoryInvocations = [];
    disposables = [];

    (vscode.window as unknown as {
      createStatusBarItem: typeof vscode.window.createStatusBarItem;
    }).createStatusBarItem = ((
      ...args: Parameters<typeof vscode.window.createStatusBarItem>
    ) => {
      const argList = args as unknown[];
      let alignment: vscode.StatusBarAlignment | undefined;
      let priority: number | undefined;

      if (typeof argList[0] === "string") {
        alignment =
          typeof argList[1] === "number"
            ? (argList[1] as vscode.StatusBarAlignment)
            : undefined;
        priority =
          typeof argList[2] === "number" ? (argList[2] as number) : undefined;
      } else if (
        argList[0] &&
        typeof argList[0] === "object" &&
        "alignment" in (argList[0] as Record<string, unknown>)
      ) {
        const options = argList[0] as {
          alignment?: vscode.StatusBarAlignment;
          priority?: number;
        };
        alignment = options.alignment;
        priority = options.priority;
      } else {
        alignment = argList[0] as vscode.StatusBarAlignment | undefined;
        priority = argList[1] as number | undefined;
      }

      const item = new StatusBarItemTestDouble();
      item.alignment = alignment ?? vscode.StatusBarAlignment.Left;
      item.priority = priority;
      createdItems.push(item);
      factoryInvocations.push({ alignment, priority });
      return item as unknown as vscode.StatusBarItem;
    }) as typeof vscode.window.createStatusBarItem;
  });

  afterEach(() => {
    (vscode.window as unknown as {
      createStatusBarItem: typeof vscode.window.createStatusBarItem;
    }).createStatusBarItem = originalCreateStatusBarItem;

    disposables.forEach((statusBar) => statusBar.dispose());
  });

  function instantiate(): { statusBar: StatusBar; item: StatusBarItemTestDouble } {
    const statusBar = new StatusBar();
    disposables.push(statusBar);
    const item = createdItems.at(-1);
    if (!item) {
      throw new Error("Status bar item was not created");
    }
    return { statusBar, item };
  }

  test("constructor primes ready state and reveals status bar", () => {
    const { item } = instantiate();

    expect(factoryInvocations).to.deep.equal([
      { alignment: vscode.StatusBarAlignment.Right, priority: 100 },
    ]);
    expect(item.text).to.equal("$(mic) VoicePilot: Ready");
    expect(item.tooltip).to.equal("VoicePilot voice assistant");
    expect(item.showCalls).to.equal(1);
    expect(item.backgroundColor).to.be.undefined;
    expect(item.color).to.be.undefined;
    expect(item.command).to.be.undefined;
  });

  test("showReady updates text and clears styling", () => {
    const { statusBar, item } = instantiate();

    item.backgroundColor = new vscode.ThemeColor("statusBarItem.errorBackground");
    item.color = new vscode.ThemeColor("statusBarItem.prominentForeground");
    item.command = "voicepilot.startConversation";

    statusBar.showReady("Listening");

    expect(item.text).to.equal("$(mic) VoicePilot: Listening");
    expect(item.tooltip).to.equal("VoicePilot voice assistant");
    expect(item.backgroundColor).to.be.undefined;
    expect(item.color).to.be.undefined;
    expect(item.command).to.be.undefined;
  });

  test("showInfo displays informational message with fallback tooltip", () => {
    const { statusBar, item } = instantiate();

    statusBar.showInfo("Connecting");

    expect(item.text).to.equal("$(comment-discussion) VoicePilot: Connecting");
    expect(item.tooltip).to.equal("VoicePilot status");
    expect(item.backgroundColor).to.be.undefined;
    expect(item.color).to.be.undefined;
    expect(item.command).to.be.undefined;
  });

  test("showInfo honors provided tooltip", () => {
    const { statusBar, item } = instantiate();

    statusBar.showInfo("Retrying", "Retrying session setup");

    expect(item.text).to.equal("$(comment-discussion) VoicePilot: Retrying");
    expect(item.tooltip).to.equal("Retrying session setup");
  });

  test("showError applies theme colors and remediation tooltip", () => {
    const { statusBar, item } = instantiate();

    const error: VoicePilotError = {
      id: "session-recovery-failed",
      faultDomain: "session",
      severity: "error",
      userImpact: "blocked",
      code: "session.recovery.failed",
      message: "Voice session failed to recover",
      remediation: "Try reconnecting to restore voice control",
      timestamp: new Date(),
    };

    statusBar.showError(error);

    expect(item.text).to.equal("$(error) VoicePilot issue");
    expect(item.tooltip).to.equal(
      `${error.message}\n${error.remediation}`,
    );
    expect(item.backgroundColor).to.be.instanceOf(vscode.ThemeColor);
    const background = item.backgroundColor as vscode.ThemeColor | undefined;
    expect(background?.id).to.equal("statusBarItem.errorBackground");
    expect(item.color).to.be.instanceOf(vscode.ThemeColor);
    const foreground = item.color as vscode.ThemeColor | undefined;
    expect(foreground?.id).to.equal("statusBarItem.prominentForeground");
  });

  test("dispose releases underlying status bar item", () => {
    const { statusBar, item } = instantiate();

    statusBar.dispose();

    expect(item.disposeCalls).to.equal(1);
  });
});
