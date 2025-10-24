"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const audio_context_provider_1 = require("../../src/../audio/audio-context-provider");
const audio_track_manager_1 = require("../../src/../audio/audio-track-manager");
const logger_1 = require("../../src/../core/logger");
const webrtc_1 = require("../../src/../types/webrtc");
const chai_setup_1 = require("../../src/helpers/chai-setup");
const mocha_globals_1 = require("../../src/mocha-globals");
const audio_mock_environment_1 = require("./audio-mock-environment");
class MockTransport {
    addCalls = [];
    removeCalls = [];
    replaceCalls = [];
    publishedEvents = [];
    stats;
    fallback = false;
    async establishConnection() {
        return {
            success: true,
            connectionId: "mock",
            connectionState: webrtc_1.WebRTCConnectionState.Connected,
            audioTracks: [],
        };
    }
    async closeConnection() { }
    async restartIce(_config) {
        return true;
    }
    async recreateDataChannel(_config) {
        return null;
    }
    getConnectionState() {
        return webrtc_1.WebRTCConnectionState.Connected;
    }
    getConnectionStatistics() {
        if (!this.stats) {
            throw new Error("stats not set");
        }
        return this.stats;
    }
    getDataChannelState() {
        return "open";
    }
    isDataChannelFallbackActive() {
        return this.fallback;
    }
    publishRecoveryEvent(event) {
        this.publishedEvents.push(event);
    }
    async addAudioTrack(track, options) {
        this.addCalls.push({ track, options });
    }
    async replaceAudioTrack(oldTrack, newTrack, options) {
        this.replaceCalls.push({ oldTrack, newTrack, options });
    }
    async removeAudioTrack(track) {
        this.removeCalls.push(track);
    }
    getRemoteAudioStream() {
        return null;
    }
    getAudioContext() {
        return null;
    }
    async sendDataChannelMessage(_message) { }
    addEventListener(_type, _handler) { }
    removeEventListener(_type, _handler) { }
}
(0, mocha_globals_1.suite)("Unit: AudioTrackManager", () => {
    const audioConfig = {
        sampleRate: 24000,
        codecProfileId: "pcm16-24k-mono",
        format: "pcm16",
        channels: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        audioContextProvider: {
            strategy: "shared",
            latencyHint: "interactive",
            resumeOnActivation: false,
            requiresUserGesture: false,
        },
        workletModuleUrls: [],
    };
    let env = (0, audio_mock_environment_1.installMockAudioEnvironment)();
    (0, mocha_globals_1.afterEach)(() => {
        env.restore();
        env = (0, audio_mock_environment_1.installMockAudioEnvironment)();
    });
    (0, mocha_globals_1.test)("captures microphone audio through the processing graph", async () => {
        const logger = new logger_1.Logger("AudioTrackManagerTest");
        logger.setLevel("error");
        const provider = new audio_context_provider_1.AudioContextProvider();
        const manager = new audio_track_manager_1.AudioTrackManager(logger, provider);
        const capturedStreams = [];
        const originalGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
        navigator.mediaDevices.getUserMedia = async (constraints) => {
            const result = (await originalGetUserMedia(constraints));
            capturedStreams.push(result);
            return result;
        };
        try {
            await manager.initialize();
            manager.setAudioConfiguration(audioConfig);
            const processedTrack = await manager.captureMicrophone();
            (0, chai_setup_1.expect)(processedTrack, "Processed track should be returned").to.exist;
            const rawStream = capturedStreams[0];
            const rawTrack = rawStream?.getAudioTracks()[0];
            (0, chai_setup_1.expect)(rawTrack, "Capture pipeline should retain raw input track").to.exist;
            (0, chai_setup_1.expect)(processedTrack.id, "Processed track must differ from raw microphone track").to.not.equal(rawTrack?.id);
        }
        finally {
            navigator.mediaDevices.getUserMedia = originalGetUserMedia;
            manager.dispose();
            logger.dispose();
        }
    });
    (0, mocha_globals_1.test)("propagates mute state to underlying input track", async () => {
        const logger = new logger_1.Logger("AudioTrackManagerTestMute");
        logger.setLevel("error");
        const provider = new audio_context_provider_1.AudioContextProvider();
        const manager = new audio_track_manager_1.AudioTrackManager(logger, provider);
        try {
            await manager.initialize();
            manager.setAudioConfiguration(audioConfig);
            const processedTrack = await manager.captureMicrophone();
            const rawTrack = env.capturedStreams[0].getAudioTracks()[0];
            manager.setTrackMuted(processedTrack.id, true);
            (0, chai_setup_1.expect)(processedTrack.enabled).to.be.false;
            (0, chai_setup_1.expect)(rawTrack.enabled).to.be.false;
            manager.setTrackMuted(processedTrack.id, false);
            (0, chai_setup_1.expect)(processedTrack.enabled).to.be.true;
            (0, chai_setup_1.expect)(rawTrack.enabled).to.be.true;
        }
        finally {
            manager.dispose();
            logger.dispose();
        }
    });
    (0, mocha_globals_1.test)("stops and cleans up capture graph when track ends", async () => {
        const logger = new logger_1.Logger("AudioTrackManagerTestStop");
        logger.setLevel("error");
        const provider = new audio_context_provider_1.AudioContextProvider();
        const manager = new audio_track_manager_1.AudioTrackManager(logger, provider);
        try {
            await manager.initialize();
            manager.setAudioConfiguration(audioConfig);
            const processedTrack = await manager.captureMicrophone();
            const rawTrack = env.capturedStreams[0].getAudioTracks()[0];
            manager.stopTrack(processedTrack.id);
            (0, chai_setup_1.expect)(processedTrack.readyState).to.equal("ended");
            (0, chai_setup_1.expect)(rawTrack.readyState).to.equal("ended");
        }
        finally {
            manager.dispose();
            logger.dispose();
        }
    });
    (0, mocha_globals_1.test)("keeps adaptive sample rates within supported bounds", async () => {
        const logger = new logger_1.Logger("AudioTrackManagerSampleRateTest");
        logger.setLevel("error");
        const provider = new audio_context_provider_1.AudioContextProvider();
        const manager = new audio_track_manager_1.AudioTrackManager(logger, provider);
        try {
            await manager.initialize();
            manager.setAudioConfiguration(audioConfig);
            manager.adjustAudioQuality(webrtc_1.ConnectionQuality.Poor);
            (0, chai_setup_1.expect)(manager.audioConstraints.sampleRate, "Sample rate should clamp to 16 kHz for poor networks")
                .to.equal(16000);
            manager.adjustAudioQuality(webrtc_1.ConnectionQuality.Excellent);
            (0, chai_setup_1.expect)(manager.audioConstraints.sampleRate, "Sample rate should scale up to 48 kHz when excellent")
                .to.equal(48000);
            manager.adjustAudioQuality(webrtc_1.ConnectionQuality.Failed);
            (0, chai_setup_1.expect)(manager.audioConstraints.sampleRate, "Failed state should not reduce sample rate below negotiated bounds")
                .to.equal(48000);
        }
        finally {
            manager.dispose();
            logger.dispose();
        }
    });
    (0, mocha_globals_1.test)("throws during initialization when getUserMedia is unavailable", async () => {
        const logger = new logger_1.Logger("AudioTrackManagerInitGuard");
        logger.setLevel("error");
        const provider = new audio_context_provider_1.AudioContextProvider();
        const manager = new audio_track_manager_1.AudioTrackManager(logger, provider);
        const original = navigator.mediaDevices.getUserMedia;
        delete navigator.mediaDevices.getUserMedia;
        try {
            await (0, chai_setup_1.expect)(manager.initialize()).to.be.rejectedWith(/getUserMedia not supported/);
        }
        finally {
            navigator.mediaDevices.getUserMedia = original;
            manager.dispose();
            logger.dispose();
        }
    });
    (0, mocha_globals_1.test)("wraps NotAllowedError into non-recoverable WebRTCError", async () => {
        const logger = new logger_1.Logger("AudioTrackManagerNotAllowed");
        logger.setLevel("error");
        const provider = new audio_context_provider_1.AudioContextProvider();
        const manager = new audio_track_manager_1.AudioTrackManager(logger, provider);
        const original = navigator.mediaDevices.getUserMedia;
        navigator.mediaDevices.getUserMedia = async () => {
            const error = new Error("denied");
            error.name = "NotAllowedError";
            throw error;
        };
        try {
            await manager.initialize();
            manager.setAudioConfiguration(audioConfig);
            await manager
                .captureMicrophone()
                .then(() => chai_setup_1.expect.fail("captureMicrophone should reject when permission denied"))
                .catch((error) => {
                (0, chai_setup_1.expect)(error).to.be.instanceOf(webrtc_1.WebRTCErrorImpl);
                (0, chai_setup_1.expect)(error.code).to.equal(webrtc_1.WebRTCErrorCode.AudioTrackFailed);
                (0, chai_setup_1.expect)(error.recoverable).to.be.false;
            });
        }
        finally {
            navigator.mediaDevices.getUserMedia = original;
            manager.dispose();
            logger.dispose();
        }
    });
    (0, mocha_globals_1.test)("marks NotFoundError as non-recoverable when microphone missing", async () => {
        const logger = new logger_1.Logger("AudioTrackManagerNotFound");
        logger.setLevel("error");
        const provider = new audio_context_provider_1.AudioContextProvider();
        const manager = new audio_track_manager_1.AudioTrackManager(logger, provider);
        const original = navigator.mediaDevices.getUserMedia;
        navigator.mediaDevices.getUserMedia = async () => {
            const error = new Error("missing");
            error.name = "NotFoundError";
            throw error;
        };
        try {
            await manager.initialize();
            manager.setAudioConfiguration(audioConfig);
            await manager
                .captureMicrophone()
                .then(() => chai_setup_1.expect.fail("captureMicrophone should reject when device missing"))
                .catch((error) => {
                (0, chai_setup_1.expect)(error).to.be.instanceOf(webrtc_1.WebRTCErrorImpl);
                (0, chai_setup_1.expect)(error.code).to.equal(webrtc_1.WebRTCErrorCode.AudioTrackFailed);
                (0, chai_setup_1.expect)(error.recoverable).to.be.false;
            });
        }
        finally {
            navigator.mediaDevices.getUserMedia = original;
            manager.dispose();
            logger.dispose();
        }
    });
    (0, mocha_globals_1.test)("treats unexpected capture errors as recoverable", async () => {
        const logger = new logger_1.Logger("AudioTrackManagerGenericError");
        logger.setLevel("error");
        const provider = new audio_context_provider_1.AudioContextProvider();
        const manager = new audio_track_manager_1.AudioTrackManager(logger, provider);
        const original = navigator.mediaDevices.getUserMedia;
        navigator.mediaDevices.getUserMedia = async () => {
            throw new Error("transient failure");
        };
        try {
            await manager.initialize();
            manager.setAudioConfiguration(audioConfig);
            await manager
                .captureMicrophone()
                .then(() => chai_setup_1.expect.fail("captureMicrophone should reject on unexpected errors"))
                .catch((error) => {
                (0, chai_setup_1.expect)(error).to.be.instanceOf(webrtc_1.WebRTCErrorImpl);
                (0, chai_setup_1.expect)(error.code).to.equal(webrtc_1.WebRTCErrorCode.AudioTrackFailed);
                (0, chai_setup_1.expect)(error.recoverable).to.be.true;
            });
        }
        finally {
            navigator.mediaDevices.getUserMedia = original;
            manager.dispose();
            logger.dispose();
        }
    });
    (0, mocha_globals_1.test)("adds processed tracks to the WebRTC transport with metadata", async () => {
        const logger = new logger_1.Logger("AudioTrackManagerTransportAdd");
        logger.setLevel("error");
        const provider = new audio_context_provider_1.AudioContextProvider();
        const manager = new audio_track_manager_1.AudioTrackManager(logger, provider);
        const transport = new MockTransport();
        try {
            await manager.initialize();
            manager.setAudioConfiguration(audioConfig);
            const track = await manager.captureMicrophone();
            await manager.addTrackToTransport(transport, track);
            (0, chai_setup_1.expect)(transport.addCalls.length).to.equal(1);
            const call = transport.addCalls[0];
            (0, chai_setup_1.expect)(call.track).to.equal(track);
            (0, chai_setup_1.expect)(call.options?.processedStream, "Processed stream should be included").to.exist;
            (0, chai_setup_1.expect)(call.options?.sourceStream, "Source stream should be retained").to.exist;
            (0, chai_setup_1.expect)(call.options?.metadata?.graphNodes).to.equal("active");
        }
        finally {
            manager.dispose();
            logger.dispose();
        }
    });
    (0, mocha_globals_1.test)("removes transport tracks and emits terminal state", async () => {
        const logger = new logger_1.Logger("AudioTrackManagerTransportRemove");
        logger.setLevel("error");
        const provider = new audio_context_provider_1.AudioContextProvider();
        const manager = new audio_track_manager_1.AudioTrackManager(logger, provider);
        const transport = new MockTransport();
        const states = [];
        manager.onTrackStateChanged((trackId, state) => {
            states.push({ trackId, ended: state.ended });
        });
        try {
            await manager.initialize();
            manager.setAudioConfiguration(audioConfig);
            const track = await manager.captureMicrophone();
            await manager.addTrackToTransport(transport, track);
            await manager.removeTrackFromTransport(transport, track);
            (0, chai_setup_1.expect)(transport.removeCalls.length).to.equal(1);
            (0, chai_setup_1.expect)(transport.removeCalls[0]).to.equal(track);
            (0, chai_setup_1.expect)(states.some((entry) => entry.trackId === track.id && entry.ended)).to.be.true;
        }
        finally {
            manager.dispose();
            logger.dispose();
        }
    });
    (0, mocha_globals_1.test)("switches audio devices using transport replace logic when available", async () => {
        const logger = new logger_1.Logger("AudioTrackManagerSwitchDevice");
        logger.setLevel("error");
        const provider = new audio_context_provider_1.AudioContextProvider();
        const manager = new audio_track_manager_1.AudioTrackManager(logger, provider);
        const transport = new MockTransport();
        try {
            await manager.initialize();
            manager.setAudioConfiguration(audioConfig);
            await manager.captureMicrophone();
            const newTrack = await manager.switchAudioDevice("mock-device", transport);
            (0, chai_setup_1.expect)(newTrack, "Switching devices should return the new track").to.exist;
            (0, chai_setup_1.expect)(transport.replaceCalls.length).to.equal(1);
            const replaceCall = transport.replaceCalls[0];
            (0, chai_setup_1.expect)(replaceCall.newTrack).to.equal(newTrack);
            (0, chai_setup_1.expect)(replaceCall.options?.processedStream, "Replacement should include processed stream metadata").to.exist;
        }
        finally {
            manager.dispose();
            logger.dispose();
        }
    });
    (0, mocha_globals_1.test)("monitors connection quality and clears interval on stop", async () => {
        const logger = new logger_1.Logger("AudioTrackManagerQualityMonitor");
        logger.setLevel("error");
        const provider = new audio_context_provider_1.AudioContextProvider();
        const manager = new audio_track_manager_1.AudioTrackManager(logger, provider);
        const transport = new MockTransport();
        transport.stats = {
            connectionId: "abc",
            connectionDurationMs: 2000,
            audioPacketsSent: 2,
            audioPacketsReceived: 2,
            audioBytesSent: 32000,
            audioBytesReceived: 16000,
            currentRoundTripTime: 10,
            packetsLost: 0,
            jitter: 2,
            dataChannelState: "open",
            iceConnectionState: "connected",
            connectionQuality: webrtc_1.ConnectionQuality.Good,
        };
        const qualityEvents = [];
        manager.onTrackQualityChanged((quality) => qualityEvents.push(quality));
        const originalSetInterval = global.setInterval;
        const originalClearInterval = global.clearInterval;
        let clearedHandle;
        let handleCounter = 0;
        global.setInterval = (fn) => {
            handleCounter += 1;
            fn();
            return handleCounter;
        };
        global.clearInterval = (handle) => {
            clearedHandle = handle;
        };
        try {
            await manager.initialize();
            manager.startQualityMonitor(transport, 5);
            (0, chai_setup_1.expect)(qualityEvents).to.deep.equal([webrtc_1.ConnectionQuality.Good]);
            manager.stopQualityMonitor();
            (0, chai_setup_1.expect)(clearedHandle).to.equal(1);
        }
        finally {
            global.setInterval = originalSetInterval;
            global.clearInterval = originalClearInterval;
            manager.dispose();
            logger.dispose();
        }
    });
    (0, mocha_globals_1.test)("builds track statistics with derived bitrate and audio level", async () => {
        const logger = new logger_1.Logger("AudioTrackManagerStats");
        logger.setLevel("error");
        const provider = new audio_context_provider_1.AudioContextProvider();
        const manager = new audio_track_manager_1.AudioTrackManager(logger, provider);
        try {
            await manager.initialize();
            manager.setAudioConfiguration(audioConfig);
            const track = await manager.captureMicrophone();
            const stats = {
                connectionId: "stat",
                connectionDurationMs: 4000,
                audioPacketsSent: 100,
                audioPacketsReceived: 120,
                audioBytesSent: 64000,
                audioBytesReceived: 128000,
                currentRoundTripTime: 12,
                packetsLost: 1,
                jitter: 3,
                dataChannelState: "open",
                iceConnectionState: "connected",
                connectionQuality: webrtc_1.ConnectionQuality.Excellent,
            };
            const snapshot = manager.getTrackStatistics(track, stats);
            (0, chai_setup_1.expect)(snapshot.trackId).to.equal(track.id);
            (0, chai_setup_1.expect)(snapshot.bitrate, "Bitrate should be calculated").to.be.a("number");
            (0, chai_setup_1.expect)(snapshot.bitrate, "Bitrate should be positive").to.be.greaterThan(0);
            (0, chai_setup_1.expect)(snapshot.jitter).to.equal(stats.jitter);
            (0, chai_setup_1.expect)(snapshot.audioLevel).to.equal(0.9);
        }
        finally {
            manager.dispose();
            logger.dispose();
        }
    });
});
//# sourceMappingURL=audio-track-manager.unit.test.js.map