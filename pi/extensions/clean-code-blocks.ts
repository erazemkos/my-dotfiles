/**
 * Clean code block rendering for pi's TUI markdown.
 *
 * - Hides ``` fence lines
 * - Wraps code with horizontal separator lines (─)
 * - Leaves code lines unprefixed for easy copy-paste
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Markdown } from "@earendil-works/pi-tui";

type MarkdownInstance = InstanceType<typeof Markdown> & {
	theme: {
		codeBlock: (text: string) => string;
		hr: (text: string) => string;
		highlightCode?: (code: string, lang?: string) => string[];
	};
};

let patched = false;

function patchMarkdownCodeBlocks(): void {
	if (patched) return;
	patched = true;

	const originalRenderToken = Markdown.prototype.renderToken;

	Markdown.prototype.renderToken = function (
		token,
		width,
		nextTokenType,
		styleContext,
	) {
		if (token.type !== "code") {
			return originalRenderToken.call(this, token, width, nextTokenType, styleContext);
		}

		const self = this as MarkdownInstance;
		const lines: string[] = [];
		const separator = self.theme.hr("─".repeat(Math.min(width, 80)));

		lines.push(separator);

		if (self.theme.highlightCode) {
			for (const hlLine of self.theme.highlightCode(token.text, token.lang)) {
				lines.push(hlLine);
			}
		} else {
			for (const codeLine of token.text.split("\n")) {
				lines.push(self.theme.codeBlock(codeLine));
			}
		}

		lines.push(separator);

		if (nextTokenType && nextTokenType !== "space") {
			lines.push("");
		}

		return lines;
	};
}

patchMarkdownCodeBlocks();

export default function (_pi: ExtensionAPI) {
	// Applied at load time; no runtime hooks needed.
}
