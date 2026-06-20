// Copy to config.js for local static hosting, or set GitHub Actions secrets:
// YOUTUBE_API_KEY, RESOLVER_URL, RESOLVER_API_KEY
//
// You can also skip this file and pass values in the URL:
// ?ytKey=...&api=https://your-backend.example.com&apiKey=...
window.YT_FRONTEND_CONFIG = {
  youtubeApiKey: "",
  resolverBase: "https://your-backend.example.com",
  resolverKey: "",
};
