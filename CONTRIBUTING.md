# Contributing to Simple Mindmap

Thank you for your interest in improving Simple Mindmap.

## Development setup

```bash
git clone https://github.com/Creative781/obsimap.git
cd obsimap
npm install
npm run build
```

Install the built plugin in a test vault:

1. Copy `main.js`, `manifest.json`, and `styles.css` to `.obsidian/plugins/obsimap/`.
2. Enable the plugin and reload Obsidian (`Cmd+R` / `Ctrl+R`).

## Pull requests

1. Fork the repository and create a feature branch.
2. Keep changes focused; avoid unrelated refactors.
3. Run `npm run build` before submitting.
4. Describe what changed and how to test it in the PR.

## Versioning

- Use [Semantic Versioning](https://semver.org/) (`x.y.z`).
- Update `manifest.json`, `versions.json`, and `CHANGELOG.md` for releases.
- Tag GitHub releases to match `manifest.json` `version`.

## Code style

- Match existing TypeScript patterns in `src/`.
- Prefer clear names over comments for obvious code.
- Do not commit `node_modules`, local vault paths, or personal `data.json` files.

## Reporting issues

Use [GitHub Issues](https://github.com/Creative781/obsimap/issues) with:

- Obsidian version
- Simple Mindmap version
- Steps to reproduce
- Expected vs actual behavior
