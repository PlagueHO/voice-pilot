export const PCM_ENCODER_WORKLET_NAME = "voicepilot-pcm-encoder";

const PCM_ENCODER_WORKLET_SOURCE = `
const EXPECTED_RENDER_QUANTUM_FRAMES = 128;

class VoicePilotPcmEncoderProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._sequence = 0;
    this._underrunCount = 0;
    this._overrunCount = 0;
  }

  process(inputs) {
    const input = inputs[0];
    const expected = EXPECTED_RENDER_QUANTUM_FRAMES;
    this._sequence += 1;

    if (!input || input.length === 0) {
      this._underrunCount += 1;
      this.port.postMessage({
        type: 'render-quantum',
        frameCount: 0,
        expectedFrameCount: expected,
        underrun: true,
        overrun: false,
        droppedFrames: expected,
        timestamp: currentTime,
        sequence: this._sequence,
        totals: {
          underrunCount: this._underrunCount,
          overrunCount: this._overrunCount,
        },
      });
      return true;
    }

    const channelData = input[0] || new Float32Array(0);
    const frameCount = channelData.length;
    const underrun = frameCount < expected;
    const overrun = frameCount > expected;

    if (underrun) {
      this._underrunCount += 1;
    } else if (overrun) {
      this._overrunCount += 1;
    }

    if (frameCount > 0) {
      const pcmBuffer = new ArrayBuffer(frameCount * 2);
      const view = new DataView(pcmBuffer);

      for (let i = 0; i < frameCount; i++) {
        const sample = Math.max(-1, Math.min(1, channelData[i]));
        const value = sample < 0 ? Math.round(sample * 0x8000) : Math.round(sample * 0x7fff);
        view.setInt16(i * 2, value, true);
      }

      this.port.postMessage(pcmBuffer, [pcmBuffer]);
    }

    const droppedFrames = underrun ? expected - frameCount : 0;
    this.port.postMessage({
      type: 'render-quantum',
      frameCount,
      expectedFrameCount: expected,
      underrun,
      overrun,
      droppedFrames,
      timestamp: currentTime,
      sequence: this._sequence,
      totals: {
        underrunCount: this._underrunCount,
        overrunCount: this._overrunCount,
      },
    });

    return true;
  }
}

registerProcessor('${PCM_ENCODER_WORKLET_NAME}', VoicePilotPcmEncoderProcessor);
`;

const registeredContexts = new WeakSet<AudioContext>();

/**
 * Registers the inline PCM encoder worklet with the provided `AudioContext` if it
 * has not already been registered for that instance.
 *
 * @param context - The `AudioContext` that should host the encoder worklet.
 * @returns A promise that resolves once the worklet is available within the
 * context.
 * @throws {Error} When `AudioWorklet` is unavailable in the current environment,
 * preventing the worklet module from being loaded.
 */
export async function ensurePcmEncoderWorklet(context: AudioContext): Promise<void> {
  if (registeredContexts.has(context)) {
    return;
  }

  if (!context.audioWorklet) {
    throw new Error("AudioWorklet is not supported in the current execution environment.");
  }

  const moduleBlob = new Blob([PCM_ENCODER_WORKLET_SOURCE], {
    type: "text/javascript",
  });
  const moduleUrl = URL.createObjectURL(moduleBlob);

  try {
    await context.audioWorklet.addModule(moduleUrl);
    registeredContexts.add(context);
  } finally {
    URL.revokeObjectURL(moduleUrl);
  }
}
