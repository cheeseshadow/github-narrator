# GitHub Narrator

A convention for PR authors to tell reviewers which parts of a diff matter, and a browser script that renders those tags on GitHub.

## Why

GitHub shows the files of a pull request in alphabetical order and gives every hunk the same weight. The reviewer has to find the meaningful change among moved functions, generated code and mechanical edits on their own. The author already knows which blocks are which. This project gives the author a way to say it, and the reviewer a view that acts on it.

## How it works

The author tags blocks of the diff with ordinary GitHub review comments. The first line of a tag comment is `narrate:` followed by a tag name and, optionally, a comma and a rank. Everything from the second line on is the reason.

```
narrate: boilerplate, 2
generated from the schema
```

The author selects the block by dragging over the line numbers in the Files tab, the way any multi-line review comment is made, and submits all tags as one review so reviewers get one notification.

A reviewer without the script sees normal self-review comments. A reviewer with the script sees the tag comments hidden and the tagged blocks rendered according to their tag.

Because tags are review comments, GitHub anchors them to the commit and marks them outdated when the author changes those lines. Any script with API access can also post tags, so tagging can later be automated.

## Tags

| Tag | Meaning | Rendering |
| --- | --- | --- |
| `main` | The block that carries the decision of the PR. | Tinted in the accent colour with an accent bar, expanded. |
| `boilerplate` | Generated or mechanical code: migrations, lockfiles, snapshots, fields added to a DTO. | Grayed out, collapsed with the reason on the header. |
| `move` | Code that exists elsewhere unchanged or near-unchanged. The reason names the origin. | Grayed out, collapsed with the reason on the header. |
| `order` | Carries only a rank. | Nothing. The comment is hidden. |

A comment whose first line does not parse as `narrate: <tag>` or `narrate: <tag>, <rank>` is a normal comment and the script leaves it alone.

## File order

A rank is a number after the tag, lower first. A file's rank is the lowest rank among its tag comments. The script sorts the files on the Files tab by rank; files without a rank keep GitHub's order and come after the ranked ones. The sidebar file tree keeps GitHub's order.

## Userscript

`narrate.user.js` is a Tampermonkey script for the Files tab of GitHub's current pull request view (the URL ends in `/changes`). Install Tampermonkey, open the file in the browser and accept the install prompt.

For every tag comment the script hides the comment thread, unless someone replied to it, and renders the tagged rows. Rows tagged `main` get an accent bar on the left. Rows tagged `boilerplate` or `move` are dimmed and collapsed under a one-line label with the tag, the reason and the line count. Clicking the label expands or collapses the rows.

### Which rows a tag covers

GitHub shows the line range of every review comment in a heading above the thread, such as "Comment on lines R13 to R14". The script reads that heading, so a tag covers exactly the lines the author selected. If the heading is missing, the script falls back to the whole hunk that contains the comment, the block between two `@@` headers.

### Limits

The Conversation tab still shows tag comments as normal comments. Outdated tag comments are not shown on the Files tab, so their tags disappear until the author re-tags.

When two tags start on the same row, the first one rendered keeps the block and the others only hide their comment.

## Status

Convention and a first userscript, tested by hand on the current GitHub view.
