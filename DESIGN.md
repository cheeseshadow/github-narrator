# GitHub Narrator: design

This file is the current understanding of the project: what it is, why it exists, the convention it defines and how the script must behave. The README holds the short usage instructions. When the two disagree, this file is right and the README must be fixed.

## What it is

GitHub Narrator is a convention plus a browser userscript. The convention lets the author of a pull request, or a tool acting for a reviewer, mark blocks of the diff with a tag: this block is the main change, this block is boilerplate, this block was moved. The userscript reads those marks on GitHub's Files tab and renders the diff accordingly: the main change stands out, the rest is dimmed or collapsed, and the files appear in the order the author chose.

## Why

GitHub shows the files of a pull request in alphabetical order and gives every hunk the same weight. A reviewer has to find the meaningful change among moved functions, generated code and mechanical edits on their own. The author already knows which blocks are which, and so does a model that has read the diff. The project gives them a way to say it, and gives the reviewer a view that acts on it.

The marks are ordinary GitHub review comments. This is the main design decision, and it holds for these reasons:

- A reviewer without the script still gets a useful self-review comment on each block.
- GitHub anchors a review comment to a commit and marks it outdated when the lines change, so stale marks disappear on their own.
- Anyone with write access can add, edit or delete a mark with GitHub's own UI.
- Anything that can call the GitHub API can post marks, so a script or a model can tag a pull request without any change to the userscript.
- A pending review, one created without submitting, is visible only to its author. A reviewer can have a model tag someone else's pull request for their own eyes and delete the draft afterwards.

## The convention

A tag comment is a review comment whose first line is exactly:

```
narrate: <tag>
```

or, with a rank:

```
narrate: <tag>, <rank>
```

Everything from the second line on is the reason. The script shows the first non-empty line of the reason on the block's label. GitHub renders a single newline in a comment as a line break, so a reader without the script sees the tag on its own line and the reason under it.

```
narrate: boilerplate, 2
generated from the schema, nothing to review
```

The comment must be anchored to the lines it describes. For a block, the author drags over the line numbers in the Files tab, the way any multi-line review comment is made. A comment can be on the old side of the diff, for deleted lines, or on the new side.

A comment whose first line does not match the pattern is a normal comment and the script leaves it alone. The tag name is case-insensitive. The rank is a non-negative integer.

### Tags

| Tag | Meaning | Rendering | Collapsed by default |
| --- | --- | --- | --- |
| `main` | The block that carries the decision of the pull request. | Every row tinted in GitHub's accent colour, blended with the addition and deletion colours, with an accent bar on the left. The label is drawn in the accent colour. | No |
| `boilerplate` | Generated or mechanical code: migrations, lockfiles, snapshots, fields added to a data object. | Rows dimmed to 40% opacity. | Yes |
| `move` | Code that exists elsewhere unchanged or near-unchanged. The reason names the other place. | Rows dimmed to 40% opacity. | Yes |
| `order` | Carries only a rank. | Nothing. The comment is hidden. | Not applicable |

### Rank and file order

A rank is a number after the tag, lower first. A file's rank is the lowest rank among its tag comments. The script sorts the files on the Files tab by rank. Files without a rank keep GitHub's order and come after the ranked files. The `order` tag exists so a file can be ranked without tagging any of its lines; it can sit on any line of the file.

### Reason

The reason is free text. For `move` it must name the origin or destination, for example `from src/old.py` or `to src/new.py`. For `main` a one-line summary of the change helps the reviewer decide what to read first.

## Behaviour of the script

The script runs on every pull request page and acts on the Files tab of GitHub's current React-based view, whose URL ends in `/changes`.

For every review thread whose first comment is a tag comment:

- The thread is hidden, together with the container GitHub draws around it, unless someone replied to it. A thread with replies stays visible so the discussion is not lost.
- The rows the comment covers get the tag's rendering. The covered rows are exactly the lines in the heading GitHub shows above the thread, "Comment on lines R13 to R14" or "Comment on line L22". If that heading is missing, the script falls back to the whole hunk that contains the comment, the block between two `@@` headers.
- A label row is inserted before the first covered row. It shows the tag, the first line of the reason and the number of rows. Clicking the label collapses or expands the rows. Blocks tagged `boilerplate` or `move` start collapsed.
- When two tags start on the same row, the first one rendered keeps the block and the later ones only hide their comment.

Files are reordered by rank as described above. The sidebar file tree keeps GitHub's order.

Pending review comments, the ones in a draft review that only its author sees, use the same markup as submitted ones and are treated the same way.

### Surviving GitHub's re-renders

GitHub's page is a React application that re-creates rows, threads and their containers when the user expands context, collapses a file, focuses a thread or scrolls on large pull requests. The script must keep working through all of these, so it follows three rules:

- It never marks a thread as done. On every DOM change, after a short delay, it walks every thread, checks that its label row and its covered rows are still in the document, and re-renders the ones that are not. The collapsed state is carried over.
- Every mark it puts on an element GitHub owns is a data attribute, never a class. React rewrites an element's whole class list whenever the classes it manages change, and the markers container gets a new class when a thread is focused. React leaves attributes it does not know about alone. The attributes are `data-narrate="main"` or `"dim"` and `data-narrate-collapsed` on rows, and `data-narrate-thread-hidden` on the thread wrapper and its container.
- A file's rank is remembered for the rest of the page's life, keyed by pull request and file, because collapsing a file removes its rows and threads from the DOM and the file must keep its place.

## Tooling for posting tags

The repository ships the mechanics for posting tags and nothing about policy. What counts as the main change in a given codebase, and whether a tool may publish tags or must leave them as a draft, belongs to each organization or person, in their own instructions.

`narrate.py` is a Python script that needs only the `gh` CLI. It has four commands:

- `diff OWNER/REPO NUMBER` prints the diff with the old-side number `Lnn` and the new-side number `Rnn` in front of every line, so a tag can name its lines without counting inside hunks.
- `post OWNER/REPO NUMBER TAGS.json [--submit]` creates one review from a list of tags, each a path, side, start and end line, tag, optional rank and reason. It checks every line against the diff and refuses the whole review if one is wrong. Without `--submit` the review is pending and only the caller sees it.
- `drafts OWNER/REPO NUMBER` lists the caller's pending reviews with their tag and non-tag comment counts.
- `delete OWNER/REPO NUMBER REVIEW_ID` deletes a pending review.

`skills/narrate-pr/SKILL.md` is a Claude Code skill that walks a model through those commands: check for an existing draft, read the diff, decide the tags, post them as a draft unless told to publish, report the review id and the delete command. It carries defaults for the judgement calls and says that the user's own instructions override them. Install it by linking the directory into `~/.claude/skills/`.

## Posting tags through the API

A review with tag comments is one call. This creates a submitted review that everyone sees:

```
POST /repos/{owner}/{repo}/pulls/{number}/reviews
{
  "event": "COMMENT",
  "body": "",
  "comments": [
    {"path": "src/parser.py", "side": "RIGHT", "start_side": "RIGHT", "start_line": 13, "line": 14,
     "body": "narrate: main, 0\nthe parser now skips comments and blank lines"},
    {"path": "src/old.py", "side": "LEFT", "start_side": "LEFT", "start_line": 22, "line": 23,
     "body": "narrate: move\nto src/new.py"}
  ]
}
```

The same call without `event` creates a pending review that only the caller sees. `DELETE /repos/{owner}/{repo}/pulls/{number}/reviews/{id}` removes it. A tool that creates pending reviews must delete its own when asked and must not create one when the user already has a pending review with their own comments, because submitting a pending review publishes everything in it.

`start_line` is omitted for a single-line comment. Line numbers are those of the side named in `side`: new-file numbers for `RIGHT`, old-file numbers for `LEFT`. Only lines that appear in the diff can be commented on.

Whose account posts matters. Tags posted with a person's token look like that person's comments, which is fine on their own pull requests and misleading on other people's. A tool tagging other people's work should use a bot account or a pending review.

## Known limits and open work

- The Conversation tab shows tag comments as normal comments. Not a priority.
- Outdated tag comments are hidden by GitHub on the Files tab, so their tags disappear until the author re-tags.
- A reply to a tag comment keeps the thread visible, but the row holding it may be inside a collapsed block. Tracked in issue 2.
- On large pull requests GitHub virtualizes the diff list and may undo the reordering. Tracked in issue 3. Tags are unaffected.
- The sidebar file tree is not reordered.
- The script is a Tampermonkey userscript. It becomes a browser extension when distribution to more than a few people needs it; the code needs no change for that beyond the manifest.

## Test pull request

Pull request 1 in this repository carries one tag of each kind on a small Python change and is the manual test for the script: a two-line `main` block, a `move` on deleted lines and on their new home, a 25-line `boilerplate` file, and ranks that reverse GitHub's alphabetical order.
