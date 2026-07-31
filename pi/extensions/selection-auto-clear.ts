/**
 * Clear the chat selection after pi-powerline-footer auto-copies it.
 *
 * pi-powerline-footer's fixed editor copies a mouse selection to the clipboard on
 * mouse release (`powerline.copyOnSelect`), but leaves the highlight on screen.
 * This extension keeps that copy behavior and drops the highlight afterwards, like
 * opencode does.
 *
 * How it works: after the compositor has handled a left-button release, a synthetic
 * zero-width click is replayed into the TUI. The compositor treats that as "clicked
 * without selecting anything" and clears its selection. No powerline internals are
 * imported or patched, so package updates cannot break the patch surface.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const WIDGET_KEY = "selection-auto-clear";
const SGR_MOUSE_PATTERN = /\x1b\[<(\d+);(\d+);(\d+)([Mm])/g;
/** Column 2 stays inside the content area for both `outputPad: 0` and `outputPad: 1`. */
const SYNTHETIC_CLICK_COL = 2;
/** Row 1 is always inside the scrollable chat viewport. */
const SYNTHETIC_CLICK_ROW = 1;

interface TerminalLike {
	rows?: number;
	write?(data: string): void;
}

interface TuiLike {
	handleInput(data: string): void;
	hasOverlay?(): boolean;
	terminal?: TerminalLike;
}

function mouseBaseButton(code: number): number {
	return code & ~(4 | 8 | 16 | 32);
}

/** True when `data` contains a left-button release report (drag end or plain click). */
function hasLeftButtonRelease(data: string): boolean {
	if (!data.includes("\x1b[<")) return false;

	for (const match of data.matchAll(SGR_MOUSE_PATTERN)) {
		if (match[4] === "m" && mouseBaseButton(Number(match[1])) === 0) {
			return true;
		}
	}

	return false;
}

/**
 * The powerline compositor takes ownership of mouse reporting by redefining `rows`
 * as an own accessor on the terminal. Without it, no component renders selections,
 * so replaying clicks would be pointless and could reach the editor as raw input.
 */
function isFixedEditorCompositorActive(tui: TuiLike): boolean {
	const terminal = tui.terminal;
	if (!terminal) return false;

	return typeof Object.getOwnPropertyDescriptor(terminal, "rows")?.get === "function";
}

function hasVisibleOverlay(tui: TuiLike): boolean {
	return typeof tui.hasOverlay === "function" && tui.hasOverlay();
}

function installSelectionAutoClear(tui: TuiLike): void {
	const patchedTui = tui as TuiLike & { __selectionAutoClearInstalled?: boolean };
	if (patchedTui.__selectionAutoClearInstalled) return;
	patchedTui.__selectionAutoClearInstalled = true;

	const originalHandleInput = tui.handleInput.bind(tui);
	let replaying = false;

	tui.handleInput = (data: string): void => {
		if (replaying) {
			originalHandleInput(data);
			return;
		}

		const shouldClearSelection = hasLeftButtonRelease(data);
		originalHandleInput(data);

		if (!shouldClearSelection) return;
		if (!isFixedEditorCompositorActive(tui) || hasVisibleOverlay(tui)) return;

		const press = `\x1b[<0;${SYNTHETIC_CLICK_COL};${SYNTHETIC_CLICK_ROW}M`;
		const release = `\x1b[<0;${SYNTHETIC_CLICK_COL};${SYNTHETIC_CLICK_ROW}m`;

		replaying = true;
		try {
			originalHandleInput(press);
			originalHandleInput(release);
		} finally {
			replaying = false;
		}
	};
}

export default function (pi: ExtensionAPI) {
	pi.on("session_start", (_event, ctx) => {
		if (ctx.mode !== "tui") return;

		// A zero-line widget is only used to obtain the TUI instance; it renders nothing.
		ctx.ui.setWidget(WIDGET_KEY, (tui) => {
			installSelectionAutoClear(tui as unknown as TuiLike);
			return {
				render: () => [],
				invalidate: () => {},
			};
		});
	});
}
