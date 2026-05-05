#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, "..");

const version = process.argv[2];
const previousVersion = process.argv[3] || "";
const repository = process.env.GITHUB_REPOSITORY || "mostafa-wahied/portracker";

if (!version) {
  console.error("usage: generate-release-notes.mjs <version> [previous-version]");
  process.exit(1);
}

const configUrl = pathToFileURL(
  resolve(repoRoot, "frontend/src/lib/whats-new-config.js")
).href;
const { default: whatsNewConfig } = await import(configUrl);

const hiddenTitles = new Set(
  (whatsNewConfig.hiddenTitles || []).map((title) => title.toLowerCase())
);
const featureOverrides = whatsNewConfig.featureOverrides || {};

const changelog = readFileSync(resolve(repoRoot, "CHANGELOG.md"), "utf8");
const lines = changelog.split("\n");

const versionHeader = new RegExp(
  `^##\\s*\\[${version.replace(/\./g, "\\.")}\\]`
);
const anyVersionHeader = /^##\s*\[/;

let inSection = false;
let captured = [];
for (const line of lines) {
  if (versionHeader.test(line)) {
    inSection = true;
    continue;
  }
  if (inSection && anyVersionHeader.test(line)) break;
  if (inSection) captured.push(line);
}

if (captured.length === 0) {
  console.error(`No CHANGELOG section found for version ${version}`);
  process.exit(1);
}

function normalizeDescription(text) {
  return text
    .replace(/\s*\((?:resolves|addresses)?\s*#\d+\)/gi, "")
    .replace(/\s*\(#\d+(?:\s*,\s*PR\s*#\d+)?(?:\s+by\s+@[^)]+)?\)/gi, "")
    .replace(/`([^`]+)`/g, "$1")
    .trim();
}

const highlights = [];
let inHighlights = false;
for (const raw of captured) {
  const line = raw.trim();
  if (line === "**Highlights**") {
    inHighlights = true;
    continue;
  }
  if (inHighlights && (line === "---" || line.startsWith("###"))) {
    inHighlights = false;
    continue;
  }
  if (inHighlights && line.startsWith("- ")) {
    const text = line.replace(/^-\s*/, "");
    const parts = text.split(/\s+[\-\u2013\u2014]\s+/);
    const title = (parts[0] || text).trim();
    const description = (parts.slice(1).join(" \u2014 ") || "").trim();
    highlights.push({ title, description });
  }
}

const bulletPattern = /^\s*-\s*\*\*\[?([^*\]]+?)\]?\*\*:\s*(.+)$/;
const subBulletPattern = /^\s*-\s*\*\*\[sub\]\*\*\s+(.+)$/i;

const out = [];
let lastVisible = true;
let currentSection = null;
let sectionHasContent = false;

for (const raw of captured) {
  const line = raw.trimEnd();

  const sectionMatch = line.match(/^###\s+(.+)$/);
  if (sectionMatch) {
    if (currentSection && sectionHasContent) {
      out.push("");
    }
    currentSection = sectionMatch[1].trim();
    sectionHasContent = false;
    out.push(`### ${currentSection}`);
    out.push("");
    continue;
  }

  const subMatch = line.match(subBulletPattern);
  if (subMatch && lastVisible) {
    out.push(`  - ${normalizeDescription(subMatch[1])}`);
    sectionHasContent = true;
    continue;
  }

  const match = line.match(bulletPattern);
  if (match) {
    const title = match[1].trim();
    const description = match[2].trim();
    if (hiddenTitles.has(title.toLowerCase())) {
      lastVisible = false;
      continue;
    }
    const override = featureOverrides[title];
    if (override?.hidden) {
      lastVisible = false;
      continue;
    }
    const finalTitle = override?.title || title;
    const finalDescription = override?.description || normalizeDescription(description);
    out.push(`- **${finalTitle}**: ${finalDescription}`);
    sectionHasContent = true;
    lastVisible = true;
    continue;
  }

  if (line.trim() === "") {
    lastVisible = true;
  }
}

while (out.length && out[out.length - 1].trim() === "") out.pop();

const filtered = [];
for (let i = 0; i < out.length; i++) {
  const line = out[i];
  if (/^###\s+/.test(line)) {
    let hasContent = false;
    for (let j = i + 1; j < out.length; j++) {
      if (/^###\s+/.test(out[j])) break;
      if (/^\s*-\s/.test(out[j])) {
        hasContent = true;
        break;
      }
    }
    if (!hasContent) {
      if (i + 1 < out.length && out[i + 1].trim() === "") i++;
      continue;
    }
  }
  filtered.push(line);
}
while (filtered.length && filtered[filtered.length - 1].trim() === "") filtered.pop();

const compareUrl = previousVersion
  ? `https://github.com/${repository}/compare/v${previousVersion}...v${version}`
  : `https://github.com/${repository}/releases`;

const bodyLines = [`## What's New in ${version}`, ""];

if (highlights.length > 0) {
  for (const h of highlights) {
    if (h.description) {
      bodyLines.push(`- **${h.title}** \u2014 ${h.description}`);
    } else {
      bodyLines.push(`- **${h.title}**`);
    }
  }
} else {
  bodyLines.push(...filtered);
}

bodyLines.push("", `**Full Changelog**: ${compareUrl}`, "");

const body = bodyLines.join("\n");

process.stdout.write(body);
