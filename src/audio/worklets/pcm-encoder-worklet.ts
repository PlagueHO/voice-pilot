export const PCM_ENCODER_WORKLET_NAME = "voicepilot-pcm-encoder";

const PCM_ENCODER_WORKLET_SOURCE = `
class VoicePilotPcmEncoderProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) {
      return true;
    }

    const channelData = input[0];
    const frameCount = channelData.length;
    const pcmBuffer = new ArrayBuffer(frameCount * 2);
    const view = new DataView(pcmBuffer);

    for (let i = 0; i < frameCount; i++) {
      const sample = Math.max(-1, Math.min(1, channelData[i]));
      const value = sample < 0 ? Math.round(sample * 0x8000) : Math.round(sample * 0x7fff);
      view.setInt16(i * 2, value, true);
    }

    this.port.postMessage(pcmBuffer, [pcmBuffer]);
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
