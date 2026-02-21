# mandras_made_skills

Custom Claude Code skills by [@larrymandras](https://github.com/larrymandras).

## Skills

| Skill | Description |
|-------|-------------|
| [digital_art_factory](./digital_art_factory/) | Daily AI art pipeline — Claude vision + gpt-image-1 + Google Drive automation |

## Installation

Each skill lives in its own subdirectory. To install a skill, copy its folder into your Claude Code skills directory:

```bash
# macOS / Linux
cp -r digital_art_factory ~/.claude/skills/

# Windows (PowerShell)
Copy-Item -Recurse digital_art_factory $env:USERPROFILE\.claude\skills\
```

Then follow the `SETUP.md` inside the skill folder.
