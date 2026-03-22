# CommitSense

**CommitSense** brings Git history into your AI workflow—so your editor doesn’t just understand code, it understands *why it exists*.

Modern AI tools can read your code, but they lack context about past decisions, bug fixes, and evolution. CommitSense bridges that gap by turning Git history into AI-readable context directly inside VS Code.

---

## Why CommitSense?

AI assistants struggle with questions like:

* *Why was this code written this way?*
* *What broke this function before?*
* *Is this logic safe to modify?*

### The problem

* Git tools show history, but **only for humans**
* AI tools don’t automatically use commit history
* Developers must manually copy-paste context into chat
* Raw Git logs are too noisy for AI context windows

### The solution

CommitSense transforms Git history into **structured, relevant, AI-friendly context**—so your assistant can give smarter, more accurate answers.

---

## Features

### AI-Aware Git Context Injection

* Inserts a structured comment block with:

  * recent commits
  * authors
  * optional diffs
* Optimized specifically for AI tools like Copilot

---

### Copilot Chat Integration (`@commitsense`)

* `/history` → View commit history in chat
* `/blame` → Explain why a line was changed
* `/suggest` → Analyze file with full history context

---

### Inline Blame

* Shows author, date, and commit message inline
* Auto-clears after 30 seconds for a clean UI

---

### CodeLens Insights

* Displays:

  * latest commit
  * total commit count
* Clickable for quick navigation

---

### Hover Tooltips

* Hover over any line to see:

  * commit hash
  * author
  * date
  * message (formatted in Markdown)

---

### Status Bar Integration

* Shows latest commit info for the active file
* Click to open commit history picker

---

### Commit History Picker

* QuickPick UI with:

  * commit hash
  * message
  * author
  * date
  * email

---

## Extension Settings

CommitSense provides configurable options:

* `commitsense.maxCommits`
  Number of commits to include in context

* `commitsense.includeDiffs`
  Include diff summaries in injected context

* `commitsense.contextPosition`
  কোথ to inject context (`top` or `cursor`)

* `commitsense.enableCodeLens`
  Enable/disable CodeLens annotations

* `commitsense.enableHover`
  Enable/disable hover blame tooltips

---

## Requirements

* A Git repository
* VS Code with Git enabled
* (Optional) GitLens for enhanced integration

---

## Known Issues

* Large commit histories may exceed AI context limits
* Injecting too much diff data can reduce AI response quality
* Performance may vary on very large repositories

---

## Release Notes

### 1.0.0

* Initial release
* Git context injection
* Copilot chat participant
* Inline blame, hover, CodeLens, status bar

---

## Final Thought

CommitSense isn’t just another Git tool.

It’s a bridge between **version control and AI reasoning**—helping your editor understand not just *what your code does*, but *why it exists*.

---

**Enjoy using CommitSense**
