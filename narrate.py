#!/usr/bin/env python3
"""Post GitHub Narrator tags on a pull request.

Commands:
  narrate.py diff OWNER/REPO NUMBER
      Print the pull request diff with the side and line number of every line,
      so tags can name lines without counting inside hunks.
  narrate.py post OWNER/REPO NUMBER TAGS.json [--submit]
      Create a review with one comment per tag. Without --submit the review is
      pending and visible only to the caller. Prints the review id.
  narrate.py drafts OWNER/REPO NUMBER
      List the caller's pending reviews with their tag and non-tag comment counts.
  narrate.py delete OWNER/REPO NUMBER REVIEW_ID
      Delete a pending review.

TAGS.json is a list of objects:
  {"path": "src/a.py", "side": "R", "start": 13, "end": 14,
   "tag": "main", "rank": 0, "reason": "one line of text"}
"side" is "R" for new-file lines and "L" for deleted lines. "end" defaults to
"start". "rank" and "reason" are optional. Lines must appear in the diff.

Authentication goes through the gh CLI.
"""

import json
import re
import subprocess
import sys
import tempfile

TAGS = {"main", "boilerplate", "move", "order"}
HUNK = re.compile(r"^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@")


def gh(*args, stdin=None):
    result = subprocess.run(["gh", *args], input=stdin, capture_output=True, text=True)
    if result.returncode != 0:
        sys.exit(f"gh {' '.join(args)} failed:\n{result.stderr.strip()}")
    return result.stdout


def parse_diff(text):
    """Return [(path, [(side_or_None, old, new, line)])] in diff order.

    side is "L" for a deleted line, "R" for an added line, None for context.
    """
    files = []
    path = None
    lines = None
    old = new = 0
    for raw in text.splitlines():
        if raw.startswith("diff --git "):
            path, lines = None, None
            continue
        if raw.startswith("+++ "):
            target = raw[4:]
            path = None if target == "/dev/null" else target[2:] if target.startswith("b/") else target
            lines = []
            files.append((path, lines))
            continue
        if raw.startswith("--- ") and lines is None:
            continue
        if lines is None:
            continue
        m = HUNK.match(raw)
        if m:
            old, new = int(m.group(1)), int(m.group(3))
            lines.append((None, None, None, raw))
            continue
        if raw.startswith("\\"):
            continue
        if raw.startswith("-"):
            lines.append(("L", old, None, raw))
            old += 1
        elif raw.startswith("+"):
            lines.append(("R", None, new, raw))
            new += 1
        else:
            lines.append((None, old, new, raw))
            old += 1
            new += 1
    return [(p, l) for p, l in files if p is not None]


def fetch_diff(repo, number):
    return parse_diff(gh("pr", "diff", "--repo", repo, str(number)))


def cmd_diff(repo, number):
    for path, lines in fetch_diff(repo, number):
        print(f"=== {path}")
        for side, old, new, raw in lines:
            if old is None and new is None:
                print(f"{'':>12} {raw}")
            else:
                left = f"L{old}" if old is not None else ""
                right = f"R{new}" if new is not None else ""
                print(f"{left:>5} {right:>6} {raw}")


def available_lines(files):
    out = {}
    for path, lines in files:
        on_side = out.setdefault(path, {"L": set(), "R": set()})
        for side, old, new, raw in lines:
            if old is not None:
                on_side["L"].add(old)
            if new is not None:
                on_side["R"].add(new)
    return out


def build_comment(tag, lines):
    path, side, start = tag["path"], tag["side"].upper(), int(tag["start"])
    end = int(tag.get("end", start))
    name = tag["tag"].lower()
    if name not in TAGS:
        sys.exit(f"unknown tag {tag['tag']!r} on {path}")
    if side not in ("L", "R"):
        sys.exit(f"side must be L or R on {path}:{start}")
    if path not in lines:
        sys.exit(f"{path} is not in the diff")
    missing = [n for n in range(start, end + 1) if n not in lines[path][side]]
    if missing:
        sys.exit(f"{path}: lines {missing} are not {'deleted' if side == 'L' else 'new'} lines in the diff")
    first = f"narrate: {name}" + (f", {int(tag['rank'])}" if tag.get("rank") is not None else "")
    body = first + (f"\n{tag['reason'].strip()}" if tag.get("reason") else "")
    api_side = "LEFT" if side == "L" else "RIGHT"
    comment = {"path": path, "side": api_side, "line": end, "body": body}
    if end != start:
        comment.update({"start_side": api_side, "start_line": start})
    return comment


def cmd_post(repo, number, tags_path, submit):
    with open(tags_path) as f:
        tags = json.load(f)
    if not isinstance(tags, list) or not tags:
        sys.exit("TAGS.json must be a non-empty list")
    lines = available_lines(fetch_diff(repo, number))
    review = {"body": "", "comments": [build_comment(t, lines) for t in tags]}
    if submit:
        review["event"] = "COMMENT"
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as f:
        json.dump(review, f)
        payload = f.name
    out = gh("api", f"repos/{repo}/pulls/{number}/reviews", "--input", payload)
    created = json.loads(out)
    print(f"review {created['id']} {created['state']} with {len(tags)} tags")


def cmd_drafts(repo, number):
    reviews = json.loads(gh("api", f"repos/{repo}/pulls/{number}/reviews?per_page=100"))
    drafts = [r for r in reviews if r["state"] == "PENDING"]
    if not drafts:
        print("no pending reviews")
    for r in drafts:
        comments = json.loads(gh("api", f"repos/{repo}/pulls/{number}/reviews/{r['id']}/comments?per_page=100"))
        tagged = sum(1 for c in comments if c["body"].lower().startswith("narrate:"))
        print(f"review {r['id']} pending: {tagged} tag comments, {len(comments) - tagged} other comments")


def cmd_delete(repo, number, review_id):
    gh("api", "-X", "DELETE", f"repos/{repo}/pulls/{number}/reviews/{review_id}")
    print(f"deleted review {review_id}")


def main(argv):
    if len(argv) < 4:
        sys.exit(__doc__)
    command, repo, number = argv[1], argv[2], argv[3]
    if command == "diff":
        cmd_diff(repo, number)
    elif command == "post" and len(argv) >= 5:
        cmd_post(repo, number, argv[4], "--submit" in argv[5:])
    elif command == "drafts":
        cmd_drafts(repo, number)
    elif command == "delete" and len(argv) == 5:
        cmd_delete(repo, number, argv[4])
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main(sys.argv)
