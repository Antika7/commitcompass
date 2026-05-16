# Contributing to CommitCompass

Thank you for your interest in contributing to CommitCompass! This document covers everything you need to get started.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [Project Structure](#project-structure)
- [Making Changes](#making-changes)
- [Testing](#testing)
- [Submitting a Pull Request](#submitting-a-pull-request)
- [Reporting Bugs](#reporting-bugs)
- [Suggesting Features](#suggesting-features)
- [Style Guide](#style-guide)

---

## Code of Conduct

Be respectful and constructive. We follow the [Contributor Covenant](https://www.contributor-covenant.org/version/2/1/code_of_conduct/) — harassment, discrimination, or hostile behavior will not be tolerated.

---

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) v18 or later
- [npm](https://www.npmjs.com/) v9 or later
- [VS Code](https://code.visualstudio.com/) v1.110.0 or later
- Git

### Fork and Clone

```bash
# Fork the repo on GitHub, then:
git clone https://github.com/<your-username>/commitsense.git
cd commitsense
npm install
```

---

## Development Setup

### Running the Extension Locally

1. Open the project in VS Code.
2. Press `F5` to launch the **Extension Development Host** — a new VS Code window opens with CommitCompass loaded.
3. Open any Git repository in the Extension Development Host to test features.

### Useful Commands

| Command | Description |
|---|---|
| `npm run lint` | Run ESLint |
| `npm run pretest` | Lint + compile checks before tests |
| `npm test` | Run the test suite |

### Debugging

Use the `Run Extension` launch config (`.vscode/launch.json`). Breakpoints set in `extension.js` will be hit in the Extension Development Host.

---

## Project Structure

```
commitsense/
├── extension.js          # All extension logic — activation, commands, providers
├── package.json          # Extension manifest: commands, settings, activation events
├── test/
│   └── extension.test.js # Test suite
├── images/               # Extension icons and assets
├── .vscode/
│   ├── launch.json       # Debug configuration
│   └── extensions.json   # Recommended VS Code extensions for contributors
└── eslint.config.mjs     # Linting rules
```

The entire extension lives in `extension.js`. Key areas:

- **`activate()`** — entry point; registers all commands, providers, and event listeners.
- **Git data layer** — three-tier fallback: VS Code git API → GitLens API → shell `git` commands.
- **Copilot Chat participant** — `@commitcompass` with `/history`, `/blame`, and `/suggest` slash commands.
- **LM Tools** — `commitcompass_getFileHistory` and `commitcompass_getLineBlame` for agent use.
- **Providers** — `CodeLensProvider`, hover provider, inline blame decorator, status bar.

---

## Making Changes

### Branching

Branch off `main` using a descriptive name:

```
feat/add-codelens-option
fix/blame-fallback-null-crash
docs/update-readme-settings
```

Prefix with `feat/`, `fix/`, `docs/`, `refactor/`, or `test/`.

### Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add per-file blame cache to reduce git shell calls
fix: handle undefined repository in getFileHistory
docs: document includeDiff setting behaviour
test: add coverage for three-tier git fallback
```

Keep the subject line under 72 characters. Add a body when the *why* is non-obvious.

---

## Testing

Tests live in `test/extension.test.js` and run inside a real VS Code instance via `@vscode/test-cli`.

```bash
npm test
```

When adding a feature or fixing a bug, add a corresponding test. The extension relies on the VS Code API and shell git commands — prefer integration-style tests that exercise real code paths over heavy mocking.

---

## Submitting a Pull Request

1. Ensure `npm run lint` and `npm test` pass locally.
2. Push your branch and open a PR against `main`.
3. Fill in the PR description:
   - **What** changed and **why**.
   - Steps to manually verify the change.
   - Screenshots or recordings for any UI changes.
4. Keep PRs focused — one feature or fix per PR.
5. A maintainer will review and may request changes before merging.

---

## Reporting Bugs

Open a [GitHub Issue](../../issues/new) and include:

- VS Code version (`Help → About`).
- CommitCompass version.
- Whether GitLens is installed.
- Steps to reproduce.
- Expected vs. actual behaviour.
- Any relevant output from the **Output** panel (`View → Output → CommitCompass`).

---

## Suggesting Features

Open a [GitHub Issue](../../issues/new) with the `enhancement` label. Describe:

- The problem you want to solve.
- Your proposed solution.
- Any alternatives you considered.

For large or architectural changes, open an issue for discussion *before* writing code.

---

## Style Guide

- **Language**: JavaScript (ES2022). No TypeScript for now.
- **Linting**: ESLint rules defined in `eslint.config.mjs`. Run `npm run lint` before committing — the CI will fail if there are lint errors.
- **Formatting**: 4-space indentation, single quotes, semicolons — match the existing code style.
- **Comments**: Only where the *why* is non-obvious. Don't narrate what the code clearly does.
- **No new runtime dependencies** without prior discussion in an issue.
