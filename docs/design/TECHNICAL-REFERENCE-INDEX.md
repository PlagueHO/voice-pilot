# Technical Reference Index

Centralized catalog of authoritative external documentation for Agent Voice design and implementation. Reference this table from other project guides (for example, `AGENTS.md`).

| Title | URL | Description |
| --- | --- | --- |
| Azure OpenAI GPT Realtime API for speech and audio (Typescript) | [learn.microsoft.com](https://learn.microsoft.com/en-us/azure/ai-foundry/openai/realtime-audio-quickstart?tabs=keyless%2Cwindows&pivots=programming-language-typescript) | Official tutorial for deploying `gpt-realtime`, aligning on API version `2025-08-28`, voice selection, and WebRTC session setup for low-latency streaming. |
| Azure OpenAI Realtime API Reference | [learn.microsoft.com](https://learn.microsoft.com/en-us/azure/ai-foundry/openai/realtime-audio-reference) | Complete event schema and component definitions for realtime audio sessions. |
| Azure OpenAI Realtime turn detection reference | [learn.microsoft.com](https://learn.microsoft.com/en-us/azure/ai-foundry/openai/realtime-audio-reference#turn-detection) | Field-level guidance for `turn_detection` payloads (threshold, prefix padding, silence windows, and `semantic_vad` eagerness) mirrored by our normalization helper. |
| Azure OpenAI Realtime API How-To using WebRTC & sessions | [learn.microsoft.com](https://learn.microsoft.com/en-us/azure/ai-foundry/openai/how-to/realtime-audio-webrtc) | Deep guidance on session configuration, VAD, interruption, and conversation management using GPT Realtime API via WebRTC. |
| Azure Identity for JavaScript | [learn.microsoft.com](https://learn.microsoft.com/en-us/javascript/api/overview/azure/identity-readme) | Overview of `DefaultAzureCredential` and token acquisition flows used for keyless auth. |
| VS Code Extension API | [code.visualstudio.com](https://code.visualstudio.com/api) | Authoritative documentation for building VS Code extensions, including activation, commands, and webviews. |
| Testing VS Code Extensions | [code.visualstudio.com](https://code.visualstudio.com/api/working-with-extensions/testing-extension) | Guidance for running integration tests with `@vscode/test-electron` and structuring extension test suites. |
| Web Audio API (MDN) | [developer.mozilla.org](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API) | Reference for working with PCM audio in the browser, used by the Agent Voice webview playback pipeline. |
| Web Audio API – AudioWorklet | [webaudio.github.io](https://webaudio.github.io/web-audio-api/#AudioWorklet) | Normative description of the AudioWorklet interface, module loading, and processor registration lifecycle. |
| Web Audio API – AudioWorkletNode | [webaudio.github.io](https://webaudio.github.io/web-audio-api/#AudioWorkletNode) | Details node construction, channel configuration, and messaging surfaces for custom audio processors. |
| Web Audio API – AudioWorkletProcessor | [webaudio.github.io](https://webaudio.github.io/web-audio-api/#AudioWorkletProcessor) | Specifies processor execution semantics, process() contract, and parameter descriptor behavior. |
| Web Audio API – Rendering an Audio Graph | [webaudio.github.io](https://webaudio.github.io/web-audio-api/#rendering-loop) | Explains render-quantum scheduling and control/render thread coordination critical for low-latency pipelines. |
| Mocha Testing Framework Docs | [mochajs.org](https://mochajs.org/) | Official documentation for the Mocha test runner used in unit and integration testing. |
| Azure Bicep Documentation | [learn.microsoft.com](https://learn.microsoft.com/en-us/azure/azure-resource-manager/bicep/overview) | Core reference for authoring and deploying infrastructure as code with Bicep. |
| Visual Studio Code Common Capabilities | [code.visualstudio.com](https://code.visualstudio.com/api/extension-capabilities/common-capabilities) | Reference for common extension capabilities such as commands, configuration, keybindings, context menu, data storage, display notifications, quick pick, file picker, output channel and progress API. |
