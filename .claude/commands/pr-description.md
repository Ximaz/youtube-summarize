---
description: Generate a PR description for the current branch using the project template
allowed-tools: Bash(git log:*), Bash(git diff:*), Bash(git status:*), Bash(git rev-parse:*), Bash(git branch:*), Write
argument-hint: [optional extra context]
---

You are generating a pull request description for the work on the current branch. Use both the conversation context (if there is recent feature work above) AND fresh git context.

## 1. Gather context

Run these in parallel:

- `git rev-parse --abbrev-ref HEAD` — current branch
- `git log main..HEAD --pretty=format:"%h %s" --no-merges` — commits since branching from `main`
- `git diff --stat main...HEAD` — file change overview
- `git diff main...HEAD` — full diff (only re-read it if needed; the stat is usually enough together with the commits)

If `main..HEAD` returns nothing useful (e.g. branch already merged or based on a different base), fall back to `origin/main..HEAD`, then `HEAD~10..HEAD`.

Extra user-provided context (may be empty): $ARGUMENTS

## 2. Fill the template

Render this template EXACTLY, replacing the `>` blockquote placeholders with real content. Keep the `**bold**` headers, keep the checklist items unchecked (the human reviews them):

```
**Description**

> Describe the purpose of this PR along with any background information and the impacts of the proposed change.

**References**

> Include any links supporting this change.
>
> If there are no references, simply delete this section.

**Checklist**

- [ ] My code follows the style guidelines of this project
- [ ] I have performed a self-review of my own code
- [ ] I have commented my code, particularly in hard-to-understand areas
- [ ] My changes generate no new warnings
```

Rules for filling it in:

- **Description**: 2–5 sentences. Explain the _purpose_ of the change, the _background_ (the problem it solves), and the _impact_ (user-visible effects, behavior changes, migration notes). Write in plain prose, not bullet-points-of-commits.
- **References**: include issue/ticket links only if they appear in commit messages, branch name, or the user-provided context above. If there are none, delete the entire References section (heading + blockquote) per the template's own instruction.
- **Checklist**: leave every item unchecked. These are reviewer attestations, not yours.
- Do NOT echo file lists, commit hashes, or diffs into the description.
- **Style**: instead of having a whole text chunk, you may use new lines to make it more readable

## 3. Output handling

Before printing, check the rendered markdown for **dangling backtick syntax**:

- Count occurrences of triple-backticks (` ``` `). If the count is odd → unbalanced.
- Count occurrences of single backticks (`` ` ``) that are NOT inside a triple-backtick block. If odd → unbalanced.

Then:

- **If balanced** (safe to print in the terminal): print the rendered markdown directly in your reply, inside one outer fenced block so it renders as a copy-pasteable artifact. Nothing else — no preamble, no trailing commentary.
- **If unbalanced** (would break terminal markdown): write the rendered markdown to `/tmp/pr-description-<branch-slug>.md` (where `<branch-slug>` is the current branch name with `/` replaced by `-`). Then print only one line: the absolute path. Do not print the content.

That's it — one of those two outputs, nothing more.
