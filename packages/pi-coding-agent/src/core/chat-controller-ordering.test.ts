import assert from "node:assert/strict";
import { test } from "node:test";

import { handleAgentEvent } from "../modes/interactive/controllers/chat-controller.js";

function makeUsage() {
	return {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
}

function makeAssistant(content: any[]) {
	return {
		role: "assistant",
		content,
		api: "anthropic-messages",
		provider: "claude-code",
		model: "claude-sonnet-4",
		usage: makeUsage(),
		stopReason: "stop",
		timestamp: Date.now(),
	};
}

function createHost() {
	const chatContainer = {
		children: [] as any[],
		addChild(component: any) {
			this.children.push(component);
		},
		removeChild(component: any) {
			const idx = this.children.indexOf(component);
			if (idx !== -1) this.children.splice(idx, 1);
		},
		clear() {
			this.children = [];
		},
	};

	const pinnedMessageContainer = {
		children: [] as any[],
		addChild(component: any) {
			this.children.push(component);
		},
		removeChild(component: any) {
			const idx = this.children.indexOf(component);
			if (idx !== -1) this.children.splice(idx, 1);
		},
		clear() {
			this.children = [];
		},
	};

	const host: any = {
		isInitialized: true,
		init: async () => {},
		defaultEditor: { onEscape: undefined },
		editor: {},
		session: { retryAttempt: 0, abortCompaction: () => {}, abortRetry: () => {} },
		ui: { requestRender: () => {}, terminal: { rows: 50 } },
		footer: { invalidate: () => {} },
		keybindings: {},
		statusContainer: { clear: () => {}, addChild: () => {} },
		chatContainer,
		settingsManager: { getTimestampFormat: () => "date-time-iso", getShowImages: () => false },
		pendingTools: new Map(),
		toolOutputExpanded: false,
		hideThinkingBlock: false,
		isBashMode: false,
		defaultWorkingMessage: "Working...",
		compactionQueuedMessages: [],
		editorContainer: {},
		pendingMessagesContainer: { clear: () => {} },
		pinnedMessageContainer,
		addMessageToChat: () => {},
		getMarkdownThemeWithSettings: () => ({}),
		formatWebSearchResult: () => "",
		getRegisteredToolDefinition: () => undefined,
		checkShutdownRequested: async () => {},
		rebuildChatFromMessages: () => {},
		flushCompactionQueue: async () => {},
		showStatus: () => {},
		showError: () => {},
		updatePendingMessagesDisplay: () => {},
		updateTerminalTitle: () => {},
		updateEditorBorderColor: () => {},
	};

	return host;
}

test("chat-controller renders content blocks in content[] index order (tool-first stream)", async () => {
	// ToolExecutionComponent uses the global theme singleton.
	// Install a minimal no-op theme implementation for this unit test.
	(globalThis as any)[Symbol.for("@gsd/pi-coding-agent:theme")] = {
		fg: (_key: string, text: string) => text,
		bg: (_key: string, text: string) => text,
		bold: (text: string) => text,
		italic: (text: string) => text,
		truncate: (text: string) => text,
	};

	const host = createHost();
	const toolId = "mcp-tool-1";
	const toolCall = {
		type: "toolCall",
		id: toolId,
		name: "exec_command",
		arguments: { cmd: "echo hi" },
	};

	await handleAgentEvent(host, { type: "message_start", message: makeAssistant([]) } as any);

	assert.equal(host.chatContainer.children.length, 0, "nothing should render before content arrives");

	await handleAgentEvent(
		host,
		{
			type: "message_update",
			message: makeAssistant([toolCall]),
			assistantMessageEvent: {
				type: "toolcall_end",
				contentIndex: 0,
				toolCall: {
					...toolCall,
					externalResult: {
						content: [{ type: "text", text: "tool output" }],
						details: {},
						isError: false,
					},
				},
				partial: makeAssistant([toolCall]),
			},
		} as any,
	);

	// content[0] = toolCall → ToolExecutionComponent renders first
	assert.equal(host.chatContainer.children.length, 1, "tool execution block should render immediately");
	assert.equal(host.chatContainer.children[0]?.constructor?.name, "ToolExecutionComponent");

	host.getMarkdownThemeWithSettings = () => ({});

	await handleAgentEvent(
		host,
		{
			type: "message_update",
			message: makeAssistant([toolCall, { type: "text", text: "done" }]),
			assistantMessageEvent: {
				type: "text_delta",
				contentIndex: 1,
				delta: "done",
				partial: makeAssistant([toolCall, { type: "text", text: "done" }]),
			},
		} as any,
	);

	// content[0]=toolCall, content[1]=text → order: tool, then text
	assert.equal(host.chatContainer.children.length, 2, "text run should render after tool in content[] order");
	assert.equal(host.chatContainer.children[0]?.constructor?.name, "ToolExecutionComponent");
	assert.equal(host.chatContainer.children[1]?.constructor?.name, "AssistantMessageComponent");
});

test("chat-controller renders serverToolUse before trailing text matching content[] index order", async () => {
	(globalThis as any)[Symbol.for("@gsd/pi-coding-agent:theme")] = {
		fg: (_key: string, text: string) => text,
		bg: (_key: string, text: string) => text,
		bold: (text: string) => text,
		italic: (text: string) => text,
		truncate: (text: string) => text,
	};

	const host = createHost();
	const toolId = "mcp-secure-1";
	const serverToolUse = {
		type: "serverToolUse",
		id: toolId,
		name: "mcp__gsd-workflow__secure_env_collect",
		input: { projectDir: "/tmp/project", keys: [{ key: "SECURE_PASSWORD" }], destination: "dotenv" },
	};

	await handleAgentEvent(host, { type: "message_start", message: makeAssistant([]) } as any);

	await handleAgentEvent(
		host,
		{
			type: "message_update",
			message: makeAssistant([serverToolUse]),
			assistantMessageEvent: {
				type: "server_tool_use",
				contentIndex: 0,
				partial: makeAssistant([serverToolUse]),
			},
		} as any,
	);

	// content[0] = serverToolUse → ToolExecutionComponent renders first
	assert.equal(host.chatContainer.children.length, 1, "server tool block should render immediately");
	assert.equal(host.chatContainer.children[0]?.constructor?.name, "ToolExecutionComponent");

	host.getMarkdownThemeWithSettings = () => ({});
	const resultMessage = makeAssistant([
		{
			...serverToolUse,
			externalResult: {
				content: [{ type: "text", text: "secure_env_collect was cancelled by user." }],
				details: {},
				isError: true,
			},
		},
		{ type: "text", text: "The secure password collection was cancelled." },
	]);

	await handleAgentEvent(
		host,
		{
			type: "message_update",
			message: resultMessage,
			assistantMessageEvent: {
				type: "server_tool_use",
				contentIndex: 0,
				partial: resultMessage,
			},
		} as any,
	);

	// content[0]=serverToolUse, content[1]=text → order: tool, then text
	assert.equal(host.chatContainer.children.length, 2, "text run should render after server tool in content[] order");
	assert.equal(host.chatContainer.children[0]?.constructor?.name, "ToolExecutionComponent");
	assert.equal(host.chatContainer.children[1]?.constructor?.name, "AssistantMessageComponent");
});

test("chat-controller pins latest assistant text above editor when tool calls are present", async () => {
	(globalThis as any)[Symbol.for("@gsd/pi-coding-agent:theme")] = {
		fg: (_key: string, text: string) => text,
		bg: (_key: string, text: string) => text,
		bold: (text: string) => text,
		italic: (text: string) => text,
		truncate: (text: string) => text,
	};

	const host = createHost();
	const toolId = "tool-pin-1";
	const toolCall = {
		type: "toolCall",
		id: toolId,
		name: "exec_command",
		arguments: { cmd: "echo hi" },
	};

	await handleAgentEvent(host, { type: "message_start", message: makeAssistant([]) } as any);

	assert.equal(host.pinnedMessageContainer.children.length, 0, "pinned zone should be empty at message_start");

	// Send a message with text followed by a tool call
	host.getMarkdownThemeWithSettings = () => ({});
	await handleAgentEvent(
		host,
		{
			type: "message_update",
			message: makeAssistant([
				{ type: "text", text: "Looking at the files now." },
				toolCall,
			]),
			assistantMessageEvent: {
				type: "toolcall_end",
				contentIndex: 1,
				toolCall: {
					...toolCall,
					externalResult: {
						content: [{ type: "text", text: "file contents" }],
						details: {},
						isError: false,
					},
				},
				partial: makeAssistant([{ type: "text", text: "Looking at the files now." }, toolCall]),
			},
		} as any,
	);

	// Pinned zone should now have a DynamicBorder and a Markdown component
	assert.equal(host.pinnedMessageContainer.children.length, 2, "pinned zone should have border + markdown");
	assert.equal(host.pinnedMessageContainer.children[0]?.constructor?.name, "DynamicBorder");
	assert.equal(host.pinnedMessageContainer.children[1]?.constructor?.name, "Markdown");
});

test("chat-controller clears pinned zone when a new assistant message starts", async () => {
	(globalThis as any)[Symbol.for("@gsd/pi-coding-agent:theme")] = {
		fg: (_key: string, text: string) => text,
		bg: (_key: string, text: string) => text,
		bold: (text: string) => text,
		italic: (text: string) => text,
		truncate: (text: string) => text,
	};

	const host = createHost();
	const toolCall = {
		type: "toolCall",
		id: "tool-clear-1",
		name: "exec_command",
		arguments: { cmd: "echo hi" },
	};

	await handleAgentEvent(host, { type: "message_start", message: makeAssistant([]) } as any);

	// Populate the pinned zone
	host.getMarkdownThemeWithSettings = () => ({});
	await handleAgentEvent(
		host,
		{
			type: "message_update",
			message: makeAssistant([{ type: "text", text: "Working on it." }, toolCall]),
			assistantMessageEvent: {
				type: "toolcall_end",
				contentIndex: 1,
				toolCall: {
					...toolCall,
					externalResult: {
						content: [{ type: "text", text: "ok" }],
						details: {},
						isError: false,
					},
				},
				partial: makeAssistant([{ type: "text", text: "Working on it." }, toolCall]),
			},
		} as any,
	);

	assert.ok(host.pinnedMessageContainer.children.length > 0, "pinned zone should be populated");

	// Start a new assistant message — pinned zone should clear
	await handleAgentEvent(host, { type: "message_start", message: makeAssistant([]) } as any);

	assert.equal(host.pinnedMessageContainer.children.length, 0, "pinned zone should clear on new assistant message");
});

test("chat-controller clears pinned zone when the agent turn ends", async () => {
	(globalThis as any)[Symbol.for("@gsd/pi-coding-agent:theme")] = {
		fg: (_key: string, text: string) => text,
		bg: (_key: string, text: string) => text,
		bold: (text: string) => text,
		italic: (text: string) => text,
		truncate: (text: string) => text,
	};

	const host = createHost();
	const toolCall = {
		type: "toolCall",
		id: "tool-clear-on-end-1",
		name: "exec_command",
		arguments: { cmd: "echo hi" },
	};

	await handleAgentEvent(host, { type: "message_start", message: makeAssistant([]) } as any);

	host.getMarkdownThemeWithSettings = () => ({});
	await handleAgentEvent(
		host,
		{
			type: "message_update",
			message: makeAssistant([{ type: "text", text: "Working on it." }, toolCall]),
			assistantMessageEvent: {
				type: "toolcall_end",
				contentIndex: 1,
				toolCall: {
					...toolCall,
					externalResult: {
						content: [{ type: "text", text: "ok" }],
						details: {},
						isError: false,
					},
				},
				partial: makeAssistant([{ type: "text", text: "Working on it." }, toolCall]),
			},
		} as any,
	);

	assert.ok(host.pinnedMessageContainer.children.length > 0, "pinned zone should be populated before agent_end");

	await handleAgentEvent(host, { type: "agent_end" } as any);

	assert.equal(host.pinnedMessageContainer.children.length, 0, "pinned zone should clear on agent_end");
});

test("chat-controller clears pinned zone when assistant message ends", async () => {
	(globalThis as any)[Symbol.for("@gsd/pi-coding-agent:theme")] = {
		fg: (_key: string, text: string) => text,
		bg: (_key: string, text: string) => text,
		bold: (text: string) => text,
		italic: (text: string) => text,
		truncate: (text: string) => text,
	};

	const host = createHost();
	const toolCall = {
		type: "toolCall",
		id: "tool-msg-end-1",
		name: "exec_command",
		arguments: { cmd: "echo hi" },
	};

	await handleAgentEvent(host, { type: "message_start", message: makeAssistant([]) } as any);

	host.getMarkdownThemeWithSettings = () => ({});
	const msgContent = [{ type: "text", text: "Summary after tools." }, toolCall];
	await handleAgentEvent(
		host,
		{
			type: "message_update",
			message: makeAssistant(msgContent),
			assistantMessageEvent: {
				type: "toolcall_end",
				contentIndex: 1,
				toolCall: {
					...toolCall,
					externalResult: {
						content: [{ type: "text", text: "ok" }],
						details: {},
						isError: false,
					},
				},
				partial: makeAssistant(msgContent),
			},
		} as any,
	);

	assert.ok(host.pinnedMessageContainer.children.length > 0, "pinned zone should be populated during streaming");

	// End the assistant message (e.g. before form elicitation) — pinned zone should clear
	await handleAgentEvent(host, { type: "message_end", message: makeAssistant(msgContent) } as any);

	assert.equal(host.pinnedMessageContainer.children.length, 0, "pinned zone should clear on message_end to prevent duplicate display");
});

test("chat-controller does not pin when there are no tool calls", async () => {
	(globalThis as any)[Symbol.for("@gsd/pi-coding-agent:theme")] = {
		fg: (_key: string, text: string) => text,
		bg: (_key: string, text: string) => text,
		bold: (text: string) => text,
		italic: (text: string) => text,
		truncate: (text: string) => text,
	};

	const host = createHost();

	await handleAgentEvent(host, { type: "message_start", message: makeAssistant([]) } as any);

	host.getMarkdownThemeWithSettings = () => ({});
	await handleAgentEvent(
		host,
		{
			type: "message_update",
			message: makeAssistant([{ type: "text", text: "Just some text, no tools." }]),
			assistantMessageEvent: {
				type: "text_delta",
				contentIndex: 0,
				delta: "Just some text, no tools.",
				partial: makeAssistant([{ type: "text", text: "Just some text, no tools." }]),
			},
		} as any,
	);

	assert.equal(host.pinnedMessageContainer.children.length, 0, "pinned zone should stay empty without tool calls");
});

// Regression test for issue #4144: interleaved text/tool content must render in content[] index order.
// Stream: [text "A", toolCall T1, text "B", toolCall T2, text "C"]
// Expected chatContainer order: textRun(A), toolExec(T1), textRun(B), toolExec(T2), textRun(C)
// Each AssistantMessageComponent must render ONLY its own text — no duplication after message_end.
test("chat-controller renders interleaved text and tool blocks in content[] index order (#4144)", async () => {
	(globalThis as any)[Symbol.for("@gsd/pi-coding-agent:theme")] = {
		fg: (_key: string, text: string) => text,
		bg: (_key: string, text: string) => text,
		bold: (text: string) => text,
		italic: (text: string) => text,
		truncate: (text: string) => text,
	};

	const host = createHost();
	host.getMarkdownThemeWithSettings = () => ({});

	const t1 = { type: "toolCall", id: "t1", name: "tool_one", arguments: {} };
	const t2 = { type: "toolCall", id: "t2", name: "tool_two", arguments: {} };

	await handleAgentEvent(host, { type: "message_start", message: makeAssistant([]) } as any);

	// Stream text "A" at index 0
	await handleAgentEvent(host, {
		type: "message_update",
		message: makeAssistant([{ type: "text", text: "A" }]),
		assistantMessageEvent: {
			type: "text_delta",
			contentIndex: 0,
			delta: "A",
			partial: makeAssistant([{ type: "text", text: "A" }]),
		},
	} as any);

	// Stream toolCall T1 at index 1
	await handleAgentEvent(host, {
		type: "message_update",
		message: makeAssistant([{ type: "text", text: "A" }, t1]),
		assistantMessageEvent: {
			type: "toolcall_end",
			contentIndex: 1,
			toolCall: {
				...t1,
				externalResult: { content: [{ type: "text", text: "result1" }], details: {}, isError: false },
			},
			partial: makeAssistant([{ type: "text", text: "A" }, t1]),
		},
	} as any);

	// Stream text "B" at index 2
	await handleAgentEvent(host, {
		type: "message_update",
		message: makeAssistant([{ type: "text", text: "A" }, t1, { type: "text", text: "B" }]),
		assistantMessageEvent: {
			type: "text_delta",
			contentIndex: 2,
			delta: "B",
			partial: makeAssistant([{ type: "text", text: "A" }, t1, { type: "text", text: "B" }]),
		},
	} as any);

	// Stream toolCall T2 at index 3
	await handleAgentEvent(host, {
		type: "message_update",
		message: makeAssistant([{ type: "text", text: "A" }, t1, { type: "text", text: "B" }, t2]),
		assistantMessageEvent: {
			type: "toolcall_end",
			contentIndex: 3,
			toolCall: {
				...t2,
				externalResult: { content: [{ type: "text", text: "result2" }], details: {}, isError: false },
			},
			partial: makeAssistant([{ type: "text", text: "A" }, t1, { type: "text", text: "B" }, t2]),
		},
	} as any);

	// Stream text "C" at index 4
	const finalContent = [
		{ type: "text", text: "A" }, t1, { type: "text", text: "B" }, t2, { type: "text", text: "C" },
	];
	await handleAgentEvent(host, {
		type: "message_update",
		message: makeAssistant(finalContent),
		assistantMessageEvent: {
			type: "text_delta",
			contentIndex: 4,
			delta: "C",
			partial: makeAssistant(finalContent),
		},
	} as any);

	// Finalize — exercises the message_end path where a buggy setRange(undefined) would cause duplication
	await handleAgentEvent(host, { type: "message_end", message: makeAssistant(finalContent) } as any);

	// Assert interleaved order: textRun(A), toolExec(T1), textRun(B), toolExec(T2), textRun(C)
	assert.equal(host.chatContainer.children.length, 5, "should have 5 children in interleaved order");
	assert.equal(host.chatContainer.children[0]?.constructor?.name, "AssistantMessageComponent", "index 0: text run A");
	assert.equal(host.chatContainer.children[1]?.constructor?.name, "ToolExecutionComponent", "index 1: tool T1");
	assert.equal(host.chatContainer.children[2]?.constructor?.name, "AssistantMessageComponent", "index 2: text run B");
	assert.equal(host.chatContainer.children[3]?.constructor?.name, "ToolExecutionComponent", "index 3: tool T2");
	assert.equal(host.chatContainer.children[4]?.constructor?.name, "AssistantMessageComponent", "index 4: text run C");

	// Helper: collect the text of all Markdown children inside an AssistantMessageComponent.
	// Structure: AssistantMessageComponent (Container) -> contentContainer (children[0]) -> Markdown nodes.
	function getRenderedTexts(comp: any): string[] {
		const contentContainer = comp.children?.[0];
		if (!contentContainer) return [];
		return (contentContainer.children ?? [])
			.filter((c: any) => c.constructor?.name === "Markdown")
			.map((c: any) => (c as any).text as string);
	}

	// Each text-run component must contain only its own text — no cross-contamination after message_end
	assert.deepEqual(getRenderedTexts(host.chatContainer.children[0]), ["A"], "text run A must contain only 'A'");
	assert.deepEqual(getRenderedTexts(host.chatContainer.children[2]), ["B"], "text run B must contain only 'B'");
	assert.deepEqual(getRenderedTexts(host.chatContainer.children[4]), ["C"], "text run C must contain only 'C'");
});

test("chat-controller does not duplicate text when content is [text, tool, text] (interleaved stream)", async () => {
	(globalThis as any)[Symbol.for("@gsd/pi-coding-agent:theme")] = {
		fg: (_key: string, text: string) => text,
		bg: (_key: string, text: string) => text,
		bold: (text: string) => text,
		italic: (text: string) => text,
		truncate: (text: string) => text,
	};

	const host = createHost();
	host.getMarkdownThemeWithSettings = () => ({});

	const t1 = { type: "toolCall", id: "t1", name: "tool_one", arguments: {} };

	await handleAgentEvent(host, { type: "message_start", message: makeAssistant([]) } as any);

	// Step 1: text "A" at index 0
	await handleAgentEvent(host, {
		type: "message_update",
		message: makeAssistant([{ type: "text", text: "A" }]),
		assistantMessageEvent: {
			type: "text_delta",
			contentIndex: 0,
			delta: "A",
			partial: makeAssistant([{ type: "text", text: "A" }]),
		},
	} as any);

	// Step 2: toolCall at index 1
	await handleAgentEvent(host, {
		type: "message_update",
		message: makeAssistant([{ type: "text", text: "A" }, t1]),
		assistantMessageEvent: {
			type: "toolcall_end",
			contentIndex: 1,
			toolCall: {
				...t1,
				externalResult: { content: [{ type: "text", text: "result1" }], details: {}, isError: false },
			},
			partial: makeAssistant([{ type: "text", text: "A" }, t1]),
		},
	} as any);

	// Step 3: text "B" at index 2
	const finalContent = [{ type: "text", text: "A" }, t1, { type: "text", text: "B" }];
	await handleAgentEvent(host, {
		type: "message_update",
		message: makeAssistant(finalContent),
		assistantMessageEvent: {
			type: "text_delta",
			contentIndex: 2,
			delta: "B",
			partial: makeAssistant(finalContent),
		},
	} as any);

	assert.equal(host.chatContainer.children.length, 3);
	assert.equal(host.chatContainer.children[0]?.constructor?.name, "AssistantMessageComponent");
	assert.equal(host.chatContainer.children[1]?.constructor?.name, "ToolExecutionComponent");
	assert.equal(host.chatContainer.children[2]?.constructor?.name, "AssistantMessageComponent");

	const firstText = host.chatContainer.children[0];
	const secondText = host.chatContainer.children[2];
	assert.notEqual(firstText, secondText, "text-before-tool and text-after-tool must be separate component instances");
	assert.deepEqual((firstText as any).range, { startIndex: 0, endIndex: 0 }, "first text-run covers only content[0]");
	assert.deepEqual((secondText as any).range, { startIndex: 2, endIndex: 2 }, "second text-run covers only content[2]");

	// Finalize — regression guard: range must NOT be cleared on message_end (would cause duplication)
	await handleAgentEvent(host, { type: "message_end", message: makeAssistant(finalContent) } as any);

	assert.deepEqual((secondText as any).range, { startIndex: 2, endIndex: 2 }, "range must not be cleared on message_end (would cause duplication)");
});
