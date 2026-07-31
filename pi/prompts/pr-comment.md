---
description: Post the previous review's findings as a PENDING GitHub PR review (Low+ only, concise style)
argument-hint: "[PR URL or number; defaults to current branch]"
---
Take the code review findings you already produced in this conversation and
post them as a PENDING GitHub PR review with inline comments. Do NOT submit
the review — the user will inspect and submit it in GitHub.

Target PR: $@
(If empty, use the PR for the current branch.)

Helper scripts (already installed in `$HOME/.local/bin`):
- `gh-pr-review-hunks <pr> [--path FILE]`
    Prints commentable line ranges per file for the PR.
- `gh-pr-review-validate <pr> --comments FILE.json`
    Checks every comment points to a line inside a diff hunk.
- `gh-pr-review-create-pending <pr> --comments FILE.json [--body "..."]`
    Creates a PENDING review (no `event` set). Returns the review URL.

`<pr>` accepts: full URL, `OWNER/REPO#N`, a number (current git remote), or
omitted (current branch's PR).

Comments JSON schema:
```
{
  "body": "optional review summary",
  "comments": [
    {"path": "internal/foo.go", "line": 123, "body": "..."},
    {"path": "internal/bar.go", "line": 45,  "body": "...", "side": "LEFT"},
    {"path": "internal/baz.go", "line": 80,  "start_line": 75, "body": "..."}
  ]
}
```
`side` defaults to `RIGHT`. `line` must be inside a diff hunk — the validator
and `create-pending` will reject anything else.

What to post:

1. **Only Low severity and above.** Drop everything marked Informational.
   Do not re-review — reuse the findings already in this conversation.

2. **Comment style — match mine.** Short, informal, phrased as a check or
   question. Examples of how I write these:
   - "We should keep the check for `atlassian` right?"
   - "Does this mean we could produce data which would make a panic in recipe
     manager? Have you tested this out? If yes, we need to notify them to fix it"
   - "I don't think you need to send this error to channel, it is automatically
     considered below `selectErrorOnPrecedence(threadErr, err)`"
   Rules:
   - 1–3 sentences. No preamble.
   - No severity labels in the comment body.
   - Prefer questions ("Shouldn't this…", "…right?", "Is this intentional?").
   - Reference concrete symbols/files inline with backticks.
   - No emojis, no headings, no bullet lists.

3. **Pick valid diff lines.**
   Run `gh-pr-review-hunks <pr>` (or `--path <file>`) first. Attach every
   comment to a line inside a RIGHT/LEFT range for its file. If the code you
   want to comment on is unchanged context outside any hunk, attach to the
   nearest in-hunk line and name the symbol in the comment.

4. **Workflow:**
   a. Write the comments to `/tmp/pr-comment-<n>.json`.
   b. Run `gh-pr-review-validate <pr> --comments <file>`. Fix any issues.
   c. Run `gh-pr-review-create-pending <pr> --comments <file>`.
   d. Report the pending review URL and remind me it's still PENDING (I need
      to submit it in GitHub).

5. **Nothing to post.** If no finding in the previous review is Low+,
   say so explicitly and do not create a review.

6. **Never submit.** The scripts create with no `event`, keeping the review
   PENDING. Do not call any gh/API command that submits, approves, or requests
   changes.
