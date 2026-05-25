# Obsidian community plugin submission checklist

Use this checklist when publishing **ObsiMap** to GitHub and submitting to the [Obsidian community directory](https://community.obsidian.md/).

## Repository requirements

| Item | Status | Notes |
| --- | --- | --- |
| `README.md` | Required | Describes features, install, usage |
| `LICENSE` | Required | MIT — included |
| `manifest.json` at repo root | Required | Matches release assets |
| `main.js` at repo root | Required | Built with `npm run build` |
| `styles.css` at repo root | Required | Included |
| `versions.json` | Recommended | Maps plugin version → `minAppVersion` |
| No `node_modules` in git | Required | Listed in `.gitignore` |
| No personal paths / secrets | Required | Do not commit vault paths or API keys |

## `manifest.json` rules

- `id`: `obsimap` (unique; must not contain `obsidian`)
- `version`: SemVer `x.y.z` only (e.g. `1.0.0`)
- `description`: Action-oriented, ≤250 characters, ends with `.`
- `isDesktopOnly`: `false` (no Node.js-only APIs)
- `fundingUrl`: Only if you accept donations (Buy Me a Coffee URL)

## GitHub release (required for installs)

1. Set `manifest.json` `version` to the release version (e.g. `1.0.0`).
2. Update `versions.json`:

   ```json
   {
     "1.0.0": "1.4.14"
   }
   ```

3. Run `npm run build`.
4. Create a GitHub release with tag **`1.0.0`** (must match `manifest.json`).
5. Attach release assets:
   - `main.js`
   - `manifest.json`
   - `styles.css`

## Community directory entry

After release, submit at **community.obsidian.md** → Plugins → New plugin.

Repository URL:

`https://github.com/Creative781/obsimap`

Entry for [obsidian-releases](https://github.com/obsidianmd/obsidian-releases) `community-plugins.json` (add at end of array):

```json
{
  "id": "obsimap",
  "name": "ObsiMap",
  "author": "Creative781",
  "description": "Create keyboard-centric mind maps with wiki-linked notes, drag-and-drop, and Markdown export.",
  "repo": "Creative781/obsimap"
}
```

`description` must match `manifest.json` `description`.

## Pre-submission review

- [ ] Add 1–2 screenshots to `docs/images/` and link them from `README.md`
- [ ] Test install from GitHub release in a clean vault
- [ ] Test on desktop and mobile if possible
- [ ] Confirm hotkeys and commands work with Restricted mode off
- [ ] Read [Developer policies](https://docs.obsidian.md/Developer+policies) and [Submission requirements](https://docs.obsidian.md/Plugins/Releasing/Submission+requirements+for+plugins)

## Known notes for reviewers

- **External image**: Settings may load a Buy Me a Coffee button from `cdn.buymeacoffee.com` (display only; no vault data sent).
- **`.mindmap` format**: Custom view extension; data stored as JSON in a fenced code block inside the file.
