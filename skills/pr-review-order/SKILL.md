---
name: pr-review-order
description: Add a "Review order" section to a GitHub pull request description in the exact format the github-review-order browser extension reads, so reviewers can step through the changed files in a chosen order. Use whenever you write or update a PR description, or are asked to propose the order in which a PR's files should be reviewed.
---

# Review order in PR descriptions

The github-review-order extension reads a section of the PR description. It shows a panel on the PR's "Files changed" tab that steps through the listed files in that order, and it numbers them in GitHub's file tree. It only understands the format below. Anything else is ignored without an error, and the panel just doesn't appear, or the affected files are dropped from it.

## Format

```markdown
## Review order

1. `src/api/client.ts`: the new fetch wrapper everything else builds on
2. `src/api/retry.ts`: retry policy used by the client
3. `src/ui/LoadingState.tsx`: shows the client's loading and error states
4. `tests/api/client.test.ts`: covers timeouts and retries
5. `README.md`: documents the new options
```

The rules:

1. **Heading.** A real Markdown heading (`#` to `######`) whose whole text is `Review order`, in any case. Bold text (`**Review order**`) and headings with extra words ("Suggested review order") don't count.
2. **Numbered list.** The first numbered list (`1.`, `2.`, …) after the heading is the order. Text between the heading and the list is fine. A bullet list (`-`, `*`) is not read. The section ends at the next heading, so the list has to come before it.
3. **One file per item, as `path: description`.**
   - The path comes first, relative to the repository root and exactly as GitHub shows it in the diff, case included. Backticks around it are fine.
   - Separate path and description with a colon followed by a space. With `path — description` or `path - description` the item doesn't parse and the file is silently left out. With `path:description` the whole text becomes the path, which then isn't found in the PR.
   - The description is optional (`` `README.md` `` alone works). Keep it to one line: a nested list inside an item gets merged into its description.
   - Paths with spaces in them aren't supported.
4. **List every changed file, once.** Files in the PR that aren't listed get a "!" in the file tree. Listed files that aren't in the PR show "File not found in this PR". If a file is listed twice, its first position is used. Use the new path for renamed files.
5. **Don't put it inside a quote.** A section inside a `>` blockquote is treated as someone replying to it and ignored.

## Updating the order

- **Edit the description** when new commits add, remove or rename files, so the list matches the diff again.
- **Or post a new order in a comment.** The newest section in the conversation wins, but only from the PR's author or someone GitHub labels Owner, Member or Collaborator. Orders from anyone else, and from inline code comments, are ignored.
- **Reviewers see changes without reloading.** The extension re-reads the PR when GitHub's Refresh button is clicked, and when the tab gets focus again (at most every 30 seconds).

With the GitHub CLI, write the description to a file and pass it with `gh pr create --body-file <file>` or `gh pr edit <number> --body-file <file>`. Shell quoting can mangle Markdown passed inline.

## Choosing the order

Order the files so each one makes sense with what the reviewer has already seen:

- the core change first: types, data models, the function everything else calls
- then the code that uses it, from the inside out
- tests next to the code they cover, or together after it
- docs, config, generated files and lockfiles last

In the description, say what to look for in that file, not what the file is. "Retry policy, check the backoff cap" helps more than "retry.ts file".
