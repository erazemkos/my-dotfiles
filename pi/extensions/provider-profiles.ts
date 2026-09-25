/**
 * OpenAI Codex model scope and cycling.
 *
 * /scope toggles the models Ctrl+P cycles. Only openai-codex is exposed by
 * /provider; the default scope is GPT-6 Sol and GPT-6 Luna.
 *
 * Scope is persisted to ~/.pi/agent/provider-profiles.json (per-machine
 * runtime state, not in the dotfiles repo).
 *
 * app.model.cycleForward is reserved and blocks the extension override.
 * pi/keybindings.json unbinds it so Ctrl+P is available; it also disables
 * built-in reverse cycling. Both files must ship together.
 *
 * Built-in /scoped-models is handled by pi before extension commands and
 * cannot be overridden. /scope is the provider-specific equivalent.
 */

import type { Api, Model } from "@earendil-works/pi-ai/compat";
import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
  getAgentDir,
  getSettingsListTheme,
} from "@earendil-works/pi-coding-agent";
import type { AutocompleteItem } from "@earendil-works/pi-tui";
import {
  Container,
  type SettingItem,
  SettingsList,
  Text,
} from "@earendil-works/pi-tui";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const ALLOWED_PROVIDERS = ["openai-codex"];

/** Default models enabled in /scope, in Ctrl+P cycle order. */
const DEFAULT_SCOPE: Record<string, string[]> = {
  "openai-codex": ["gpt-6-sol", "gpt-6-luna"],
};

/** Models shown first in /scope; any other available models follow by name. */
const DEFAULT_ORDER: Record<string, string[]> = {
  "openai-codex": ["gpt-6-sol", "gpt-6-luna"],
};

// ---------------------------------------------------------------------------
// State (persisted to provider-profiles.json)
// ---------------------------------------------------------------------------

const STATE_FILE = join(getAgentDir(), "provider-profiles.json");

/** group id → ordered list of enabled model ids. Missing entry = use DEFAULT_SCOPE. */
type Scopes = Record<string, string[]>;
let scopes: Scopes = {};

function loadScopes(): void {
  try {
    const parsed = JSON.parse(readFileSync(STATE_FILE, "utf8")) as {
      scopes?: unknown;
    };
    const raw = (parsed?.scopes ?? {}) as Record<string, unknown>;
    const next: Scopes = {};
    for (const [g, ids] of Object.entries(raw)) {
      if (Array.isArray(ids))
        next[g] = ids.filter((id): id is string => typeof id === "string");
    }
    scopes = next;
  } catch {
    scopes = {};
  }
}

function saveScopes(): void {
  try {
    mkdirSync(dirname(STATE_FILE), { recursive: true });
    writeFileSync(
      STATE_FILE,
      `${JSON.stringify({ scopes }, null, 2)}\n`,
      "utf8",
    );
  } catch {
    /* best-effort */
  }
}

loadScopes();

// ---------------------------------------------------------------------------
// Provider helpers
// ---------------------------------------------------------------------------

type Registry = ExtensionContext["modelRegistry"];

/** Provider id is also its profile id; only openai-codex is exposed. */
function resolveGroup(providerId: string): string {
  return providerId;
}

function groupMembers(groupId: string): string[] {
  return [groupId];
}

function groupDisplayName(registry: Registry, groupId: string): string {
  return registry.getProviderDisplayName(groupId);
}

/** Available Codex models, ordered by DEFAULT_ORDER + alphabetic remainder. */
function orderedModels(registry: Registry, groupId: string): Model<Api>[] {
  if (!ALLOWED_PROVIDERS.includes(groupId)) return [];
  const members = groupMembers(groupId);
  const byId = new Map<string, Model<Api>>();
  for (const provider of members) {
    for (const model of registry
      .getAvailable()
      .filter((m) => m.provider === provider)) {
      byId.set(model.id, model); // later member overrides earlier for same id
    }
  }

  const order: Model<Api>[] = [];
  for (const id of DEFAULT_ORDER[groupId] ?? []) {
    const model = byId.get(id);
    if (model) {
      order.push(model);
      byId.delete(id);
    }
  }
  const rest = [...byId.values()].sort((a, b) =>
    (a.name || a.id).localeCompare(b.name || b.id),
  );
  return [...order, ...rest];
}

/**
 * Models Ctrl+P actually cycles: saved scope → DEFAULT_SCOPE → all ordered.
 */
function effectiveScope(groupId: string, ordered: Model<Api>[]): Model<Api>[] {
  const check = (ids: string[]) => {
    const filtered = ordered.filter((m) => ids.includes(m.id));
    return filtered.length > 0 ? filtered : null;
  };

  const saved = scopes[groupId];
  if (saved && saved.length > 0) {
    const result = check(saved);
    if (result) return result;
  }

  const defaults = DEFAULT_SCOPE[groupId];
  if (defaults && defaults.length > 0) {
    const result = check(defaults);
    if (result) return result;
  }

  return ordered;
}

function cycleModels(registry: Registry, groupId: string): Model<Api>[] {
  return effectiveScope(groupId, orderedModels(registry, groupId));
}

/** Allowed providers present in the model registry. */
function availableGroups(registry: Registry): string[] {
  const available = new Set(
    registry.getAvailable().map((m) => resolveGroup(m.provider)),
  );
  return ALLOWED_PROVIDERS.filter((id) => available.has(id));
}

function groupLabel(registry: Registry, groupId: string): string {
  const name = groupDisplayName(registry, groupId);
  const total = orderedModels(registry, groupId).length;
  const active = cycleModels(registry, groupId).length;
  const count = active === total ? `${total}` : `${active}/${total}`;
  return `${name} · ${count} model${active === 1 ? "" : "s"}`;
}

// ---------------------------------------------------------------------------
// Extension
// ---------------------------------------------------------------------------

let lastRegistry: Registry | undefined;

export default function providerProfiles(pi: ExtensionAPI) {
  pi.on("session_start", (_event, ctx) => {
    lastRegistry = ctx.modelRegistry;
    loadScopes();
  });
  pi.on("model_select", (_event, ctx) => {
    lastRegistry = ctx.modelRegistry;
  });

  /** Ctrl+P: next model in the current group's scope. */
  async function cycleModel(ctx: ExtensionContext) {
    const current = ctx.model;
    if (!current) {
      ctx.ui.notify("No active model.", "warning");
      return;
    }
    const groupId = resolveGroup(current.provider);
    if (!ALLOWED_PROVIDERS.includes(groupId)) {
      ctx.ui.notify("Only the OpenAI Codex provider is enabled.", "warning");
      return;
    }
    const list = cycleModels(ctx.modelRegistry, groupId);
    const groupName = groupDisplayName(ctx.modelRegistry, groupId);

    if (list.length <= 1) {
      ctx.ui.notify(
        `${groupName}: only one model in scope. Use /scope to add more.`,
        "info",
      );
      return;
    }

    const idx = list.findIndex((m) => m.id === current.id);
    const next = list[(idx + 1) % list.length];
    const ok = await pi.setModel(next);
    if (!ok) {
      ctx.ui.notify(`Could not switch to ${next.name} (no auth).`, "error");
      return;
    }
    ctx.ui.notify(
      `${groupName}: ${next.name} (${list.indexOf(next) + 1}/${list.length})`,
      "info",
    );
  }

  async function applyGroup(
    ctx: ExtensionContext,
    groupId: string,
    keepCurrent: boolean,
  ) {
    const list = cycleModels(ctx.modelRegistry, groupId);
    const name = groupDisplayName(ctx.modelRegistry, groupId);
    if (list.length === 0) {
      ctx.ui.notify(`No available models for ${name}.`, "warning");
      return;
    }

    const current = ctx.model;
    const isInGroup =
      current && groupMembers(groupId).includes(current.provider);
    const target =
      keepCurrent && isInGroup
        ? (list.find((m) => m.id === current!.id) ?? list[0])
        : list[0];

    const ok = await pi.setModel(target);
    ctx.ui.notify(
      ok
        ? `${name}: ${target.name} · Ctrl+P cycles ${list.length} model${list.length === 1 ? "" : "s"}`
        : `Could not switch to ${target.name} (no auth).`,
      ok ? "info" : "error",
    );
  }

  pi.registerShortcut("ctrl+p", {
    description: "Cycle model within the current provider group",
    handler: (ctx) => cycleModel(ctx),
  });
  pi.registerCommand("provider", {
    description: "Select the configured OpenAI Codex provider",
    getArgumentCompletions: (prefix: string): AutocompleteItem[] | null => {
      if (!lastRegistry) return null;
      const q = prefix.trim().toLowerCase();
      const items = availableGroups(lastRegistry)
        .filter((id) => id.startsWith(q))
        .map((id) => ({ value: id, label: id }));
      return items.length > 0 ? items : null;
    },
    handler: async (args, ctx) => {
      lastRegistry = ctx.modelRegistry;
      const groups = availableGroups(ctx.modelRegistry);
      if (groups.length === 0) {
        ctx.ui.notify(
          "No providers with configured auth. Use /login first.",
          "warning",
        );
        return;
      }

      const arg = args.trim().toLowerCase();
      if (arg) {
        const exact = groups.find((id) => id === arg);
        const matches = exact
          ? [exact]
          : groups.filter(
              (id) =>
                id.includes(arg) ||
                groupDisplayName(ctx.modelRegistry, id)
                  .toLowerCase()
                  .includes(arg),
            );
        if (matches.length === 0) {
          ctx.ui.notify(
            `No provider matches "${args.trim()}". Available: ${groups.join(", ")}`,
            "warning",
          );
          return;
        }
        if (matches.length > 1) {
          ctx.ui.notify(
            `Ambiguous "${args.trim()}": ${matches.join(", ")}`,
            "warning",
          );
          return;
        }
        await applyGroup(ctx, matches[0], true);
        return;
      }

      if (!ctx.hasUI) {
        ctx.ui.notify(`Groups: ${groups.join(", ")}`, "info");
        return;
      }

      const labels = groups.map(
        (id) =>
          `${resolveGroup(ctx.model?.provider ?? "") === id ? "● " : "  "}${groupLabel(ctx.modelRegistry, id)}`,
      );
      const choice = await ctx.ui.select("Switch provider:", labels);
      if (!choice) return;
      const picked = groups[labels.indexOf(choice)];
      if (picked) await applyGroup(ctx, picked, true);
    },
  });

  pi.registerCommand("scope", {
    description:
      "Toggle which models Ctrl+P cycles for the current provider group",
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      const current = ctx.model;
      if (!current) {
        ctx.ui.notify(
          "No active model; pick a provider first with /provider.",
          "warning",
        );
        return;
      }
      if (ctx.mode !== "tui") {
        ctx.ui.notify("/scope requires interactive (TUI) mode.", "error");
        return;
      }

      const groupId = resolveGroup(current.provider);
      if (!ALLOWED_PROVIDERS.includes(groupId)) {
        ctx.ui.notify("Only the OpenAI Codex provider is enabled.", "warning");
        return;
      }
      const groupName = groupDisplayName(ctx.modelRegistry, groupId);
      const ordered = orderedModels(ctx.modelRegistry, groupId);

      if (ordered.length === 0) {
        ctx.ui.notify(`No available models for ${groupName}.`, "warning");
        return;
      }

      // Initial enabled set: saved scope > DEFAULT_SCOPE > all
      const initiallyEnabled = new Set(
        effectiveScope(groupId, ordered).map((m) => m.id),
      );

      await ctx.ui.custom<void>((_tui, theme, _kb, done) => {
        const items: SettingItem[] = ordered.map((model) => ({
          id: model.id,
          label: `${model.id === current.id ? "● " : "  "}${model.name || model.id}`,
          description: model.id,
          currentValue: initiallyEnabled.has(model.id) ? "on" : "off",
          values: ["on", "off"],
        }));

        const subtitle = theme.fg("dim", groupId);

        const container = new Container();
        container.addChild(
          new Text(
            `${theme.fg("accent", theme.bold(`Ctrl+P scope · ${groupName}`))}\n${subtitle}\n${theme.fg("muted", "Enter/Space toggles · Esc closes and saves")}`,
            1,
            1,
          ),
        );

        const list = new SettingsList(
          items,
          Math.min(items.length + 4, 18),
          getSettingsListTheme(),
          (id, value) => {
            if (value === "on") initiallyEnabled.add(id);
            else initiallyEnabled.delete(id);
          },
          () => done(undefined),
          { enableSearch: true },
        );
        container.addChild(list);

        return {
          render: (w: number) => container.render(w),
          invalidate: () => container.invalidate(),
          handleInput: (data: string) => list.handleInput?.(data),
        };
      });

      // All enabled = same as no scope. Preserve order from orderedModels.
      const allEnabled = ordered.every((m) => initiallyEnabled.has(m.id));
      if (initiallyEnabled.size === 0 || allEnabled) {
        delete scopes[groupId];
      } else {
        scopes[groupId] = ordered
          .filter((m) => initiallyEnabled.has(m.id))
          .map((m) => m.id);
      }
      saveScopes();

      const cycling = cycleModels(ctx.modelRegistry, groupId);
      ctx.ui.notify(
        `${groupName}: Ctrl+P cycles ${cycling.length} model${cycling.length === 1 ? "" : "s"}`,
        "info",
      );

      // Keep active model inside the new scope.
      if (!cycling.some((m) => m.id === current.id)) {
        await pi.setModel(cycling[0]);
      }
    },
  });
}
