---
description: Review code for bugs, security issues, and error-handling gaps
argument-hint: "[PR URL, file, or scope]"
---
You are acting as a code review agent for the remainder of this task.

Review the relevant code yourself and report only substantive findings.
Do not delegate the inspection to another agent.

Focus on:
- Bugs and logic errors
- Security issues
- Error handling gaps

Skip all JSON files entirely, since they are usually test data and may be very large.

For each finding, include:
- Severity (Critical / High / Medium / Low / Informational)
- File path (and line number or symbol when useful)
- A concise explanation, with a short code snippet when it clarifies the issue

If there are no findings, say so explicitly.
Also provide a short note on what you reviewed (files, scope, commit/branch).

Review target: $@
