# GitHub Narrator

A way for the author of a pull request to tell reviewers which parts of the diff matter, and a userscript that renders those marks on GitHub's Files tab. The marks are ordinary review comments, so they help reviewers with or without the script.

[DESIGN.md](DESIGN.md) holds the full description: the reasons, the convention, the behaviour of the script and the API recipe for posting tags from a tool.

## Install

1. Install Tampermonkey in Chrome and turn on "Allow User Scripts" for it on `chrome://extensions`, under its details page. Without that switch the script shows as enabled but never runs.
2. Open the raw file in a signed-in tab and accept the install prompt:

   ```
   https://github.com/cheeseshadow/github-narrator/raw/main/narrate.user.js
   ```

The repository is private, so Tampermonkey's automatic update check cannot fetch it. To update, open the same URL again.

## Tag a pull request

On the Files tab, select the lines of a block by dragging over the line numbers, and write a review comment whose first line is `narrate:` followed by a tag. Put the reason on the second line. Submit all tags as one review so reviewers get one notification.

```
narrate: main, 0
the parser now skips comments and blank lines
```

| Tag | Use it for | The script shows |
| --- | --- | --- |
| `main` | The change that carries the decision. | The block tinted and expanded. |
| `boilerplate` | Generated or mechanical code. | The block dimmed and collapsed under a one-line label. |
| `move` | Code moved from or to another place. Name it in the reason. | The block dimmed and collapsed under a one-line label. |
| `order` | A file that needs a rank and no tag. | Nothing. |

The number after the comma is the file's rank, lower first. Files without a rank keep GitHub's order and come after the ranked ones. Click a label to expand or collapse its block.

## Let a model tag a pull request

`narrate.py` posts tags from a JSON list and checks the line numbers against the diff; it needs only the `gh` CLI. `skills/narrate-pr/SKILL.md` is a Claude Code skill that uses it. Link the skill into your personal skills and ask Claude Code to narrate a pull request:

```bash
ln -s "$(pwd)/skills/narrate-pr" ~/.claude/skills/narrate-pr
```

By default the skill creates a pending review that only you see, and tells you how to delete it. Put your own rules about what counts as main or boilerplate, and whether tags may be published, in your project's `CLAUDE.md`.

## Check that it runs

Open the browser console on a pull request's Files tab. The script prints lines starting with `narrate:`: one when it loads, one per tag comment it finds, and one per block it renders. If the first line is missing, Tampermonkey is not running the script.

## Test pull request

[Pull request 1](https://github.com/cheeseshadow/github-narrator/pull/1) carries one tag of each kind.
