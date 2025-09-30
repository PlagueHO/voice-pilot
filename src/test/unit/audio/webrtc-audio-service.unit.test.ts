
import * as assert from "assert";
import { WebRTCAudioService } from "../../../audio/webrtc-audio-service";
import { WebRTCConfigFactory } from "../../../audio/webrtc-config-factory";
import { Logger } from "../../../core/logger";
import type { RealtimeEvent, ResponseCreateEvent, SessionUpdateEvent } from "../../../types/realtime-events";

class TransportStub {
  public readonly messages: RealtimeEvent[] = [];
  public disposed = false;

  async sendDataChannelMessage(message: RealtimeEvent): Promise<void> {
    this.messages.push(message);
  }

  dispose(): void {
    this.disposed = true;
  }
}

describe("WebRTCAudioService realtime orchestration", () => {
  let service: WebRTCAudioService;
  let transport: TransportStub;
  let logger: Logger;

  beforeEach(() => {
    logger = new Logger("WebRTCAudioServiceTest");
    logger.setLevel("error");
    service = new WebRTCAudioService(undefined, undefined, undefined, logger);
    transport = new TransportStub();

    const configFactory = new WebRTCConfigFactory(logger);
    const config = configFactory.createTestConfig();

    (service as any).transport = transport;
    (service as any).initialized = true;
    (service as any).isSessionActive = true;
    (service as any).activeRealtimeConfig = config;
    (service as any).applySessionPreferencesToConfig(config);
  });

  afterEach(() => {
    service.dispose();
    logger.dispose();
  });

  it("sends session update, conversation item, and response create in order", async () => {
    await service.sendTextMessage("Hello there");

    assert.deepStrictEqual(
      transport.messages.map((event) => event.type),
      ["session.update", "conversation.item.create", "response.create"],
    );

    const sessionUpdate = transport.messages[0] as SessionUpdateEvent;
    assert.deepStrictEqual(sessionUpdate.session.modalities, ["audio", "text"]);
    assert.deepStrictEqual(sessionUpdate.session.output_modalities, ["audio", "text"]);

    const responseCreate = transport.messages[2] as ResponseCreateEvent;
    assert.deepStrictEqual(responseCreate.response?.modalities, ["audio", "text"]);
    assert.deepStrictEqual(responseCreate.response?.output_modalities, ["audio", "text"]);
  });

  it("prevents duplicate response.create dispatch while a response is pending", async () => {
    await service.sendTextMessage("First turn");

    await assert.rejects(
      () => service.sendTextMessage("Second turn"),
      /already pending/,
    );

    await (service as any).handleDataChannelMessage({
      type: "response.created",
      response: {
        id: "resp_1",
        object: "realtime.response",
        status: "in_progress",
        output: [],
      },
    });

    await (service as any).handleDataChannelMessage({
      type: "response.done",
      response: {
        id: "resp_1",
        object: "realtime.response",
        status: "completed",
        output: [],
      },
    });

    transport.messages.length = 0;
    await service.sendTextMessage("Second turn");
    assert.strictEqual(transport.messages[0].type, "session.update");
  });

  it("pushes updated voice and instructions through session.update", async () => {
    await service.updateSessionPreferences({
      voice: "phoebe",
      instructions: "Keep answers brief",
    });

    transport.messages.length = 0;

    await service.sendTextMessage("Configure session");

    const sessionUpdate = transport.messages[0] as SessionUpdateEvent;
    assert.strictEqual(sessionUpdate.session.voice, "phoebe");
    assert.strictEqual(sessionUpdate.session.instructions, "Keep answers brief");

    const responseCreate = transport.messages[2] as ResponseCreateEvent;
    assert.strictEqual(responseCreate.response?.voice, "phoebe");
    assert.strictEqual(responseCreate.response?.instructions, "Keep answers brief");
  });

  it("invokes transcript callback for completion events", async () => {
    const transcripts: string[] = [];
    (service as any).onTranscriptReceived((text: string) => {
      transcripts.push(text);
      return Promise.resolve();
    });

    await (service as any).handleDataChannelMessage({
      type: "response.output_text.done",
      text: "All set",
    });

    assert.deepStrictEqual(transcripts, ["All set"]);
  });
});
