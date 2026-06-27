# Static UI for GitHub Pages

This folder is published by GitHub Pages without GitHub Actions.

## Configure the live site

Edit `config.js` before pushing, or pass values in the URL:

```text
https://bara-shaban.github.io/yt-dlp-backend/home.html?ytKey=YOUR_YT_KEY&googleClientId=YOUR_GOOGLE_CLIENT_ID&api=https%3A%2F%2Fyour-backend.example.com&apiKey=YOUR_RESOLVER_KEY
```

For Google sign-in, create an OAuth web client and add each served origin to
Authorized JavaScript origins, including local preview origins such as
`http://127.0.0.1:8081` and the GitHub Pages origin. If the OAuth consent
screen is in Testing, add every account that should sign in under Test users;
otherwise Google returns `Error 403: access_denied`.

## Update after changing `ui/`

```bash
./scripts/sync-ui-docs.sh
git add docs/
git commit -m "Update GitHub Pages UI"
git push
```
