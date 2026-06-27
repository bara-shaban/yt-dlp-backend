# Graph Report - yt-dlp-backend  (2026-06-27)

## Corpus Check
- 23 files · ~33,747 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 424 nodes · 637 edges · 44 communities (31 shown, 13 thin omitted)
- Extraction: 97% EXTRACTED · 3% INFERRED · 0% AMBIGUOUS · INFERRED: 22 edges (avg confidence: 0.92)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `9299e0d4`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- [[_COMMUNITY_FastAPI Backend Core|FastAPI Backend Core]]
- [[_COMMUNITY_Public API Clients|Public API Clients]]
- [[_COMMUNITY_Mobile App UI|Mobile App UI]]
- [[_COMMUNITY_Extraction Error Flow|Extraction Error Flow]]
- [[_COMMUNITY_Mobile Dependencies|Mobile Dependencies]]
- [[_COMMUNITY_Expo App Config|Expo App Config]]
- [[_COMMUNITY_Operations Runbook|Operations Runbook]]
- [[_COMMUNITY_Sidecar Token Stack|Sidecar Token Stack]]
- [[_COMMUNITY_Static UI Publishing|Static UI Publishing]]
- [[_COMMUNITY_UI Dev Server|UI Dev Server]]
- [[_COMMUNITY_Embed Candidate Parsing|Embed Candidate Parsing]]
- [[_COMMUNITY_Mobile Casting UI|Mobile Casting UI]]
- [[_COMMUNITY_Render Service Deploy|Render Service Deploy]]
- [[_COMMUNITY_Channel UI Components|Channel UI Components]]
- [[_COMMUNITY_Channel Normalization|Channel Normalization]]
- [[_COMMUNITY_Video URL Normalization|Video URL Normalization]]
- [[_COMMUNITY_Video Feed Filtering|Video Feed Filtering]]
- [[_COMMUNITY_API Base Playback|API Base Playback]]
- [[_COMMUNITY_Home Page Mirror|Home Page Mirror]]
- [[_COMMUNITY_Reel Page Mirror|Reel Page Mirror]]
- [[_COMMUNITY_Media Payload Types|Media Payload Types]]
- [[_COMMUNITY_Format Scoring|Format Scoring]]
- [[_COMMUNITY_URL Classification|URL Classification]]
- [[_COMMUNITY_Duplicate Detection|Duplicate Detection]]
- [[_COMMUNITY_Backend Docker Script|Backend Docker Script]]
- [[_COMMUNITY_Stack Docker Script|Stack Docker Script]]
- [[_COMMUNITY_UI Sync Script|UI Sync Script]]
- [[_COMMUNITY_Theme Routing|Theme Routing]]
- [[_COMMUNITY_Render Environment Limits|Render Environment Limits]]
- [[_COMMUNITY_Community 35|Community 35]]
- [[_COMMUNITY_Community 36|Community 36]]
- [[_COMMUNITY_Community 37|Community 37]]
- [[_COMMUNITY_Community 38|Community 38]]
- [[_COMMUNITY_Community 39|Community 39]]
- [[_COMMUNITY_Community 40|Community 40]]
- [[_COMMUNITY_Community 41|Community 41]]
- [[_COMMUNITY_Community 42|Community 42]]
- [[_COMMUNITY_Community 43|Community 43]]

## God Nodes (most connected - your core abstractions)
1. `yt-dlp API Backend Runbook` - 23 edges
2. `ResolveRequest` - 18 edges
3. `yt-dlp Media URL API` - 14 edges
4. `extract_info_async()` - 13 edges
5. `Architecture & Flow` - 12 edges
6. `channel_videos()` - 11 edges
7. `expo` - 11 edges
8. `search_result_from_entry()` - 10 edges
9. `stream_get()` - 9 edges
10. `playlist_videos()` - 9 edges

## Surprising Connections (you probably didn't know these)
- `API Surface` --semantically_similar_to--> `Endpoint Surface`  [INFERRED] [semantically similar]
  docs/ARCHITECTURE.md → README.yt-dlp-api.md
- `normalizeResolverBase` --semantically_similar_to--> `normalizeResolverBase`  [INFERRED] [semantically similar]
  .github/workflows/deploy-ui.yml → ui/index.html
- `YT Modified Home Page` --semantically_similar_to--> `YT Modified Home Page`  [INFERRED] [semantically similar]
  docs/home.html → ui/home.html
- `YouTube Link Frontend` --semantically_similar_to--> `YouTube Link Frontend`  [INFERRED] [semantically similar]
  docs/index.html → ui/index.html
- `REEL Cinema UI` --semantically_similar_to--> `REEL Cinema UI`  [INFERRED] [semantically similar]
  docs/reel.html → ui/reel.html

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Backend Resolver API Surface** — readme_yt_dlp_api_endpoint_surface, ui_index_searchbackend, ui_index_resolvevideo, ui_index_loadavailableformats, ui_index_loadbackendplaylist, ui_home_loadbackendfeed, ui_home_streamurlforvideo, ui_reel_loadbackendfeed, mobile_readme_mobile_feature_set [INFERRED 0.85]
- **Bot Check Mitigation Stack** — docs_architecture_bot_check_problem, runbook_cookies_secret, runbook_bgutil_pot_provider, runbook_residential_proxy, docker_compose_bgutil_provider_service, requirements_bgutil_ytdlp_pot_provider_dependency [EXTRACTED 1.00]
- **Static Frontend Publication Flow** — ui_index_youtube_link_frontend, ui_home_yt_modified_home_page, ui_reel_reel_cinema_ui, docs_index_youtube_link_frontend, docs_home_yt_modified_home_page, docs_reel_reel_cinema_ui, docs_readme_sync_ui_docs, workflows_deploy_ui_deploy_ui_to_github_pages [INFERRED 0.85]

## Communities (44 total, 13 thin omitted)

### Community 0 - "FastAPI Backend Core"
Cohesion: 0.07
Nodes (68): Any, BaseModel, IPv4Address, IPv6Address, annotate_format_result(), base_ytdlp_opts(), best_thumbnail(), build_response() (+60 more)

### Community 1 - "Public API Clients"
Cohesion: 0.22
Nodes (10): API Surface, Chromecast Development Build, Mobile Feature Set, /channels Endpoints, Endpoint Surface, /formats Endpoint, /playlist Endpoint, DEFAULT_FORMAT (+2 more)

### Community 2 - "Mobile App UI"
Cohesion: 0.05
Nodes (7): BASE_MEDIA_OPTIONS, BASE_RESOLUTION_OPTIONS, DEFAULT_API_BASE, MediaMetadataTypeValue, STORAGE_KEYS, styles, TOPIC_CHIPS

### Community 3 - "Extraction Error Flow"
Cohesion: 0.29
Nodes (11): DownloadError, ExtractorError, HTTPException, clean_extraction_error(), extraction_http_exception(), proxy_stream(), require_api_key(), stream_get() (+3 more)

### Community 4 - "Mobile Dependencies"
Cohesion: 0.08
Nodes (25): dependencies, expo, expo-status-bar, expo-video, react, react-native, @react-native-async-storage/async-storage, react-native-google-cast (+17 more)

### Community 5 - "Expo App Config"
Cohesion: 0.08
Nodes (24): backgroundColor, adaptiveIcon, package, permissions, usesCleartextTraffic, expo, android, assetBundlePatterns (+16 more)

### Community 6 - "Operations Runbook"
Cohesion: 0.06
Nodes (32): Health Check Path, 1. Provide real browser cookies (mandatory), 2. Add a `po_token` (often required from datacenter IPs), 3. Route through a residential proxy (most reliable), 4. Run the backend off Codespaces, API Docs, API Key Authentication, Backend CORS (+24 more)

### Community 7 - "Sidecar Token Stack"
Cohesion: 0.15
Nodes (15): backend Service, BGUTIL_POT_BASE_URL, bgutil-provider Service, Cookie Environment Variables, Host Port Mapping, Bot Check Problem, Container Topology, HTTP PO Token Provider Decision (+7 more)

### Community 8 - "Static UI Publishing"
Cohesion: 0.10
Nodes (19): Client Consumption, Expo Mobile App, Static UI Pages, Static UI Separation Decision, Stream Proxy, YouTube Link Frontend, Configure the live site, Live Site Configuration (+11 more)

### Community 9 - "UI Dev Server"
Cohesion: 0.23
Nodes (11): contentTypes, envPath, firstValue(), normalizeEnvKey(), port, readEnv(), repoDir, sendConfig() (+3 more)

### Community 10 - "Embed Candidate Parsing"
Cohesion: 0.32
Nodes (5): HTMLParser, EmbedCandidateParser, extract_embed_candidates_from_html(), looks_like_media_url(), normalize_candidate_url()

### Community 11 - "Mobile Casting UI"
Cohesion: 0.25
Nodes (8): App(), castStateLabel(), clamp(), compactMeta(), formatNumber(), QueueItem(), useCastStateHook(), useRemoteMediaClientHook()

### Community 12 - "Render Service Deploy"
Cohesion: 0.11
Nodes (18): FastAPI Decision, Embedded video pages, Endpoints, Example request, Local Docker run, Optional request fields, Push an image for Render to pull, Render deploy (+10 more)

### Community 13 - "Channel UI Components"
Cohesion: 0.33
Nodes (6): ChannelPanel(), ChannelTile(), formatDuration(), HomeVideoCard(), initials(), WatchChannelRow()

### Community 14 - "Channel Normalization"
Cohesion: 0.50
Nodes (5): channelFromVideo(), channelKey(), cleanChannel(), decodeEntities(), uniqueChannels()

### Community 15 - "Video URL Normalization"
Cohesion: 0.70
Nodes (5): cleanVideo(), queueItemFromVideo(), thumbnailFromUrl(), videoFromUrl(), videoIdFromUrl()

### Community 16 - "Video Feed Filtering"
Cohesion: 0.67
Nodes (3): dedupeVideos(), isShortVideo(), splitVideoKinds()

### Community 17 - "API Base Playback"
Cohesion: 0.33
Nodes (6): isNgrokFreeUrl(), mediaTypeLabel(), normalizeApiBase(), playbackUrlForPayload(), resolutionLabel(), YouPanel()

### Community 35 - "Community 35"
Cohesion: 0.10
Nodes (18): 10. Where the important code lives, 1. What the system does, 2. Container topology, 3. The bot-check problem (and how this solves it), 4. Request lifecycle, 5. API surface — what clients consume, 6.1 The browser UI (`ui/` → published to `docs/`), 6.2 The Expo mobile app (`mobile/`) (+10 more)

### Community 38 - "Community 38"
Cohesion: 0.25
Nodes (9): /search Endpoint, /stream Endpoint, Stream Proxy Rationale, loadBackendFeed, resolverBase, streamUrlForVideo, loadBackendFeed, resolverBase (+1 more)

### Community 39 - "Community 39"
Cohesion: 0.29
Nodes (7): Codespaces Tunnel Auth, GitHub Pages UI, hydrateInputs, Local Storage State, Deploy UI to GitHub Pages, docs/config.js, GitHub Pages

### Community 40 - "Community 40"
Cohesion: 0.29
Nodes (7): normalizeResolverBase, normalizeResolverBase, resolverBase, normalizeResolverBase, Bake frontend config into docs, normalizeResolverBase, Repository Secrets

### Community 41 - "Community 41"
Cohesion: 0.33
Nodes (6): Native Google OAuth Gap, Google OAuth Import, searchBackend, searchYouTube, YouTube Data API, youtubeAuthorizedList

### Community 42 - "Community 42"
Cohesion: 0.33
Nodes (6): loadVideoSource, backendStreamUrl, hls.js Library, playResolvedLink, resolveVideo, loadVideoSource

### Community 43 - "Community 43"
Cohesion: 0.40
Nodes (5): Request Lifecycle, Internal EAS Build Config, Embedded Video Fallback, /resolve Endpoint, yt-dlp Dependency

## Knowledge Gaps
- **143 isolated node(s):** `DEFAULT_API_BASE`, `STORAGE_KEYS`, `TOPIC_CHIPS`, `BASE_MEDIA_OPTIONS`, `BASE_RESOLUTION_OPTIONS` (+138 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **13 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `yt-dlp API Backend Runbook` connect `Operations Runbook` to `Community 35`, `Render Service Deploy`, `Community 39`?**
  _High betweenness centrality (0.075) - this node is a cross-community bridge._
- **Why does `yt-dlp Media URL API` connect `Render Service Deploy` to `Static UI Publishing`, `Public API Clients`?**
  _High betweenness centrality (0.060) - this node is a cross-community bridge._
- **Why does `YouTube Bot Check Mitigation` connect `Render Service Deploy` to `Operations Runbook`, `Sidecar Token Stack`?**
  _High betweenness centrality (0.058) - this node is a cross-community bridge._
- **Are the 2 inferred relationships involving `yt-dlp Media URL API` (e.g. with `yt-dlp-media-url-api Service` and `fastapi Dependency`) actually correct?**
  _`yt-dlp Media URL API` has 2 INFERRED edges - model-reasoned connections that need verification._
- **What connects `DEFAULT_API_BASE`, `STORAGE_KEYS`, `TOPIC_CHIPS` to the rest of the system?**
  _150 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `FastAPI Backend Core` be split into smaller, more focused modules?**
  _Cohesion score 0.07025316455696203 - nodes in this community are weakly interconnected._
- **Should `Mobile App UI` be split into smaller, more focused modules?**
  _Cohesion score 0.05 - nodes in this community are weakly interconnected._