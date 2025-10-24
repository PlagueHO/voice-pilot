"use strict";
// Unit test setup - provide VS Code mock via module cache manipulation
// This runs before any tests and ensures 'vscode' module resolves to our mock
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
// Direct CommonJS require for Module access
const Module = require("module");
// Import our VS Code mock
const vscode = __importStar(require("./vscode-mock"));
// Store original _resolveFilename
const originalResolveFilename = Module._resolveFilename;
// Override module resolution for 'vscode' requests
Module._resolveFilename = function (request, parent, isMain, options) {
    if (request === "vscode") {
        return "vscode-mock";
    }
    return originalResolveFilename.call(this, request, parent, isMain, options);
};
// Register mock in cache with complete Module interface
require.cache["vscode-mock"] = {
    id: "vscode-mock",
    filename: "vscode-mock",
    loaded: true,
    children: [],
    parent: null,
    paths: [],
    isPreloading: false,
    path: "vscode-mock",
    require: require,
    exports: vscode,
};
console.log("✓ VS Code mock registered for unit tests");
//# sourceMappingURL=unit-test-setup.js.map