#!/usr/bin/env node
import addFormats from "ajv-formats";
import Ajv from "ajv/dist/2020.js";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(__filename), "..");
const schemaPath = path.join(repoRoot, "spec", "threat-register.schema.json");
const registerPath = path.join(repoRoot, "spec", "threat-register.json");
const reportPath = path.join(repoRoot, "spec", "threat-register-report.json");

const allowedMitigationSpecs = new Set([
  "SP-003",
  "SP-004",
  "SP-005",
  "SP-006",
  "SP-027",
  "SP-050",
]);

function formatErrors(errors = []) {
  return errors
    .map((err) => {
      const instancePath = err.instancePath || "<root>";
      return `${instancePath} ${err.message ?? "validation error"}`;
    })
    .join("\n");
}

async function loadJson(filePath) {
  const raw = await readFile(filePath, "utf8");
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`Failed to parse ${path.relative(repoRoot, filePath)}: ${error.message}`);
  }
}

function enforceDomainRules(threatRegister) {
  const errors = [];
  const highRiskThreats = [];
  const highRiskIds = new Set();

  const registerHighRisk = (threat) => {
    if (!highRiskIds.has(threat.threatId)) {
      highRiskIds.add(threat.threatId);
      highRiskThreats.push(threat);
    }
  };

  for (const threat of threatRegister.threats) {
    const threatLabel = `${threat.threatId} (${threat.title})`;

    for (const mitigation of threat.mitigations) {
      if (!allowedMitigationSpecs.has(mitigation.spec)) {
        errors.push(
          `${threat.threatId}: mitigation spec ${mitigation.spec} is not in allowed set ${Array.from(allowedMitigationSpecs).join(",")}`,
        );
      }
      if (!/^(test|audit):/.test(mitigation.verification)) {
        errors.push(`${threat.threatId}: mitigation verification must begin with test: or audit:`);
      }
    }

    if (threat.residualRisk === "High") {
      registerHighRisk(threat);
      errors.push(`${threat.threatId}: residual risk High exceeds release acceptance threshold`);
    }

    if (threat.dreadScore >= 60) {
      if (threat.status === "Open") {
        errors.push(`${threat.threatId}: high DREAD score cannot remain Open`);
      }
      if (!threat.mitigations || threat.mitigations.length === 0) {
        errors.push(`${threat.threatId}: high DREAD score requires mitigations`);
      }
      if (threat.residualRisk !== "Low" && threat.residualRisk !== "Medium") {
        errors.push(`${threat.threatId}: high DREAD score must reduce residual risk to Low or Medium`);
      }
      registerHighRisk(threat);
    }
  }

  return { errors, highRiskThreats };
}

function buildReport(threatRegister, highRiskThreats) {
  const mitigationCoverage = {};
  for (const spec of allowedMitigationSpecs) {
    mitigationCoverage[spec] = threatRegister.threats.filter((threat) =>
      threat.mitigations.some((mitigation) => mitigation.spec === spec),
    ).length;
  }

  const openHighRisk = highRiskThreats
    .filter((threat) => threat.status !== "Mitigated")
    .map((threat) => ({
      threatId: threat.threatId,
      title: threat.title,
      status: threat.status,
      residualRisk: threat.residualRisk,
      dreadScore: threat.dreadScore,
    }));

  return {
    version: threatRegister.version,
    generatedAt: new Date().toISOString(),
    threatCount: threatRegister.threats.length,
    highRiskCount: highRiskThreats.length,
    openHighRisk,
    mitigationCoverage,
  };
}

async function main() {
  const ajv = new Ajv({ allErrors: true, strict: false, allowUnionTypes: true });
  addFormats(ajv);

  const schema = await loadJson(schemaPath);
  const validate = ajv.compile(schema);
  const threatRegister = await loadJson(registerPath);

  const valid = validate(threatRegister);
  if (!valid) {
    const details = formatErrors(validate.errors);
    console.error("❌ Threat register schema validation failed:\n" + details);
    process.exit(1);
  }

  const { errors, highRiskThreats } = enforceDomainRules(threatRegister);
  if (errors.length > 0) {
    console.error("❌ Threat register domain validation failed:");
    for (const message of errors) {
      console.error(`   • ${message}`);
    }
    process.exit(1);
  }

  const report = buildReport(threatRegister, highRiskThreats);
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  if (report.openHighRisk.length > 0) {
    console.warn(
      `⚠️  ${report.openHighRisk.length} high-risk threat(s) remain open: ${report.openHighRisk
        .map((threat) => threat.threatId)
        .join(", ")}`,
    );
  } else {
    console.log("✅ Threat register validation passed with no open high-risk items.");
  }
}

main().catch((error) => {
  console.error("❌ Threat register validation encountered an unexpected error", error);
  process.exit(1);
});
