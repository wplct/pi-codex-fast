import {
  getAgentDir,
  type ExtensionAPI,
  type ExtensionCommandContext,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { type Api, type Model } from "@earendil-works/pi-ai";
import {
  describeFastMode,
  getFastCommandArgumentCompletions,
  getFastStatusFrame,
  getNextFastModeStyle,
  loadPiFastModeConfig,
  parseFastCommand,
  patchFastModePayload,
  resolveFastServiceTier,
  savePiFastModeConfig,
  shouldApplyFastMode,
  STATUS_KEY,
  type PiFastModeConfig,
  type SchedulerLike,
} from "./utils";

export * from "./utils";

export interface PiFastModeDeps {
  agentDir?: string;
  scheduler?: SchedulerLike;
}

type SupportedModel = Pick<
  Model<Api>,
  "provider" | "id" | "api" | "maxTokens" | "reasoning" | "thinkingLevelMap"
>;
type StatusContext = Pick<ExtensionContext, "cwd" | "hasUI" | "model" | "ui">;

export function createPiFastModeExtension(pi: ExtensionAPI, deps: PiFastModeDeps = {}) {
  const agentDir = deps.agentDir ?? getAgentDir();
  const scheduler = deps.scheduler ?? {
    setInterval: (handler: () => void, timeout?: number) =>
      globalThis.setInterval(handler, timeout),
    clearInterval: (handle: unknown) =>
      globalThis.clearInterval(handle as ReturnType<typeof setInterval>),
  };

  let config: PiFastModeConfig = loadPiFastModeConfig(agentDir);
  let currentModel: SupportedModel | undefined;
  let statusCtx: StatusContext | undefined;
  let animationHandle: unknown;
  let frameIndex = 0;

  const stopAnimation = () => {
    if (animationHandle !== undefined) {
      scheduler.clearInterval(animationHandle);
      animationHandle = undefined;
    }
  };

  const renderStatus = () => {
    if (!statusCtx?.hasUI) return;
    statusCtx.ui.setStatus(STATUS_KEY, getFastStatusFrame(frameIndex, config.style));
    frameIndex += 1;
  };

  const refreshConfig = () => {
    config = loadPiFastModeConfig(agentDir);
    return config;
  };

  const syncStatus = (ctx?: StatusContext) => {
    if (ctx) {
      statusCtx = ctx;
      currentModel = (ctx.model as SupportedModel | undefined) ?? currentModel;
      refreshConfig();
    }
    if (!statusCtx?.hasUI || !shouldApplyFastMode(config, currentModel)) {
      stopAnimation();
      frameIndex = 0;
      statusCtx?.ui.setStatus(STATUS_KEY, undefined);
      return;
    }
    if (config.style === "glow" || config.style === "rainbow") {
      renderStatus();
      if (animationHandle === undefined) {
        animationHandle = scheduler.setInterval(renderStatus, 140);
      }
      return;
    }
    stopAnimation();
    frameIndex = 0;
    statusCtx.ui.setStatus(STATUS_KEY, getFastStatusFrame(0, config.style));
  };

  const notify = (
    ctx: Pick<ExtensionCommandContext, "hasUI" | "ui">,
    message: string,
    kind: "info" | "warning" | "error",
  ) => {
    if (ctx.hasUI) ctx.ui.notify(message, kind);
  };

  pi.on("session_start", async (_event, ctx) => {
    currentModel = ctx.model as SupportedModel | undefined;
    syncStatus(ctx);
  });

  pi.on("model_select", async (event, ctx) => {
    currentModel = event.model as SupportedModel;
    syncStatus(ctx);
  });

  pi.on("before_provider_request", (event, ctx) => {
    currentModel = (ctx.model as SupportedModel | undefined) ?? currentModel;
    refreshConfig();
    syncStatus(ctx);

    const serviceTier = resolveFastServiceTier(config, currentModel);
    if (!serviceTier) return;

    // 以配置文件为准：命中 models 的请求在发出前直接补上 service_tier。
    return patchFastModePayload(event.payload, serviceTier);
  });

  pi.on("session_shutdown", async () => {
    stopAnimation();
    statusCtx?.ui.setStatus(STATUS_KEY, undefined);
    statusCtx = undefined;
  });

  pi.registerCommand("fast", {
    description: "Toggle Fast Mode and style.",
    getArgumentCompletions: getFastCommandArgumentCompletions,
    handler: async (args, ctx) => {
      currentModel = ctx.model as SupportedModel | undefined;
      refreshConfig();
      const action = parseFastCommand(args, config.enabled);

      if (action.type === "status") {
        notify(ctx, describeFastMode(config, currentModel), "info");
        syncStatus(ctx);
        return;
      }

      if (action.type === "cycle_style") {
        savePiFastModeConfig({ style: getNextFastModeStyle(config.style) }, agentDir);
        config = loadPiFastModeConfig(agentDir);
        frameIndex = 0;
        syncStatus(ctx);
        notify(ctx, `Fast Mode style: ${config.style}`, "info");
        return;
      }

      savePiFastModeConfig({ enabled: action.enabled }, agentDir);
      config = loadPiFastModeConfig(agentDir);
      frameIndex = 0;
      syncStatus(ctx);
      notify(ctx, describeFastMode(config, currentModel), config.enabled ? "warning" : "info");
    },
  });
}

export default function piFastModeExtension(pi: ExtensionAPI) {
  createPiFastModeExtension(pi);
}
