---
name: narrate-pr
description: Tag the blocks of a GitHub pull request with GitHub Narrator review comments (main, boilerplate, move, order with ranks) so a reviewer sees the meaningful change first. Use when asked to narrate, tag, annotate or pre-review a pull request for GitHub Narrator.
---

# Narrate a pull request

This skill posts GitHub Narrator tags on a pull request. The convention and the meaning of each tag are in `DESIGN.md` at the root of the GitHub Narrator checkout; this file is at `skills/narrate-pr/SKILL.md` inside that checkout, and the helper script is `narrate.py` at its root. Read `DESIGN.md` once before the first use.

This skill covers the mechanics only. What counts as the main change, what counts as boilerplate, and whether tags may be published or must stay a draft are decided by the user's own instructions, in their project's `CLAUDE.md` or in the request. If they say nothing, follow the defaults below.

## Steps

1. Identify the pull request as `OWNER/REPO` and a number. A URL contains both.
2. Run `narrate.py drafts OWNER/REPO NUMBER`. If a pending review with non-tag comments exists, stop and ask the user, because submitting that review later would publish everything in it. If a pending review with only tag comments exists, ask whether to replace it; replace by deleting it with `narrate.py delete` and continuing.
3. Run `narrate.py diff OWNER/REPO NUMBER`. Every line is prefixed with its old-side number `Lnn`, its new-side number `Rnn`, or both. Read the whole diff before tagging anything.
4. Decide the tags. Each tag names a path, a side, a start line, an end line, a tag name, and optionally a rank and a one-line reason:
   - Use side `R` with `Rnn` numbers for added lines and for context around them. Use side `L` with `Lnn` numbers for deleted lines.
   - A block must be a contiguous run of lines that all exist on that side of the diff. Context lines count as new-side lines.
   - Give every file that matters a rank through one of its tags, lowest first. A file that needs a rank and no block tag gets an `order` tag on any of its lines.
   - Write the reason as one line. For `move`, name the other location.
5. Write the tags to a JSON file in the scratch directory as a list of objects: `{"path", "side", "start", "end", "tag", "rank", "reason"}`.
6. Run `narrate.py post OWNER/REPO NUMBER TAGS.json`. Without `--submit` this creates a pending review that only the user sees. Add `--submit` only when the user asked to publish, which is normal on their own pull requests. The script validates every line against the diff and refuses the whole review if one is wrong; fix the tag and run it again.
7. Report the review id, the number of tags, and the command that deletes the draft: `narrate.py delete OWNER/REPO NUMBER REVIEW_ID`.

## Defaults when the user gives no guidance

- Create a pending review, never a submitted one.
- Tag `main` sparingly: the one or two blocks a reviewer must read to judge the change. Everything else is either untagged or `boilerplate` or `move`.
- Tag as `boilerplate` only what a reviewer gains nothing from reading line by line: generated files, lockfiles, snapshots, repeated field declarations.
- Tag as `move` only code that is the same or nearly the same as code deleted elsewhere in the diff, and say where it came from or went.
- Leave ordinary changes untagged. An untagged block is shown as GitHub shows it.
- Rank files in the order a reviewer should read them: the main change first, its direct supporting changes next, boilerplate last.
