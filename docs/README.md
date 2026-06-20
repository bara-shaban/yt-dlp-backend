# Static UI for GitHub Pages

This folder is published by GitHub Pages without GitHub Actions.

## Configure the live site

Edit `config.js` before pushing, or pass values in the URL:

```text
https://bara-shaban.github.io/yt-dlp-backend/?ytKey=YOUR_YT_KEY&api=https%3A%2F%2Fyour-backend.example.com&apiKey=YOUR_RESOLVER_KEY
```

## Update after changing `ui/`

```bash
./scripts/sync-ui-docs.sh
git add docs/
git commit -m "Update GitHub Pages UI"
git push
```
