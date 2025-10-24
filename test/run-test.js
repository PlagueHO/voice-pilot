"use strict";
// Legacy test runner - @vscode/test-cli is now the recommended approach
// This file is kept for backward compatibility
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
const test_electron_1 = require("@vscode/test-electron");
const path = __importStar(require("path"));
async function main() {
    try {
        // The folder containing the Extension Manifest package.json
        // Passed to `--extensionDevelopmentPath`
        const extensionDevelopmentPath = path.resolve(__dirname, "../");
        // The path to test runner
        // Passed to --extensionTestsPath
        const extensionTestsPath = path.resolve(__dirname, "./index");
        // Download VS Code, unzip it and run the integration test
        // Ensure Mocha uses the TDD UI so `suite`/`setup` globals are defined in tests
        process.env.MOCHA_UI = process.env.MOCHA_UI || "tdd";
        // Preload the TDD shim inside the extension host process so globals exist
        // before Mocha loads test files. Use Node/Electron --require option.
        const tddShimPath = path.resolve(extensionDevelopmentPath, "test", "setup-mocha-tdd-shim.js");
        await (0, test_electron_1.runTests)({
            extensionDevelopmentPath,
            extensionTestsPath,
            launchArgs: ["--disable-extensions", "--require", tddShimPath], // Preload shim
            extensionTestsEnv: {
                MOCHA_UI: process.env.MOCHA_UI || "tdd",
            },
        });
    }
    catch (err) {
        console.error("Failed to run tests:", err);
        process.exit(1);
    }
}
if (require.main === module) {
    main();
}
//# sourceMappingURL=run-test.js.map