// CommitCompass — Injects Git history as AI-readable context into the VS Code editor.
// Supports GitLens API, vscode.git API, and raw git shell fallback.

'use strict';

const vscode = require('vscode');
const { execSync } = require('child_process');
const path = require('path');

// ─── GitLens / vscode.git API helpers ───────────────────────────────────────

/**
 * Returns the GitLens public API (v3) if the extension is installed & active.
 * @returns {Promise<object|null>}
 */
async function getGitLensAPI() {
	const ext = vscode.extensions.getExtension('eamodio.gitlens');
	if (!ext) return null;
	if (!ext.isActive) {
		try { await ext.activate(); } catch { return null; }
	}
	return ext.exports ?? null;
}

/**
 * Returns the built-in vscode.git extension API (version 1).
 * @returns {Promise<object|null>}
 */
async function getVscodeGitAPI() {
	const ext = vscode.extensions.getExtension('vscode.git');
	if (!ext) return null;
	if (!ext.isActive) {
		try { await ext.activate(); } catch { return null; }
	}
	return ext.exports?.getAPI(1) ?? null;
}

// ─── Git data fetching ───────────────────────────────────────────────────────

/**
 * Fetches recent commits for `fileUri` using vscode.git API, then git shell fallback.
 * @param {vscode.Uri} fileUri
 * @param {number} maxCommits
 * @returns {Promise<Array<{hash:string, message:string, author:string, date:string, email:string}>>}
 */
async function getCommitsForFile(fileUri, maxCommits = 10) {
	// 1. Try vscode.git API
	try {
		const gitAPI = await getVscodeGitAPI();
		if (gitAPI) {
			const repo = gitAPI.getRepository(fileUri);
			if (repo) {
				const log = await repo.log({ maxEntries: maxCommits, path: fileUri.fsPath });
				if (log?.length) {
					return log.map(c => ({
						hash: (c.hash ?? '').slice(0, 7),
						message: (c.message ?? '').split('\n')[0].trim(),
						author: c.authorName ?? c.author?.name ?? 'Unknown',
						date: c.authorDate
							? new Date(c.authorDate).toLocaleDateString()
							: (c.commitDate ? new Date(c.commitDate).toLocaleDateString() : '?'),
						email: c.authorEmail ?? '',
					}));
				}
			}
		}
	} catch { /* fall through */ }

	// 2. Shell fallback: git log
	return shellGitLog(fileUri.fsPath, maxCommits);
}

/**
 * Runs `git log` via shell and parses the output.
 * @param {string} filePath
 * @param {number} maxCommits
 * @returns {Array<{hash:string,message:string,author:string,date:string,email:string}>}
 */
function shellGitLog(filePath, maxCommits) {
	try {
		const cwd = path.dirname(filePath);
		const raw = execSync(
			`git log --follow --pretty=format:"%h\x1F%an\x1F%ae\x1F%ad\x1F%s" --date=short -n ${maxCommits} -- "${filePath}"`,
			{ cwd, encoding: 'utf8', timeout: 8000 }
		);
		return raw
			.trim()
			.split('\n')
			.filter(Boolean)
			.map(line => {
				const [hash, author, email, date, ...rest] = line.split('\x1F');
				return { hash: hash ?? '', message: rest.join('\x1F').trim(), author: author ?? '', date: date ?? '', email: email ?? '' };
			});
	} catch {
		return [];
	}
}

/**
 * Parses a porcelain `git blame` block into a simple blame record.
 * @param {string} output
 * @returns {{hash:string, author:string, date:string, summary:string}}
 */
function parseGitBlamePorcelain(output) {
	const lines = output.split('\n');
	const result = { hash: '', author: '', date: '', summary: '' };
	result.hash = (lines[0]?.split(' ')[0] ?? '').slice(0, 7);
	for (const line of lines) {
		if (line.startsWith('author '))       result.author  = line.slice(7).trim();
		if (line.startsWith('author-time '))  result.date    = new Date(parseInt(line.slice(12)) * 1000).toLocaleDateString();
		if (line.startsWith('summary '))      result.summary = line.slice(8).trim();
	}
	return result;
}

/**
 * Gets blame info for a specific line. Tries GitLens API, then shell.
 * @param {vscode.Uri} fileUri
 * @param {number} lineNumber  0-based
 * @returns {Promise<{hash:string,author:string,date:string,summary:string}|null>}
 */
async function getBlameForLine(fileUri, lineNumber) {
	// 1. Try GitLens API (getBlameLine was available in older public API surface)
	try {
		const glAPI = await getGitLensAPI();
		if (glAPI && typeof glAPI.getBlameLine === 'function') {
			const blame = await glAPI.getBlameLine(fileUri, lineNumber);
			if (blame) return blame;
		}
	} catch { /* fall through */ }

	// 2. Shell fallback
	try {
		const line1 = lineNumber + 1; // git blame uses 1-based lines
		const raw = execSync(
			`git blame -L ${line1},${line1} --porcelain "${fileUri.fsPath}"`,
			{ cwd: path.dirname(fileUri.fsPath), encoding: 'utf8', timeout: 8000 }
		);
		return parseGitBlamePorcelain(raw);
	} catch {
		return null;
	}
}

/**
 * Gets a condensed diff summary for recent commits of a file.
 * @param {vscode.Uri} fileUri
 * @param {number} maxCommits
 * @returns {Promise<string|null>}
 */
async function getDiffSummary(fileUri, maxCommits = 3) {
	try {
		const raw = execSync(
			`git log --follow --pretty=format:"=== %h %s ===" -p -n ${maxCommits} -- "${fileUri.fsPath}"`,
			{ cwd: path.dirname(fileUri.fsPath), encoding: 'utf8', maxBuffer: 512 * 1024, timeout: 10000 }
		);
		// Keep first 3 000 chars to avoid bloating the file
		return raw.length > 3000 ? raw.slice(0, 3000) + '\n... (diff truncated)' : raw;
	} catch {
		return null;
	}
}

// ─── Comment-block builder ───────────────────────────────────────────────────

/**
 * Returns comment delimiters appropriate for the given VS Code languageId.
 */
function getCommentStyle(languageId) {
	const block  = new Set(['javascript','javascriptreact','typescript','typescriptreact','java','c','cpp','csharp','go','swift','kotlin','rust','php','scala','dart']);
	const hash   = new Set(['python','ruby','shellscript','yaml','dockerfile','perl','r','toml','coffeescript','makefile']);
	const html   = new Set(['html','xml','svg','markdown']);

	if (block.has(languageId))  return { start: '/**',  line: ' *',  end: ' */' };
	if (hash.has(languageId))   return { start: '# ╔══ CommitCompass ══╗', line: '#', end: '# ╚══════════════════╝' };
	if (html.has(languageId))   return { start: '<!--', line: '   ', end: '-->' };
	return { start: '/**', line: ' *', end: ' */' };
}

/**
 * Builds the comment block string that will be injected into the editor.
 */
function buildContextComment(commits, filePath, languageId, includeDiff, diff) {
	const fileName = path.basename(filePath);
	const cs = getCommentStyle(languageId);
	const lines = [
		`${cs.start}`,
		`${cs.line} CommitCompass — AI Context Block`,
		`${cs.line} File   : ${fileName}`,
		`${cs.line} Generated: ${new Date().toLocaleString()}`,
		`${cs.line}`,
		`${cs.line} Recent Commit History (${commits.length} commits):`,
	];

	commits.forEach((c, i) => {
		lines.push(`${cs.line}   ${i + 1}. [${c.hash}] ${c.date} — ${c.author}`);
		lines.push(`${cs.line}      ${c.message}`);
	});

	if (includeDiff && diff) {
		lines.push(`${cs.line}`);
		lines.push(`${cs.line} Recent Changes (diff summary):`);
		diff.split('\n').slice(0, 30).forEach(l => lines.push(`${cs.line}   ${l}`));
	}

	lines.push(`${cs.line}`);
	lines.push(`${cs.line} AI Hint: Use the above history to understand intent, past refactors,`);
	lines.push(`${cs.line} patterns, and author context when generating or reviewing this file.`);
	lines.push(`${cs.end}`);

	return lines.join('\n') + '\n\n';
}

// ─── CodeLens provider ───────────────────────────────────────────────────────

class CommitCompassCodeLensProvider {
	constructor() {
		/** @type {vscode.EventEmitter<void>} */
		this._change = new vscode.EventEmitter();
		this.onDidChangeCodeLenses = this._change.event;
		this._enabled = true;
	}

	/** Toggle visibility and fire a refresh. */
	toggle() {
		this._enabled = !this._enabled;
		this._change.fire();
		return this._enabled;
	}

	/** @param {vscode.TextDocument} document */
	async provideCodeLenses(document) {
		const cfg = vscode.workspace.getConfiguration('commitcompass');
		if (!this._enabled || !cfg.get('showCodeLens', true)) return [];
		if (document.uri.scheme !== 'file') return [];

		const commits = await getCommitsForFile(document.uri, 5);
		if (!commits.length) return [];

		const range   = new vscode.Range(0, 0, 0, 0);
		const latest  = commits[0];
		const lenses  = [
			new vscode.CodeLens(range, {
				title:     `$(git-commit) [${latest.hash}] ${latest.message} — ${latest.author} (${latest.date})`,
				   command:   'commitcompass.showCommitHistory',
				arguments: [document.uri],
			}),
		];

		if (commits.length > 1) {
			lenses.push(new vscode.CodeLens(range, {
				title:     `$(history) ${commits.length} recent commits — inject as AI context`,
				   command:   'commitcompass.injectContext',
				arguments: [document.uri],
			}));
		}

		return lenses;
	}
}

// ─── Hover provider ──────────────────────────────────────────────────────────

class CommitCompassHoverProvider {
	/** @param {vscode.TextDocument} document @param {vscode.Position} position */
	async provideHover(document, position) {
		const cfg = vscode.workspace.getConfiguration('commitcompass');
		if (!cfg.get('showHover', true)) return null;
		if (document.uri.scheme !== 'file') return null;

		const blame = await getBlameForLine(document.uri, position.line);
		if (!blame?.hash) return null;

		const md = new vscode.MarkdownString(undefined, true);
		md.isTrusted = true;
		md.appendMarkdown('**CommitCompass — Blame Info**\n\n');
		md.appendMarkdown('| Field | Value |\n|---|---|\n');
		md.appendMarkdown(`| Commit | \`${blame.hash}\` |\n`);
		md.appendMarkdown(`| Author | ${escapeMarkdown(blame.author ?? 'Unknown')} |\n`);
		md.appendMarkdown(`| Date   | ${escapeMarkdown(blame.date   ?? '?')} |\n`);
		md.appendMarkdown(`| Message | ${escapeMarkdown(blame.summary ?? '—')} |\n`);
		return new vscode.Hover(md);
	}
}

/** Escapes pipe characters that would break Markdown tables. */
function escapeMarkdown(str) {
	return str.replace(/\|/g, '\\|');
}

// ─── Decoration type (for injected context lines) ────────────────────────────

let _contextDecoration = null;

function getContextDecorationType() {
	if (!_contextDecoration) {
		_contextDecoration = vscode.window.createTextEditorDecorationType({
			isWholeLine:     true,
			backgroundColor: new vscode.ThemeColor('diffEditor.insertedLineBackground'),
			borderColor:     new vscode.ThemeColor('gitDecoration.addedResourceForeground'),
			borderStyle:     'solid',
			borderWidth:     '0 0 0 3px',
			after: {
				   contentText: ' ← CommitCompass context',
				color:       new vscode.ThemeColor('editorCodeLens.foreground'),
				fontStyle:   'italic',
				margin:      '0 0 0 1em',
			},
		});
	}
	return _contextDecoration;
}

/** Tracks which file paths already have injected context. */
const injectedFiles = new Set();

// ─── Command implementations ─────────────────────────────────────────────────

/** commitcompass.injectContext */
async function cmdInjectContext(uri) {
	const editor = vscode.window.activeTextEditor;
	if (!editor) {
		vscode.window.showWarningMessage('CommitCompass: No active editor.');
		return;
	}
	const fileUri = (uri instanceof vscode.Uri) ? uri : editor.document.uri;
	const cfg = vscode.workspace.getConfiguration('commitcompass');

	await vscode.window.withProgress(
			   { location: vscode.ProgressLocation.Notification, title: 'CommitCompass: Fetching git history…', cancellable: false },
		async () => {
			const commits = await getCommitsForFile(fileUri, cfg.get('maxCommits', 10));
			if (!commits.length) {
					   vscode.window.showWarningMessage('CommitCompass: No git history found for this file.');
				return;
			}

			let diff = null;
			if (cfg.get('includeDiff', false)) {
				diff = await getDiffSummary(fileUri, 3);
			}

			const block     = buildContextComment(commits, fileUri.fsPath, editor.document.languageId, cfg.get('includeDiff', false), diff);
			const insertAt  = cfg.get('contextPosition', 'top') === 'cursor'
				? editor.selection.active
				: new vscode.Position(0, 0);

			await editor.edit(eb => eb.insert(insertAt, block));

			// Highlight the injected lines
			const lineCount = block.split('\n').length - 1;
			const ranges    = [];
			for (let i = insertAt.line; i < insertAt.line + lineCount; i++) {
				ranges.push(new vscode.Range(i, 0, i, 0));
			}
			editor.setDecorations(getContextDecorationType(), ranges);
			injectedFiles.add(fileUri.fsPath);

			const action = await vscode.window.showInformationMessage(
				   `CommitCompass: Injected ${commits.length} commits as AI context.`,
				'Clear Context'
			);
			if (action === 'Clear Context') cmdClearContext();
		}
	);
}

/** commitcompass.showCommitHistory */
async function cmdShowCommitHistory(uri) {
	const editor  = vscode.window.activeTextEditor;
	const fileUri = (uri instanceof vscode.Uri) ? uri : editor?.document.uri;
	if (!fileUri) { vscode.window.showWarningMessage('CommitCompass: No file open.'); return; }

	const cfg     = vscode.workspace.getConfiguration('commitcompass');
	const commits = await getCommitsForFile(fileUri, cfg.get('maxCommits', 20));

	if (!commits.length) {
			   vscode.window.showWarningMessage('CommitCompass: No history found for this file.');
		return;
	}

	const items = commits.map((c, i) => ({
		label:       `$(git-commit) [${c.hash}] ${c.message}`,
		description: `${c.author}  •  ${c.date}`,
		detail:      `Commit ${i + 1} of ${commits.length} — ${c.email}`,
		commit:       c,
	}));

	const selected = await vscode.window.showQuickPick(items, {
		placeHolder:        `${path.basename(fileUri.fsPath)} — ${commits.length} commits`,
		matchOnDescription: true,
		matchOnDetail:      true,
	});

	if (selected) {
		const c = selected.commit;
		const md = [
			`**[${c.hash}] ${c.message}**`, '',
			`- **Author:** ${c.author} <${c.email}>`,
			`- **Date:** ${c.date}`,
		].join('\n');
		vscode.window.showInformationMessage(md);
	}
}

/** commitcompass.clearContext */
function cmdClearContext() {
	const editor = vscode.window.activeTextEditor;
	if (!editor) return;
	editor.setDecorations(getContextDecorationType(), []);
	injectedFiles.delete(editor.document.uri.fsPath);
	vscode.window.showInformationMessage('CommitCompass: Context decorations cleared.');
}

/** commitcompass.toggleCodeLens */
function cmdToggleCodeLens(provider) {
	const enabled = provider.toggle();
	vscode.window.showInformationMessage(`CommitCompass: CodeLens ${enabled ? 'enabled' : 'disabled'}.`);
}

/** commitcompass.injectBlame — shows inline blame for each selected line */
async function cmdInjectBlame() {
	const editor = vscode.window.activeTextEditor;
	if (!editor) { vscode.window.showWarningMessage('CommitCompass: No active editor.'); return; }
	if (editor.document.uri.scheme !== 'file') return;

	const blameResults = [];
	for (const sel of editor.selections) {
		const blame = await getBlameForLine(editor.document.uri, sel.active.line);
		if (blame?.hash) blameResults.push({ line: sel.active.line, blame });
	}

	if (!blameResults.length) {
			   vscode.window.showWarningMessage('CommitCompass: No blame data available for the selected lines.');
		return;
	}

	// One decoration type per command invocation so it can be disposed after timeout
	const decType = vscode.window.createTextEditorDecorationType({
		after: {
			margin:    '0 0 0 2em',
			fontStyle: 'italic',
		},
	});

	editor.setDecorations(decType, blameResults.map(({ line, blame }) => ({
		range:           new vscode.Range(line, 0, line, 0),
		renderOptions:   {
			after: {
				contentText: ` ← ${blame.author} • ${blame.date} • "${blame.summary}"`,
				color:       new vscode.ThemeColor('editorCodeLens.foreground'),
			},
		},
	})));

	// Auto-dispose after 30 s
	setTimeout(() => decType.dispose(), 30_000);
	vscode.window.showInformationMessage('CommitCompass: Inline blame shown (auto-clears in 30 s).');
}

// ─── Status-bar item ─────────────────────────────────────────────────────────

/**
 * Updates the status bar text with the latest commit for the active file.
 * @param {vscode.StatusBarItem} item
 * @param {vscode.TextEditor|undefined} editor
 */
async function updateStatusBar(item, editor) {
	if (!editor || editor.document.uri.scheme !== 'file') {
		item.text    = '$(git-commit) CommitCompass';
		item.tooltip = 'CommitCompass: Open a file to see its latest commit';
		return;
	}
	const commits = await getCommitsForFile(editor.document.uri, 1);
	if (commits.length) {
		item.text    = `$(git-commit) ${commits[0].hash} · ${commits[0].author}`;
			   item.tooltip = `CommitCompass: ${commits[0].message} (${commits[0].date}) — click to view history`;
	} else {
		item.text    = '$(git-commit) CommitCompass';
		item.tooltip = 'CommitCompass: No git history found for this file';
	}
}

// ─── Chat Participant & LM Tools ────────────────────────────────────────────

/**
 * Formats commit array into a plain-text string suitable for LLM system prompts.
 * @param {Array} commits
 * @param {string} filePath
 * @returns {string}
 */
function buildHistoryContextString(commits, filePath) {
	if (!commits.length) return 'No git history available for this file.';
	const lines = [`File: ${path.basename(filePath)}`, ''];
	commits.forEach((c, i) => {
		lines.push(`${i + 1}. [${c.hash}] ${c.date} — ${c.author} <${c.email}>`);
		lines.push(`   ${c.message}`);
	});
	return lines.join('\n');
}

/**
 * Registers the @commitcompass Copilot Chat participant.
 * Users can invoke it with: @commitcompass <question>
 * or slash commands: @commitcompass /history, /blame, /suggest
 * @param {vscode.ExtensionContext} context
 */
function registerChatParticipant(context) {
	const handler = async (request, _chatContext, stream, token) => {
		const editor  = vscode.window.activeTextEditor;
		const fileUri = editor?.document?.uri;

		if (!fileUri || fileUri.scheme !== 'file') {
			   stream.markdown('> **CommitCompass**: Open a file in the editor, then ask your question.');
			return {};
		}

		const cfg        = vscode.workspace.getConfiguration('commitcompass');
		const commits    = await getCommitsForFile(fileUri, cfg.get('maxCommits', 10));
		const historyCtx = buildHistoryContextString(commits, fileUri.fsPath);

		// ── /history — just render the table, no LLM call needed ──────────────
		if (request.command === 'history') {
			if (!commits.length) {
				stream.markdown('No git history found for this file.');
				return {};
			}
			stream.markdown(`## Git History: \`${path.basename(fileUri.fsPath)}\`\n\n`);
			stream.markdown('| # | Hash | Date | Author | Message |\n|---|---|---|---|---|\n');
			commits.forEach((c, i) => {
				stream.markdown(`| ${i + 1} | \`${c.hash}\` | ${c.date} | ${escapeMarkdown(c.author)} | ${escapeMarkdown(c.message)} |\n`);
			});
			return {};
		}

		// ── /blame — explain the current line using blame + history ───────────
		if (request.command === 'blame') {
			const line  = editor.selection.active.line;
			const blame = await getBlameForLine(fileUri, line);
			if (!blame?.hash) {
				stream.markdown('No blame data found for the current line.');
				return {};
			}
			const systemPrompt =
				`You are a code review assistant. The user is looking at line ${line + 1} of \`${path.basename(fileUri.fsPath)}\`.\n` +
				`That line was last changed in commit \`${blame.hash}\` by ${blame.author} on ${blame.date}.\n` +
				`Commit message: "${blame.summary}"\n\n` +
				`Full file git history:\n${historyCtx}\n\n` +
				`Explain why this line was likely changed, what the commit intended, and any relevant patterns from the full history.`;

			try {
				const response = await request.model.sendRequest(
					[vscode.LanguageModelChatMessage.User(systemPrompt + (request.prompt ? `\n\nUser: ${request.prompt}` : ''))],
					{}, token
				);
				for await (const chunk of response.text) {
					if (token.isCancellationRequested) break;
					stream.markdown(chunk);
				}
			} catch (err) {
				stream.markdown(`**Error contacting model:** ${err.message}`);
			}
			return {};
		}

		// ── /suggest or free-form question — full context + user question ──────
		if (!commits.length) {
			stream.markdown('> *No git history found — answering without commit context.*\n\n');
		}

		const docText      = editor.document.getText();
		const truncatedDoc = docText.length > 6000
			? docText.slice(0, 6000) + '\n... (file truncated for context window)'
			: docText;

		const systemMsg =
			`You are an expert code assistant. You have access to the git history of the file the user is currently editing.\n\n` +
			`## File: ${path.basename(fileUri.fsPath)}\n` +
			`## Language: ${editor.document.languageId}\n\n` +
			`## Git Commit History:\n${historyCtx}\n\n` +
			`## Current File Content:\n\`\`\`${editor.document.languageId}\n${truncatedDoc}\n\`\`\`\n\n` +
			`Use the commit history to understand the file's intent, past refactors, coding patterns, and the team's conventions. ` +
			`Answer the following:\n\n${request.prompt || 'Summarise this file and its recent changes.'}`;

		try {
			const response = await request.model.sendRequest(
				[vscode.LanguageModelChatMessage.User(systemMsg)],
				{}, token
			);
			for await (const chunk of response.text) {
				if (token.isCancellationRequested) break;
				stream.markdown(chunk);
			}
		} catch (err) {
			stream.markdown(`**Error contacting model:** ${err.message}`);
		}
		return {};
	};

	const participant      = vscode.chat.createChatParticipant('commitcompass', handler);
	participant.iconPath   = new vscode.ThemeIcon('git-commit');
	context.subscriptions.push(participant);
}

/**
 * Registers LM Tools so Copilot agent mode can call them automatically
 * without any explicit user action.
 * @param {vscode.ExtensionContext} context
 */
function registerLMTools(context) {
	// Tool 1: fetch commit history for a file
	       context.subscriptions.push(
		       vscode.lm.registerTool('commitcompass_getFileHistory', {
			async invoke(options) {
				const { filePath, maxCommits = 10 } = options.input;
				const uri     = vscode.Uri.file(filePath);
				const commits = await getCommitsForFile(uri, maxCommits);
				const text    = buildHistoryContextString(commits, filePath);
				return new vscode.LanguageModelToolResult([
					new vscode.LanguageModelTextPart(text)
				]);
			}
		})
	);

	// Tool 2: get blame for a specific line
	       context.subscriptions.push(
		       vscode.lm.registerTool('commitcompass_getLineBlame', {
			async invoke(options) {
				const { filePath, line } = options.input;
				const uri   = vscode.Uri.file(filePath);
				const blame = await getBlameForLine(uri, line);
				if (!blame?.hash) {
					return new vscode.LanguageModelToolResult([
						new vscode.LanguageModelTextPart('No blame data available for that line.')
					]);
				}
				const text = [
					`Commit : ${blame.hash}`,
					`Author : ${blame.author}`,
					`Date   : ${blame.date}`,
					`Message: ${blame.summary}`,
				].join('\n');
				return new vscode.LanguageModelToolResult([
					new vscode.LanguageModelTextPart(text)
				]);
			}
		})
	);
}

// ─── Activate / Deactivate ───────────────────────────────────────────────────

/** @param {vscode.ExtensionContext} context */
function activate(context) {
	console.log('CommitCompass is now active!');

	const codeLensProvider = new CommitCompassCodeLensProvider();
	const hoverProvider    = new CommitCompassHoverProvider();

	// CodeLens — all files on disk
	       context.subscriptions.push(
		       vscode.languages.registerCodeLensProvider({ scheme: 'file' }, codeLensProvider)
	       );

	// Hover — blame tooltips
	       context.subscriptions.push(
		       vscode.languages.registerHoverProvider({ scheme: 'file' }, hoverProvider)
	       );

	// Commands
	       context.subscriptions.push(
		       vscode.commands.registerCommand('commitcompass.injectContext',      cmdInjectContext),
		       vscode.commands.registerCommand('commitcompass.showCommitHistory',  cmdShowCommitHistory),
		       vscode.commands.registerCommand('commitcompass.clearContext',       cmdClearContext),
		       vscode.commands.registerCommand('commitcompass.toggleCodeLens',     () => cmdToggleCodeLens(codeLensProvider)),
		       vscode.commands.registerCommand('commitcompass.injectBlame',        cmdInjectBlame),
	       );

	// Status bar
	const statusBar       = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
	statusBar.command     = 'commitcompass.showCommitHistory';
	statusBar.show();
	context.subscriptions.push(statusBar);
	updateStatusBar(statusBar, vscode.window.activeTextEditor);

	// Chat Participant (@commitsense in Copilot Chat)
	registerChatParticipant(context);

	// LM Tools (callable by Copilot agent mode automatically)
	registerLMTools(context);

	// React to editor changes
	       context.subscriptions.push(
		       vscode.window.onDidChangeActiveTextEditor(async editor => {
			       updateStatusBar(statusBar, editor);

			       // Auto-inject if configured and not already done for this file
			       if (!editor) return;
			       const cfg = vscode.workspace.getConfiguration('commitcompass');
			if (!cfg.get('autoInject', false)) return;
			if (injectedFiles.has(editor.document.uri.fsPath)) return;
			// Small delay so the editor settles before we modify it
			setTimeout(() => cmdInjectContext(editor.document.uri), 600);
		})
	);
}

function deactivate() {}

module.exports = { activate, deactivate };

