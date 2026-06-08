import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { type Api, type Model } from "@earendil-works/pi-ai";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { AutocompleteItem } from "@earendil-works/pi-tui";

export type FastModeStyle = "static" | "rainbow" | "glow";
export type FastServiceTier = "priority" | undefined;
export type JsonObject = Record<string, unknown>;

export interface PiFastModeConfig {
  enabled: boolean;
  models: string[];
  style: FastModeStyle;
}

export interface SchedulerLike {
  setInterval(handler: () => void, timeout?: number): unknown;
  clearInterval(handle: unknown): void;
}

export interface FastModeStreamDecision {
  provider: string;
  model: string;
  api: string;
  serviceTier: FastServiceTier;
  applied: boolean;
  native: boolean;
}

export const PACKAGE_NAME = "pi-codex-fast";
export const STATUS_KEY = "pi-fast-mode";
export const DEFAULT_FAST_MODELS = ["openai/gpt-5.4", "openai/gpt-5.5"] as const;
export const DEFAULT_CONFIG: PiFastModeConfig = {
  enabled: false,
  models: [...DEFAULT_FAST_MODELS],
  style: "static",
};
export const DEFAULT_CONFIG_FILE = {
  enabled: DEFAULT_CONFIG.enabled,
  models: [...DEFAULT_FAST_MODELS],
};
export const FAST_MODE_STYLES: readonly FastModeStyle[] = ["static", "rainbow", "glow"] as const;

const FAST_COMMAND_COMPLETIONS: readonly AutocompleteItem[] = [
  { value: "on", label: "on", description: "Enable Fast Mode" },
  { value: "off", label: "off", description: "Disable Fast Mode" },
  { value: "toggle", label: "toggle", description: "Toggle Fast Mode on/off" },
  { value: "status", label: "status", description: "Show Fast Mode status" },
  { value: "style", label: "style", description: "Cycle status style" },
] as const;

const ANSI_RESET = "\x1b[0m";
const RAINBOW_COLORS: ReadonlyArray<[number, number, number]> = [
  [255, 99, 132],
  [255, 159, 64],
  [255, 205, 86],
  [75, 192, 192],
  [54, 162, 235],
  [153, 102, 255],
] as const;

function colorize(text: string, rgb: [number, number, number], bold = false): string {
  const prefix = bold
    ? `\x1b[1;38;2;${rgb[0]};${rgb[1]};${rgb[2]}m`
    : `\x1b[38;2;${rgb[0]};${rgb[1]};${rgb[2]}m`;
  return `${prefix}${text}${ANSI_RESET}`;
}

function formatGlowFrame(
  icon: string,
  iconRgb: [number, number, number],
  textRgb: [number, number, number],
  bold = false,
): string {
  return `${colorize(icon, iconRgb, bold)} ${colorize("Fast", textRgb, bold)}`;
}

function formatRainbowFrame(offset = 0): string {
  const glyphs = ["●", "F", "a", "s", "t"];
  return glyphs
    .map((glyph, index) => {
      const color = RAINBOW_COLORS[(offset + index) % RAINBOW_COLORS.length]!;
      return index === 0 ? `${colorize(glyph, color, true)} ` : colorize(glyph, color, true);
    })
    .join("");
}

const GLOW_FRAMES = [
  formatGlowFrame("◌", [106, 126, 160], [126, 145, 174]),
  formatGlowFrame("◍", [110, 149, 210], [144, 179, 231]),
  formatGlowFrame("●", [122, 191, 255], [185, 224, 255], true),
  formatGlowFrame("◍", [110, 149, 210], [144, 179, 231]),
] as const;
const STATIC_FRAME = formatGlowFrame("●", [122, 191, 255], [185, 224, 255], true);
const RAINBOW_FRAMES = RAINBOW_COLORS.map((_, offset) => formatRainbowFrame(offset));

export type FastCommandAction =
  | { type: "toggle_enabled"; enabled: boolean }
  | { type: "status" }
  | { type: "cycle_style" };

export function isRecord(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function normalizeFastModels(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const normalized = entry.trim().toLowerCase();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

export function normalizeFastModeStyle(
  value: unknown,
  fallback: FastModeStyle = DEFAULT_CONFIG.style,
): FastModeStyle {
  if (value === "static" || value === "rainbow" || value === "glow") return value;
  return fallback;
}

export function mergeConfig(base: PiFastModeConfig, override: unknown): PiFastModeConfig {
  if (!isRecord(override)) return { ...base, models: [...base.models] };
  return {
    enabled: typeof override.enabled === "boolean" ? override.enabled : base.enabled,
    models: "models" in override ? normalizeFastModels(override.models) : [...base.models],
    style: normalizeFastModeStyle(override.style, base.style),
  };
}

export function readJsonObject(filePath: string): JsonObject {
  if (!existsSync(filePath)) return {};
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function getPiFastModeConfigPath(agentDir = getAgentDir()): string {
  return join(agentDir, "extensions", `${PACKAGE_NAME}.json`);
}

export function writeDefaultPiFastModeConfig(configPath: string): void {
  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, JSON.stringify(DEFAULT_CONFIG_FILE, null, 2) + "\n", "utf8");
}

export function ensurePiFastModeConfig(configPath: string): void {
  if (existsSync(configPath)) return;
  writeDefaultPiFastModeConfig(configPath);
}

export function loadPiFastModeConfig(agentDir = getAgentDir()): PiFastModeConfig {
  const configPath = getPiFastModeConfigPath(agentDir);
  ensurePiFastModeConfig(configPath);
  return mergeConfig(DEFAULT_CONFIG, readJsonObject(configPath));
}

export function savePiFastModeConfig(
  patch: Partial<PiFastModeConfig>,
  agentDir = getAgentDir(),
): PiFastModeConfig {
  const configPath = getPiFastModeConfigPath(agentDir);
  ensurePiFastModeConfig(configPath);
  const raw = readJsonObject(configPath);
  const current = mergeConfig(DEFAULT_CONFIG, raw);
  const updated: PiFastModeConfig = {
    enabled: typeof patch.enabled === "boolean" ? patch.enabled : current.enabled,
    models: patch.models ? normalizeFastModels(patch.models) : [...current.models],
    style: patch.style ? normalizeFastModeStyle(patch.style, current.style) : current.style,
  };
  const shouldWriteStyle = "style" in patch || "style" in raw;
  const fileConfig: JsonObject = {
    enabled: updated.enabled,
    models: updated.models,
  };
  if (shouldWriteStyle) fileConfig.style = updated.style;
  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, JSON.stringify(fileConfig, null, 2) + "\n", "utf8");
  return updated;
}

export function normalizeModelRef(ref: string): string {
  return ref.trim().toLowerCase();
}

export function isConfiguredFastModel(
  config: PiFastModeConfig,
  model: Pick<Model<Api>, "provider" | "id"> | undefined,
): boolean {
  if (!model) return false;
  const bare = normalizeModelRef(model.id);
  const full = normalizeModelRef(`${model.provider}/${model.id}`);
  return config.models.some((entry) => entry === bare || entry === full);
}

export function shouldApplyFastMode(
  config: PiFastModeConfig,
  model: Pick<Model<Api>, "provider" | "id"> | undefined,
): boolean {
  return config.enabled && isConfiguredFastModel(config, model);
}

export function resolveFastServiceTier(
  config: PiFastModeConfig,
  model: Pick<Model<Api>, "provider" | "id"> | undefined,
): FastServiceTier {
  return shouldApplyFastMode(config, model) ? "priority" : undefined;
}

export function patchFastModePayload(payload: unknown, serviceTier: FastServiceTier): unknown {
  if (!serviceTier || !isRecord(payload)) return payload;
  return {
    ...payload,
    service_tier: serviceTier,
  };
}

export function getFastStatusFrame(frameIndex: number, style: FastModeStyle = "glow"): string {
  switch (style) {
    case "static":
      return STATIC_FRAME;
    case "rainbow":
      return RAINBOW_FRAMES[
        ((frameIndex % RAINBOW_FRAMES.length) + RAINBOW_FRAMES.length) % RAINBOW_FRAMES.length
      ]!;
    case "glow":
    default:
      return GLOW_FRAMES[
        ((frameIndex % GLOW_FRAMES.length) + GLOW_FRAMES.length) % GLOW_FRAMES.length
      ]!;
  }
}

export function getNextFastModeStyle(style: FastModeStyle): FastModeStyle {
  const index = FAST_MODE_STYLES.indexOf(style);
  return FAST_MODE_STYLES[(index + 1) % FAST_MODE_STYLES.length]!;
}

export function getFastCommandArgumentCompletions(prefix: string): AutocompleteItem[] | null {
  const normalizedPrefix = prefix.trim().toLowerCase();
  if (normalizedPrefix.includes(" ")) return null;
  const filtered = FAST_COMMAND_COMPLETIONS.filter((item) =>
    item.value.startsWith(normalizedPrefix),
  );
  return filtered.length > 0 ? [...filtered] : null;
}

export function parseFastCommand(args: string, currentEnabled: boolean): FastCommandAction {
  const normalized = args.trim().toLowerCase();
  if (!normalized) return { type: "toggle_enabled", enabled: !currentEnabled };
  if (normalized === "status") return { type: "status" };
  if (normalized === "on") return { type: "toggle_enabled", enabled: true };
  if (normalized === "off") return { type: "toggle_enabled", enabled: false };
  if (normalized === "toggle") return { type: "toggle_enabled", enabled: !currentEnabled };
  if (normalized === "style") return { type: "cycle_style" };
  throw new Error("Usage: /fast [on|off|toggle|status|style]");
}

export function describeFastMode(
  config: PiFastModeConfig,
  model: Pick<Model<Api>, "provider" | "id"> | undefined,
): string {
  const scope = isConfiguredFastModel(config, model)
    ? `${model?.provider}/${model?.id}`
    : `${config.models.length} model${config.models.length === 1 ? "" : "s"}`;
  return `Fast Mode ${config.enabled ? "ON" : "OFF"} (${scope}, style=${config.style})`;
}
