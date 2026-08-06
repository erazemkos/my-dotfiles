/**
 * Provider profiles: per-provider scope, cycling, and provider switching.
 *
 * Workflow
 * --------
 *   Ctrl+R        – cycle to the next provider group (kitty-safe)
 *   Shift+Ctrl+P  – same, but kitty swallows the first press (see below)
 *   /provider     – switch provider by name or selector
 *   /scope        – toggle which models Ctrl+P cycles for the current group
 *   Ctrl+P        – cycle through the scoped models of the current group
 *   Ctrl+L        – pi's built-in full cross-provider picker (unchanged)
 *
 * Provider groups
 * ---------------
 * PROVIDER_GROUPS merges multiple actual providers into one logical group.
 * `bedrock` combines `amazon-bedrock` (Claude via Converse) and
 * `bedrock-mantle` (GPT/Grok via the local SigV4 proxy). When two providers
 * expose the same model id, the later entry in the group array wins — so
 * bedrock-mantle's working `openai.gpt-5.6-sol` replaces amazon-bedrock's
 * broken Converse copy.
 *
 * Defaults and scope
 * ------------------
 * DEFAULT_SCOPE defines which models start *enabled* in /scope when the user
 * has not saved a custom scope yet. Only opus-5 global + gpt-5.6 sol/terra
 * are on by default; the rest are in the list but off.
 *
 * Scope is persisted per group to ~/.pi/agent/provider-profiles.json
 * (per-machine runtime state, not in the dotfiles repo).
 *
 * Keybinding note
 * ---------------
 * app.model.cycleForward/cycleBackward are reserved keybindings that block
 * extension overrides. pi/keybindings.json unbinds them so ctrl+p and
 * shift+ctrl+p are available. Both files must ship together.
 *
 * Built-in /scoped-models is handled by pi before extension commands and
 * cannot be overridden. /scope is the per-group equivalent.
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

/**
 * Group id → actual provider ids.
 * Later entries in the array win when two providers share a model id.
 */
const PROVIDER_GROUPS: Record<string, string[]> = {
  bedrock: ["amazon-bedrock", "bedrock-mantle"],
};

/**
 * Which model ids start ENABLED in /scope before the user saves a custom
 * selection. A group with no entry starts with all models on.
 */
const DEFAULT_SCOPE: Record<string, string[]> = {
  arcus: [
    "anthropic.claude-opus-5",
    "openai.gpt-5.6-sol",
    "openai.gpt-5.6-terra",
  ],
  bedrock: [
    "global.anthropic.claude-opus-5",
    "openai.gpt-5.6-sol", // bedrock-mantle version wins via dedup (works via proxy)
    "openai.gpt-5.6-terra", // bedrock-mantle version wins via dedup
  ],
  "openai-codex": ["gpt-5.6-sol", "gpt-5.6-terra"],
  cursor: ["claude-opus-5@1m", "gpt-5.6-sol@272k", "gpt-5.6-terra@272k"],
};

/**
 * Ordered model ids shown first in /scope and Ctrl+P.
 * Any available model not listed is appended after these, sorted by name.
 */
const DEFAULT_ORDER: Record<string, string[]> = {
  arcus: [
    "anthropic.claude-opus-5",
    "openai.gpt-5.6-sol",
    "openai.gpt-5.6-terra",
    "anthropic.claude-sonnet-4-6",
    "anthropic.claude-opus-4-8",
  ],
  bedrock: [
    "global.anthropic.claude-opus-5",
    "openai.gpt-5.6-sol",
    "openai.gpt-5.6-terra",
    "openai.gpt-5.6-luna",
    "xai.grok-4.3",
    "global.anthropic.claude-sonnet-4-6",
    "global.anthropic.claude-opus-4-8",
    "global.anthropic.claude-haiku-4-5-20251001-v1:0",
  ],
  "openai-codex": ["gpt-5.6-sol", "gpt-5.6-terra"],
  cursor: [
    "claude-opus-5@1m",
    "gpt-5.6-sol@272k",
    "gpt-5.6-terra@272k",
    "claude-opus-5@300k",
    "gpt-5.6-sol@1m",
    "gpt-5.6-terra@1m",
  ],
};

/** Human-readable display names for groups (standalone providers use the registry name). */
const GROUP_DISPLAY_NAMES: Record<string, string> = {
  bedrock: "Amazon Bedrock",
};

/** Preferred order for Shift+Ctrl+P and /provider. Unlisted groups follow sorted by name. */
const PROVIDER_ORDER = ["arcus", "bedrock", "openai-codex", "cursor"];

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
// Group helpers
// ---------------------------------------------------------------------------

type Registry = ExtensionContext["modelRegistry"];

/** Maps an actual provider id to its logical group id (or itself if ungrouped). */
function resolveGroup(providerId: string): string {
  for (const [group, members] of Object.entries(PROVIDER_GROUPS)) {
    if (members.includes(providerId)) return group;
  }
  return providerId;
}

/** Returns the actual provider ids that belong to a group. */
function groupMembers(groupId: string): string[] {
  return PROVIDER_GROUPS[groupId] ?? [groupId];
}

function groupDisplayName(registry: Registry, groupId: string): string {
  return (
    GROUP_DISPLAY_NAMES[groupId] ??
    registry.getProviderDisplayName(groupMembers(groupId)[0] ?? groupId)
  );
}

/**
 * All available models for a group, deduplicated by model id (later member
 * in PROVIDER_GROUPS wins), then ordered by DEFAULT_ORDER + alpha remainder.
 */
function orderedModels(registry: Registry, groupId: string): Model<Api>[] {
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

/** All available groups in preferred order. */
function availableGroups(registry: Registry): string[] {
  const seen = new Set(
    registry.getAvailable().map((m) => resolveGroup(m.provider)),
  );
  return [...seen].sort((a, b) => {
    const ia = PROVIDER_ORDER.indexOf(a);
    const ib = PROVIDER_ORDER.indexOf(b);
    if (ia !== -1 || ib !== -1)
      return (ia === -1 ? Infinity : ia) - (ib === -1 ? Infinity : ib);
    return groupDisplayName(registry, a).localeCompare(
      groupDisplayName(registry, b),
    );
  });
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

  /** Shift+Ctrl+P: next provider group, landing on its first scoped model. */
  async function cycleGroup(ctx: ExtensionContext) {
    const groups = availableGroups(ctx.modelRegistry);
    if (groups.length === 0) {
      ctx.ui.notify("No providers with configured auth.", "warning");
      return;
    }
    if (groups.length === 1) {
      ctx.ui.notify(
        `Only ${groupDisplayName(ctx.modelRegistry, groups[0])} is configured.`,
        "info",
      );
      return;
    }
    const currentGroup = ctx.model ? resolveGroup(ctx.model.provider) : "";
    const idx = groups.indexOf(currentGroup);
    const next = groups[(idx + 1) % groups.length];
    await applyGroup(ctx, next, false);
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
  pi.registerShortcut("shift+ctrl+p", {
    description: "Cycle to next provider group",
    handler: (ctx) => cycleGroup(ctx),
  });
  // kitty reserves kitty_mod+p (= ctrl+shift+p by default) as a multi-key
  // PREFIX for its hints/choose-files kittens, so the first press is swallowed
  // by kitty's pending-sequence mode and only a second press reaches pi.
  // ctrl+r is conflict-free: kitty leaves plain ctrl+r alone, and pi only binds
  // it inside the session picker (app.session.rename), never in the editor.
  pi.registerShortcut("ctrl+r", {
    description: "Cycle to next provider group (kitty-safe alias)",
    handler: (ctx) => cycleGroup(ctx),
  });

  pi.registerCommand("provider", {
    description:
      "Switch provider group (Shift+Ctrl+P cycles, Ctrl+P then cycles its models)",
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
      const groupName = groupDisplayName(ctx.modelRegistry, groupId);
      const members = groupMembers(groupId);
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
        // Show provider badge when the group spans multiple providers
        const showBadge = members.length > 1;
        const shortBadge = (providerId: string) => {
          if (providerId === "bedrock-mantle") return " [mantle]";
          if (providerId === "amazon-bedrock") return " [converse]";
          return ` [${providerId}]`;
        };

        const items: SettingItem[] = ordered.map((model) => ({
          id: model.id,
          label:
            `${model.id === current.id ? "● " : "  "}${model.name || model.id}` +
            (showBadge ? theme.fg("dim", shortBadge(model.provider)) : ""),
          description: model.id,
          currentValue: initiallyEnabled.has(model.id) ? "on" : "off",
          values: ["on", "off"],
        }));

        const subtitle =
          members.length > 1
            ? theme.fg("dim", `${members.join(" + ")}`)
            : theme.fg("dim", members[0] ?? groupId);

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
