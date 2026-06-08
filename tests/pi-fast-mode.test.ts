import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import type { Model } from "@earendil-works/pi-ai";
import piFastModeExtension, { createPiFastModeExtension } from "../index";
import {
  DEFAULT_CONFIG,
  describeFastMode,
  getFastCommandArgumentCompletions,
  getFastStatusFrame,
  getNextFastModeStyle,
  isConfiguredFastModel,
  loadPiFastModeConfig,
  mergeConfig,
  normalizeFastModels,
  parseFastCommand,
  patchFastModePayload,
  resolveFastServiceTier,
  savePiFastModeConfig,
  shouldApplyFastMode,
  type PiFastModeConfig,
} from "../utils";

test("extension entry exports default and factory", () => {
  expect(typeof piFastModeExtension).toBe("function");
  expect(typeof createPiFastModeExtension).toBe("function");
});

function model(partial: Partial<Model<any>>): Model<any> {
  return {
    id: "gpt-5.5",
    name: "GPT-5.5",
    api: "openai-codex-responses",
    provider: "openai-codex",
    baseUrl: "https://example.invalid",
    reasoning: true,
    input: ["text"],
    cost: { input: 1, output: 1, cacheRead: 1, cacheWrite: 1 },
    contextWindow: 128000,
    maxTokens: 128000,
    ...partial,
  } as Model<any>;
}

test("normalizes fast model refs", () => {
  expect(normalizeFastModels([" GPT-5.5 ", "gpt-5.5", "OPENAI/GPT-5.4", "", 123])).toEqual([
    "gpt-5.5",
    "openai/gpt-5.4",
  ]);
});

test("merges config with validation and fallbacks", () => {
  const merged = mergeConfig(DEFAULT_CONFIG, {
    enabled: true,
    models: ["gpt-5.5"],
    style: "rainbow",
  });
  expect(merged.enabled).toBe(true);
  expect(merged.models).toEqual(["gpt-5.5"]);
  expect(merged.style).toBe("rainbow");

  const fallback = mergeConfig(merged, { enabled: "yes", style: "nope" });
  expect(fallback.enabled).toBe(true);
  expect(fallback.style).toBe("rainbow");
});

test("creates, saves, and loads config under the pi agent extensions directory", () => {
  const agentDir = mkdtempSync(join(tmpdir(), "pi-fast-mode-"));
  try {
    const configPath = join(agentDir, "extensions", "pi-codex-fast.json");
    expect(existsSync(configPath)).toBe(false);

    const loaded = loadPiFastModeConfig(agentDir);
    expect(loaded.enabled).toBe(false);
    expect(loaded.models).toEqual(["openai/gpt-5.4", "openai/gpt-5.5"]);
    expect(loaded.style).toBe("static");

    const defaultRaw = JSON.parse(readFileSync(configPath, "utf8"));
    expect(Object.keys(defaultRaw)).toEqual(["enabled", "models"]);
    expect(defaultRaw.enabled).toBe(false);

    savePiFastModeConfig({ enabled: true }, agentDir);
    const enabledRaw = JSON.parse(readFileSync(configPath, "utf8"));
    expect(Object.keys(enabledRaw)).toEqual(["enabled", "models"]);
    expect(enabledRaw.enabled).toBe(true);

    const saved = savePiFastModeConfig(
      { enabled: true, models: ["cc-switch/gpt-5.5"], style: "glow" },
      agentDir,
    );
    expect(saved.enabled).toBe(true);
    expect(saved.models).toEqual(["cc-switch/gpt-5.5"]);
    expect(loadPiFastModeConfig(agentDir).style).toBe("glow");
    const raw = JSON.parse(readFileSync(configPath, "utf8"));
    expect(raw.style).toBe("glow");
  } finally {
    rmSync(agentDir, { recursive: true, force: true });
  }
});

test("matches bare and provider-qualified configured models using config only", () => {
  const config: PiFastModeConfig = {
    ...DEFAULT_CONFIG,
    enabled: true,
    models: ["gpt-5.5", "cc-switch/gpt-5.4"],
  };
  expect(isConfiguredFastModel(config, model({ provider: "openai-codex", id: "gpt-5.5" }))).toBe(
    true,
  );
  expect(isConfiguredFastModel(config, model({ provider: "cc-switch", id: "gpt-5.4" }))).toBe(
    true,
  );
  expect(isConfiguredFastModel(config, model({ provider: "openai", id: "gpt-5.4" }))).toBe(
    false,
  );
  expect(
    shouldApplyFastMode({ ...config, enabled: false }, model({ provider: "cc-switch", id: "gpt-5.5" })),
  ).toBe(false);
});

test("resolves service tier from config and patches provider payload", () => {
  const config: PiFastModeConfig = {
    ...DEFAULT_CONFIG,
    enabled: true,
    models: ["cc-switch/gpt-5.4"],
  };
  const currentModel = model({ provider: "cc-switch", id: "gpt-5.4", api: "openai-responses" });
  expect(resolveFastServiceTier(config, currentModel)).toBe("priority");

  const originalPayload = { model: "gpt-5.4", input: "hi" };
  expect(patchFastModePayload(originalPayload, "priority")).toEqual({
    model: "gpt-5.4",
    input: "hi",
    service_tier: "priority",
  });
  expect(patchFastModePayload("raw-payload", "priority")).toBe("raw-payload");
  expect(patchFastModePayload(originalPayload, undefined)).toEqual(originalPayload);
});

test("describeFastMode reflects configured scope", () => {
  const config: PiFastModeConfig = {
    ...DEFAULT_CONFIG,
    enabled: true,
    models: ["cc-switch/gpt-5.4"],
  };
  expect(describeFastMode(config, model({ provider: "cc-switch", id: "gpt-5.4" }))).toContain(
    "cc-switch/gpt-5.4",
  );
  expect(describeFastMode(config, model({ provider: "other", id: "other" }))).toContain("1 model");
});

test("commands, completions, styles, and status frames", () => {
  expect(parseFastCommand("", false)).toEqual({ type: "toggle_enabled", enabled: true });
  expect(parseFastCommand("off", true)).toEqual({ type: "toggle_enabled", enabled: false });
  expect(parseFastCommand("style", true)).toEqual({ type: "cycle_style" });
  expect(() => parseFastCommand("wat", true)).toThrow(/Usage/);

  expect(getNextFastModeStyle("static")).toBe("rainbow");
  expect(getNextFastModeStyle("rainbow")).toBe("glow");
  expect(getNextFastModeStyle("glow")).toBe("static");
  expect(getFastStatusFrame(0, "static")).toMatch(/Fast/);
  expect(getFastCommandArgumentCompletions("st")?.some((item) => item.value === "status")).toBe(
    true,
  );
  expect(getFastCommandArgumentCompletions("status now")).toBe(null);
});
