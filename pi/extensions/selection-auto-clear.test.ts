/**
 * Behavior test for pi/extensions/selection-auto-clear.ts.
 *
 * Run: node --experimental-strip-types pi/extensions/selection-auto-clear.test.ts
 *
 * Uses a fake TUI plus a fake powerline-style selection state machine so the
 * extension can be exercised without a terminal.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import extensionFactory from "./selection-auto-clear.ts";

type Handler = (event: unknown, ctx: unknown) => unknown;
type WidgetFactory = (tui: unknown, theme?: unknown) => { render(): string[]; invalidate(): void };

interface Selection {
	anchorRow: number;
	focusRow: number;
}

class FakeCompositor {
	selection: Selection | null = null;
	dragging = false;
	copied: string[] = [];
	overlayVisible = false;
	handledByEditor: string[] = [];

	/** Mimics TerminalSplitCompositor.handleInput for left press/drag/release. */
	handleInput(data: string): { consume?: boolean } | undefined {
		if (this.overlayVisible) return undefined;

		const match = /\x1b\[<(\d+);(\d+);(\d+)([Mm])/.exec(data);
		if (!match) return undefined;

		const code = Number(match[1]);
		const row = Number(match[3]);
		const isRelease = match[4] === "m";
		const baseButton = code & ~(4 | 8 | 16 | 32);
		if (!isRelease && (baseButton === 64 || baseButton === 65)) return { consume: true }; // wheel
		const isDrag = !isRelease && (code & 32) !== 0;

		if (isRelease) {
			this.dragging = false;
			if (this.selection && this.selection.anchorRow !== this.selection.focusRow) {
				this.copied.push(`rows ${this.selection.anchorRow}-${this.selection.focusRow}`);
			} else {
				this.selection = null;
			}
			return { consume: true };
		}

		if (isDrag) {
			if (this.dragging && this.selection) this.selection.focusRow = row;
			return { consume: true };
		}

		this.selection = { anchorRow: row, focusRow: row };
		this.dragging = true;
		return { consume: true };
	}
}

class FakeTui {
	compositor = new FakeCompositor();
	terminal: { rows: number; columns: number } = { rows: 40, columns: 100 };

	constructor(compositorActive: boolean) {
		if (compositorActive) {
			Object.defineProperty(this.terminal, "rows", { configurable: true, get: () => 30 });
		}
	}

	handleInput(data: string): void {
		const result = this.compositor.handleInput(data);
		if (result?.consume) return;
		this.compositor.handledByEditor.push(data);
	}

	hasOverlay(): boolean {
		return this.compositor.overlayVisible;
	}
}

function loadExtension(tui: FakeTui): void {
	let sessionStart: Handler | undefined;
	const widgets = new Map<string, unknown>();

	extensionFactory({
		on(event: string, handler: Handler) {
			if (event === "session_start") sessionStart = handler;
		},
	} as never);

	assert.ok(sessionStart, "extension must subscribe to session_start");

	sessionStart(
		{ reason: "startup" },
		{
			mode: "tui",
			ui: {
				setWidget(key: string, factory: WidgetFactory) {
					const component = factory(tui);
					assert.deepEqual(component.render(), [], "widget must render no lines");
					widgets.set(key, component);
				},
			},
		},
	);

	assert.equal(widgets.size, 1, "extension must register exactly one widget");
}

function drag(tui: FakeTui, fromRow: number, toRow: number): void {
	tui.handleInput(`\x1b[<0;5;${fromRow}M`);
	tui.handleInput(`\x1b[<32;9;${toRow}M`);
	tui.handleInput(`\x1b[<0;9;${toRow}m`);
}

test("drag selection is copied and then cleared", () => {
	const tui = new FakeTui(true);
	loadExtension(tui);

	drag(tui, 4, 7);

	assert.deepEqual(tui.compositor.copied, ["rows 4-7"], "selection must still be copied once");
	assert.equal(tui.compositor.selection, null, "selection highlight must be cleared");
	assert.deepEqual(tui.compositor.handledByEditor, [], "no mouse input may reach the editor");
});

test("plain click neither copies nor loops", () => {
	const tui = new FakeTui(true);
	loadExtension(tui);

	tui.handleInput("\x1b[<0;5;4M");
	tui.handleInput("\x1b[<0;5;4m");

	assert.deepEqual(tui.compositor.copied, []);
	assert.equal(tui.compositor.selection, null);
});

test("wheel scroll leaves selection untouched", () => {
	const tui = new FakeTui(true);
	loadExtension(tui);

	tui.handleInput("\x1b[<0;5;4M");
	tui.handleInput("\x1b[<32;9;9M");
	tui.handleInput("\x1b[<64;9;9M");

	assert.deepEqual(tui.compositor.selection, { anchorRow: 4, focusRow: 9 }, "in-progress drag survives wheel input");
	assert.deepEqual(tui.compositor.copied, []);
});

test("no synthetic clicks without the fixed-editor compositor", () => {
	const tui = new FakeTui(false);
	loadExtension(tui);

	drag(tui, 4, 7);

	assert.deepEqual(tui.compositor.copied, ["rows 4-7"]);
	assert.deepEqual(tui.compositor.selection, { anchorRow: 4, focusRow: 7 }, "selection is left to powerline");
});

test("no synthetic clicks while an overlay is visible", () => {
	const tui = new FakeTui(true);
	loadExtension(tui);
	tui.compositor.overlayVisible = true;

	tui.handleInput("\x1b[<0;9;7m");

	assert.deepEqual(tui.compositor.handledByEditor, ["\x1b[<0;9;7m"], "only the real release reaches the editor");
});

test("installing twice does not double-patch handleInput", () => {
	const tui = new FakeTui(true);
	loadExtension(tui);
	loadExtension(tui);

	drag(tui, 4, 7);

	assert.deepEqual(tui.compositor.copied, ["rows 4-7"], "selection must not be copied twice");
	assert.equal(tui.compositor.selection, null);
});
