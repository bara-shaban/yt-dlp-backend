import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEventListener } from "expo";
import { StatusBar } from "expo-status-bar";
import { useVideoPlayer, VideoView } from "expo-video";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  FlatList,
  Image,
  KeyboardAvoidingView,
  NativeModules,
  PanResponder,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  UIManager,
  View,
} from "react-native";

const ENV = typeof process !== "undefined" ? process.env || {} : {};
const REMOTE_API_BASE = "https://organic-space-goggles-4jwg4v79r5rpc5qg5-10000.app.github.dev/resolve";
const DEFAULT_API_BASE = normalizeApiBase(ENV.EXPO_PUBLIC_RESOLVER_URL || REMOTE_API_BASE);
const DEFAULT_API_KEY = ENV.EXPO_PUBLIC_RESOLVER_API_KEY || "";
const DEFAULT_FORMAT = "best[ext=mp4][height<=720][vcodec!=none][acodec!=none]/best[height<=720][vcodec!=none][acodec!=none]/best";
const SHORTS_MAX_SECONDS = 180;
const SHORTS_LEGACY_MAX_SECONDS = 65;
const CAST_UNAVAILABLE = "unavailable";
const CAST_BUTTON_VIEW = "RNGoogleCastButton";

const STORAGE_KEYS = {
  apiBase: "ai-wa7shtube-api-base",
  apiKey: "ai-wa7shtube-api-key",
  queue: "ai-wa7shtube-queue",
  history: "ai-wa7shtube-history",
  subscriptions: "ai-wa7shtube-subscriptions",
  mediaType: "ai-wa7shtube-media-type",
  resolution: "ai-wa7shtube-resolution",
};

const TOPIC_CHIPS = [
  { label: "All", query: "popular videos today" },
  { label: "Music", query: "latest music videos" },
  { label: "Mixes", query: "youtube music mix" },
  { label: "Arabic", query: "arabic music videos" },
  { label: "Gaming", query: "gaming videos" },
  { label: "Live", query: "live streams" },
  { label: "Podcasts", query: "podcast highlights" },
];
const BASE_MEDIA_OPTIONS = ["auto", "mp4", "m3u8", "webm"];
const BASE_RESOLUTION_OPTIONS = ["auto", "1080", "720", "480", "360", "audio"];

let CastButtonComponent = FallbackCastButton;
let useCastStateHook = () => CAST_UNAVAILABLE;
let useRemoteMediaClientHook = () => null;
let MediaMetadataTypeValue = { MOVIE: "movie" };

try {
  if (hasNativeCastSupport()) {
    const googleCast = require("react-native-google-cast");
    CastButtonComponent = googleCast.CastButton || CastButtonComponent;
    useCastStateHook = googleCast.useCastState || useCastStateHook;
    useRemoteMediaClientHook = googleCast.useRemoteMediaClient || useRemoteMediaClientHook;
    MediaMetadataTypeValue = googleCast.MediaMetadataType || MediaMetadataTypeValue;
  }
} catch {
  // Cast is native-only. Expo Go should keep running without it.
}

function hasNativeCastSupport() {
  if (Platform.OS === "web") return false;
  const hasCastModules = Boolean(NativeModules.RNGCCastContext && NativeModules.RNGCRemoteMediaClient);
  const getViewManagerConfig = UIManager.getViewManagerConfig?.bind(UIManager);
  const hasViewManagerConfig = UIManager.hasViewManagerConfig?.bind(UIManager);
  const hasCastButtonView = Boolean(
    getViewManagerConfig?.(CAST_BUTTON_VIEW)
      || hasViewManagerConfig?.(CAST_BUTTON_VIEW)
  );
  return hasCastModules && hasCastButtonView;
}

export default function App() {
  const videoViewRef = useRef(null);
  const resolvedCache = useRef(new Map());
  const playNextRef = useRef(() => {});
  const appStateRef = useRef(AppState.currentState);
  const pipAttemptRef = useRef(0);
  const castClient = useRemoteMediaClientHook();
  const castState = useCastStateHook();

  const player = useVideoPlayer(null, (instance) => {
    instance.loop = false;
    instance.timeUpdateEventInterval = 0.5;
    instance.keepScreenOnWhilePlaying = true;
    instance.staysActiveInBackground = true;
    instance.showNowPlayingNotification = true;
    instance.audioMixingMode = "doNotMix";
  });

  const [apiBase, setApiBase] = useState(DEFAULT_API_BASE);
  const [apiKey, setApiKey] = useState(DEFAULT_API_KEY);
  const [query, setQuery] = useState("");
  const [activeTopic, setActiveTopic] = useState(TOPIC_CHIPS[0]);
  const [screen, setScreen] = useState("home");
  const [status, setStatus] = useState("Loading home...");
  const [busy, setBusy] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [feed, setFeed] = useState([]);
  const [queue, setQueue] = useState([]);
  const [history, setHistory] = useState([]);
  const [subscriptions, setSubscriptions] = useState([]);
  const [activeChannel, setActiveChannel] = useState(null);
  const [channelVideos, setChannelVideos] = useState([]);
  const [playlistSheetOpen, setPlaylistSheetOpen] = useState(false);
  const [activePlaylist, setActivePlaylist] = useState(null);
  const [currentVideo, setCurrentVideo] = useState(null);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [activePayload, setActivePayload] = useState(null);
  const [activeResolved, setActiveResolved] = useState(null);
  const [availableFormats, setAvailableFormats] = useState([]);
  const [mediaType, setMediaType] = useState("auto");
  const [resolution, setResolution] = useState("720");
  const [isPlaying, setIsPlaying] = useState(false);
  const [playback, setPlayback] = useState({ currentTime: 0, duration: 0, bufferedPosition: 0 });
  const [volume, setVolume] = useState(1);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isPictureInPicture, setIsPictureInPicture] = useState(false);

  const { regularVideos, shortsVideos } = useMemo(() => splitVideoKinds(feed), [feed]);
  const channelBubbles = useMemo(() => uniqueChannels(feed).slice(0, 8), [feed]);
  const mediaOptions = useMemo(() => optionList(BASE_MEDIA_OPTIONS, availableFormats.map(mediaTypeKey), mediaTypeLabel), [availableFormats]);
  const resolutionOptions = useMemo(() => {
    const values = new Set(BASE_RESOLUTION_OPTIONS);
    availableFormats.forEach((format) => {
      if (Number(format.height) > 0) values.add(String(format.height));
    });
    return [...values].sort(sortResolutionValues).map((value) => ({ value, label: resolutionLabel(value) }));
  }, [availableFormats]);

  const videoPanResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gesture) => {
        const verticalMove = Math.abs(gesture.dy) > 18 && Math.abs(gesture.dy) > Math.abs(gesture.dx) * 1.35;
        return verticalMove && Boolean(currentVideo);
      },
      onPanResponderRelease: (_, gesture) => {
        if (gesture.dy < -48) {
          if (screen !== "watch") setScreen("watch");
          windowSafeTimeout(() => enterFullscreen(), 120);
        }
      },
    }),
  ).current;

  useEventListener(player, "playingChange", ({ isPlaying: nextPlaying }) => setIsPlaying(Boolean(nextPlaying)));
  useEventListener(player, "timeUpdate", ({ currentTime, bufferedPosition }) => {
    setPlayback({
      currentTime: Number(currentTime || 0),
      duration: Number(player.duration || 0),
      bufferedPosition: Number(bufferedPosition || 0),
    });
  });
  useEventListener(player, "volumeChange", ({ volume: nextVolume }) => setVolume(Number(nextVolume || 0)));
  useEventListener(player, "sourceLoad", ({ duration }) => {
    setPlayback((value) => ({ ...value, duration: Number(duration || 0) }));
  });
  useEventListener(player, "statusChange", ({ status: nextStatus, error }) => {
    if (nextStatus === "error") setStatus(error?.message || "Playback failed.");
    if (nextStatus === "loading" && currentVideo) setStatus("Buffering...");
  });
  useEventListener(player, "playToEnd", () => playNextRef.current(false));

  useEffect(() => {
    loadPersistedState();
  }, []);

  useEffect(() => {
    if (hydrated) loadHomeFeed(activeTopic);
  }, [hydrated, apiBase, apiKey]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      const wasActive = appStateRef.current === "active";
      appStateRef.current = nextState;
      if (wasActive && nextState !== "active" && currentVideo && isPlaying) {
        startPictureInPicture({ silent: true });
      }
    });
    return () => subscription.remove();
  }, [currentVideo, isPlaying]);

  useEffect(() => {
    preResolveQueue(queue);
  }, [queue, apiBase, apiKey, mediaType, resolution]);

  const request = async (path, options = {}) => {
    const cleanBase = normalizeApiBase(apiBase);
    if (!cleanBase) throw new Error("Set your resolver URL first.");
    const response = await fetch(`${cleanBase}${path}`, {
      ...options,
      headers: {
        ...(options.json ? { "content-type": "application/json" } : {}),
        ...(apiKey ? { "x-api-key": apiKey } : {}),
        ...(isNgrokFreeUrl(cleanBase) ? { "ngrok-skip-browser-warning": "true" } : {}),
        ...(options.headers || {}),
      },
      body: options.json ? JSON.stringify(options.json) : options.body,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(readError(payload, response.status));
    return payload;
  };

  const loadPersistedState = async () => {
    const pairs = await AsyncStorage.multiGet(Object.values(STORAGE_KEYS));
    const stored = Object.fromEntries(pairs);
    setApiBase(normalizeApiBase(stored[STORAGE_KEYS.apiBase] || DEFAULT_API_BASE));
    setApiKey(stored[STORAGE_KEYS.apiKey] || DEFAULT_API_KEY);
    setMediaType(stored[STORAGE_KEYS.mediaType] || "auto");
    setResolution(stored[STORAGE_KEYS.resolution] || "720");
    setQueue(parseStoredArray(stored[STORAGE_KEYS.queue]).map(queueItemFromVideo).filter((item) => item.url));
    setHistory(parseStoredArray(stored[STORAGE_KEYS.history]).map(cleanVideo).filter((item) => item.url));
    setSubscriptions(parseStoredArray(stored[STORAGE_KEYS.subscriptions]).map(cleanChannel).filter((item) => item.name));
    setHydrated(true);
  };

  const loadHomeFeed = async (topic = activeTopic) => {
    setBusy(true);
    setStatus("Loading from backend...");
    try {
      const params = new URLSearchParams({ q: topic.query, limit: "30" });
      const payload = await request(`/search?${params.toString()}`);
      const videos = (Array.isArray(payload.results) ? payload.results : []).map(cleanVideo).filter((item) => item.url);
      setFeed(videos);
      setStatus(videos.length ? "Home loaded from backend" : "No backend results");
    } catch (error) {
      setStatus(`${error.message || "Backend request failed"} - check resolver URL`);
    } finally {
      setBusy(false);
    }
  };

  const chooseTopic = (topic) => {
    setActiveTopic(topic);
    setScreen("home");
    loadHomeFeed(topic);
  };

  const runSearch = async () => {
    const value = query.trim();
    if (!value) return;

    if (isPlaylistUrl(value)) {
      await loadPlaylist(value, { autoplay: true });
      return;
    }
    if (isUrl(value)) {
      playNow(videoFromUrl(value));
      return;
    }

    setBusy(true);
    setStatus("Searching backend...");
    try {
      const params = new URLSearchParams({ q: value, limit: "30" });
      const payload = await request(`/search?${params.toString()}`);
      const videos = (Array.isArray(payload.results) ? payload.results : []).map(cleanVideo).filter((item) => item.url);
      setFeed(videos);
      setScreen("home");
      setStatus(videos.length ? "Search loaded from backend" : "No results");
    } catch (error) {
      setStatus(error.message || "Search failed.");
    } finally {
      setBusy(false);
    }
  };

  const openChannel = async (source) => {
    const channel = cleanChannel(source?.name ? source : channelFromVideo(source));
    if (!channel.name) return;
    setActiveChannel(channel);
    setScreen("channel");
    setBusy(true);
    setStatus(`Loading ${channel.name}...`);
    try {
      const params = new URLSearchParams({ q: `${channel.name} latest videos`, limit: "30" });
      const payload = await request(`/search?${params.toString()}`);
      const videos = (Array.isArray(payload.results) ? payload.results : []).map(cleanVideo).filter((item) => item.url);
      setChannelVideos(videos);
      setStatus(videos.length ? `${channel.name}` : "No channel videos found");
    } catch (error) {
      setChannelVideos([]);
      setStatus(error.message || "Channel failed.");
    } finally {
      setBusy(false);
    }
  };

  const toggleSubscription = (source) => {
    const channel = cleanChannel(source?.name ? source : channelFromVideo(source));
    if (!channel.name) return;
    const nextSubscriptions = isSubscribedChannel(channel)
      ? subscriptions.filter((item) => channelKey(item) !== channelKey(channel))
      : [channel, ...subscriptions.filter((item) => channelKey(item) !== channelKey(channel))].slice(0, 80);
    setSubscriptions(nextSubscriptions);
    persistList(STORAGE_KEYS.subscriptions, nextSubscriptions);
    setStatus(nextSubscriptions.some((item) => channelKey(item) === channelKey(channel)) ? "Subscribed" : "Unsubscribed");
  };

  const isSubscribedChannel = (source) => {
    const channel = cleanChannel(source?.name ? source : channelFromVideo(source));
    return subscriptions.some((item) => channelKey(item) === channelKey(channel));
  };

  const loadPlaylist = async (url, options = {}) => {
    setBusy(true);
    setStatus("Loading playlist...");
    try {
      const params = new URLSearchParams({ url, limit: "50" });
      const payload = await request(`/playlist?${params.toString()}`);
      const videos = (Array.isArray(payload.results) ? payload.results : []).map(queueItemFromVideo).filter((item) => item.url);
      const playlist = payload.playlist || { title: "Playlist", url };
      setActivePlaylist({ ...playlist, videos });
      setQueue(videos);
      persistList(STORAGE_KEYS.queue, videos.map(queueItemForStorage));
      setPlaylistSheetOpen(true);
      setStatus(videos.length ? "Playlist loaded" : "Playlist has no videos");
      if (options.autoplay && videos.length) playVideo(videos[0], 0, { nextQueue: videos, playlist });
    } catch (error) {
      setStatus(error.message || "Playlist failed.");
    } finally {
      setBusy(false);
    }
  };

  const loadFormatsForVideo = async (video) => {
    if (!video?.url) return;
    setAvailableFormats([]);
    try {
      const params = new URLSearchParams({ url: video.url });
      const payload = await request(`/formats?${params.toString()}`);
      const formats = Array.isArray(payload.formats) ? payload.formats.filter(isUsableFormat) : [];
      setAvailableFormats(formats);
    } catch {
      setAvailableFormats([]);
    }
  };

  const resolveVideoData = async (video, overrides = {}) => {
    const format = formatValue(overrides);
    const key = cacheKey(apiBase, apiKey, video.url, format);
    const cached = resolvedCache.current.get(key);
    if (cached && !isResolvedExpired(cached.payload)) return cached;

    const payload = await request("/resolve", {
      method: "POST",
      json: { url: video.url, video_format: format || undefined },
    });
    const resolved = {
      payload,
      streamUrl: playbackUrlForPayload(apiBase, apiKey, video.url, format, payload),
      resolvedAt: Date.now(),
    };
    resolvedCache.current.set(key, resolved);
    return resolved;
  };

  const replacePlayerSource = async (resolved, video) => {
    const source = {
      uri: resolved.streamUrl,
      ...(isHlsPayload(resolved.payload, resolved.streamUrl) ? { contentType: "hls" } : {}),
      metadata: {
        title: resolved.payload.title || video.title || "AI-Wa7shTube",
        artist: video.channel || "YouTube",
        artwork: video.thumbnail || resolved.payload.thumbnail || "",
      },
    };
    if (typeof player.replaceAsync === "function") {
      await player.replaceAsync(source);
    } else {
      player.replace(source);
    }
    player.volume = volume;
    player.play();
  };

  const playVideo = async (video, index = -1, overrides = {}) => {
    const clean = queueItemFromVideo(video);
    const nextQueue = overrides.nextQueue || queue;
    if (overrides.nextQueue) {
      setQueue(overrides.nextQueue);
      persistList(STORAGE_KEYS.queue, overrides.nextQueue.map(queueItemForStorage));
    }
    if (overrides.playlist) setActivePlaylist({ ...overrides.playlist, videos: nextQueue });
    setCurrentVideo(clean);
    setCurrentIndex(index);
    setScreen("watch");
    setActivePayload(null);
    setActiveResolved(null);
    setStatus("Resolving backend stream...");
    addHistory(clean);
    loadFormatsForVideo(clean);
    try {
      const resolved = await resolveVideoData(clean, overrides);
      setActivePayload(resolved.payload);
      setActiveResolved(resolved);
      if (resolved.payload?.format_fallback) {
        setMediaType("auto");
        setResolution("auto");
        AsyncStorage.multiSet([
          [STORAGE_KEYS.mediaType, "auto"],
          [STORAGE_KEYS.resolution, "auto"],
        ]).catch(() => {});
      }
      await replacePlayerSource(resolved, clean);
      setStatus(resolved.payload?.format_fallback ? "Selected quality was unavailable. Playing Auto." : "Playing from backend");
      if (index >= 0) preResolveQueue(nextQueue.slice(index + 1));
    } catch (error) {
      setStatus(error.message || "Unable to play this video.");
    }
  };

  const playNow = (video) => {
    const item = queueItemFromVideo(video);
    const suggestedQueue = dedupeVideos([item, ...regularVideos, ...shortsVideos]).map(queueItemFromVideo);
    const index = suggestedQueue.findIndex((queued) => sameVideo(queued, item));
    setActivePlaylist({ title: `Mix - ${item.channel || "YouTube"}`, videos: suggestedQueue });
    playVideo(item, Math.max(index, 0), { nextQueue: suggestedQueue, playlist: { title: `Mix - ${item.channel || "YouTube"}` } });
  };

  const openMixForVideo = (video) => {
    const item = queueItemFromVideo(video);
    const nextQueue = dedupeVideos([item, ...regularVideos, ...shortsVideos]).map(queueItemFromVideo);
    setQueue(nextQueue);
    setActivePlaylist({ title: `Mix - ${item.channel || "YouTube"}`, videos: nextQueue });
    persistList(STORAGE_KEYS.queue, nextQueue.map(queueItemForStorage));
    setPlaylistSheetOpen(true);
    setStatus("Mix ready");
  };

  const playPrevious = () => {
    if (currentIndex > 0) playVideo(queue[currentIndex - 1], currentIndex - 1);
  };

  const playNext = useCallback(
    (manual = true) => {
      const nextIndex = currentIndex + 1;
      if (currentIndex >= 0 && nextIndex < queue.length) {
        playVideo(queue[nextIndex], nextIndex);
      } else {
        setStatus(manual ? "No next video" : "Queue finished");
      }
    },
    [currentIndex, queue],
  );
  playNextRef.current = playNext;

  const addToQueue = (video) => {
    const item = queueItemFromVideo(video);
    if (queue.some((queued) => sameVideo(queued, item))) {
      setStatus("Already in playlist");
      return;
    }
    const nextQueue = [...queue, item];
    setQueue(nextQueue);
    setActivePlaylist({ title: activePlaylist?.title || "Saved playlist", videos: nextQueue });
    persistList(STORAGE_KEYS.queue, nextQueue.map(queueItemForStorage));
    setPlaylistSheetOpen(true);
    setStatus("Added to playlist");
  };

  const removeFromQueue = (index) => {
    const nextQueue = queue.filter((_, itemIndex) => itemIndex !== index);
    setQueue(nextQueue);
    setActivePlaylist((playlist) => playlist ? { ...playlist, videos: nextQueue } : playlist);
    persistList(STORAGE_KEYS.queue, nextQueue.map(queueItemForStorage));
    if (index === currentIndex) {
      setCurrentIndex(-1);
      setCurrentVideo(null);
      player.pause();
    } else if (index < currentIndex) {
      setCurrentIndex(currentIndex - 1);
    }
  };

  const clearQueue = () => {
    setQueue([]);
    setActivePlaylist(null);
    persistList(STORAGE_KEYS.queue, []);
    setCurrentIndex(-1);
    setPlaylistSheetOpen(false);
  };

  const addHistory = (video) => {
    const nextHistory = [video, ...history.filter((item) => !sameVideo(item, video))].slice(0, 30);
    setHistory(nextHistory);
    persistList(STORAGE_KEYS.history, nextHistory.map(queueItemForStorage));
  };

  const updateApiBase = (value) => {
    const normalized = normalizeApiBase(value);
    setApiBase(normalized);
    AsyncStorage.setItem(STORAGE_KEYS.apiBase, normalized);
    resolvedCache.current.clear();
  };

  const updateApiKey = (value) => {
    setApiKey(value);
    AsyncStorage.setItem(STORAGE_KEYS.apiKey, value);
    resolvedCache.current.clear();
  };

  const updateMediaType = (value) => {
    setMediaType(value);
    AsyncStorage.setItem(STORAGE_KEYS.mediaType, value);
    resolvedCache.current.clear();
    if (currentVideo) playVideo(currentVideo, currentIndex, { mediaType: value, resolution });
  };

  const updateResolution = (value) => {
    setResolution(value);
    AsyncStorage.setItem(STORAGE_KEYS.resolution, value);
    resolvedCache.current.clear();
    if (currentVideo) playVideo(currentVideo, currentIndex, { mediaType, resolution: value });
  };

  const formatValue = (overrides = {}) => {
    const selectedMediaType = overrides.mediaType || mediaType;
    const selectedResolution = overrides.resolution || resolution;
    const selected = selectedFormatFromAvailable(availableFormats, selectedMediaType, selectedResolution);
    if (selected?.format_id) return String(selected.format_id);
    return selectorFromControls(selectedMediaType, selectedResolution);
  };

  const preResolveQueue = async (items) => {
    for (const item of items.slice(0, 3)) {
      try {
        await resolveVideoData(item);
      } catch {
        // Warm cache only. Actual playback surfaces errors.
      }
    }
  };

  const castCurrentVideo = async () => {
    if (!currentVideo) return setStatus("Pick a video first.");
    if (!castClient || typeof castClient.loadMedia !== "function") {
      return setStatus("Use a dev build and connect to Chromecast first.");
    }
    setStatus("Preparing Cast...");
    try {
      const resolved = activeResolved || await resolveVideoData(currentVideo);
      await castClient.loadMedia({
        mediaInfo: {
          contentUrl: resolved.streamUrl,
          contentType: contentTypeForPayload(resolved.payload, resolved.streamUrl),
          metadata: {
            type: MediaMetadataTypeValue.MOVIE,
            title: currentVideo.title || "AI-Wa7shTube",
            subtitle: currentVideo.channel || "YouTube",
            images: currentVideo.thumbnail ? [{ url: currentVideo.thumbnail }] : [],
          },
          streamDuration: Number(currentVideo.duration || activePayload?.duration || 0) || undefined,
        },
      });
      player.pause();
      setStatus("Casting");
    } catch (error) {
      setStatus(error.message || "Could not start Cast.");
    }
  };

  const enterFullscreen = async () => {
    if (!currentVideo) return;
    try {
      await videoViewRef.current?.enterFullscreen?.();
    } catch {
      setStatus("Fullscreen is not available on this device.");
    }
  };

  const startPictureInPicture = async (options = {}) => {
    if (!currentVideo) return;
    const now = Date.now();
    if (options.silent && now - pipAttemptRef.current < 2500) return;
    pipAttemptRef.current = now;
    try {
      await videoViewRef.current?.startPictureInPicture?.();
      setIsPictureInPicture(true);
    } catch (error) {
      if (!options.silent) {
        setStatus(error?.message || "Picture in picture is not available on this device.");
      }
    }
  };

  const togglePlayback = () => {
    if (!currentVideo) return;
    if (isPlaying) player.pause();
    else player.play();
  };

  const seekBy = (seconds) => {
    if (!currentVideo) return;
    if (typeof player.seekBy === "function") player.seekBy(seconds);
    else player.currentTime = Math.max(0, Number(player.currentTime || 0) + seconds);
  };

  const changeVolume = (delta) => {
    const nextVolume = clamp(Number(player.volume || volume || 0) + delta, 0, 1);
    player.volume = nextVolume;
    player.muted = nextVolume === 0;
    setVolume(nextVolume);
  };

  const progressPercent = playback.duration ? clamp(playback.currentTime / playback.duration, 0, 1) * 100 : 0;
  const bufferedPercent = playback.duration ? clamp(playback.bufferedPosition / playback.duration, 0, 1) * 100 : 0;

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="light" />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.safe}>
        <View style={styles.appShell}>
          {screen === "watch" ? (
            <ScrollView style={styles.screen} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.watchContent}>
              <WatchHeader onBack={() => setScreen("home")} />
              <PlayerSurface
                player={player}
                videoViewRef={videoViewRef}
                videoPanResponder={videoPanResponder}
                currentVideo={currentVideo}
                progressPercent={progressPercent}
                bufferedPercent={bufferedPercent}
                onPictureInPictureStart={() => setIsPictureInPicture(true)}
                onPictureInPictureStop={() => setIsPictureInPicture(false)}
                setIsFullscreen={setIsFullscreen}
              />
              <Text style={styles.watchTitle} numberOfLines={3}>{currentVideo?.title || "No video selected"}</Text>
              <Text style={styles.watchMeta} numberOfLines={2}>
                {[currentVideo?.channel, currentVideo?.view_count ? `${formatNumber(currentVideo.view_count)} views` : "", currentVideo?.upload_date, castStateLabel(castState)].filter(Boolean).join("  ")}
              </Text>
              <WatchChannelRow
                video={currentVideo}
                subscribed={currentVideo ? isSubscribedChannel(currentVideo) : false}
                onOpen={() => currentVideo && openChannel(currentVideo)}
                onSubscribe={() => currentVideo && toggleSubscription(currentVideo)}
              />
              <ActionRow
                isPlaying={isPlaying}
                onPlay={togglePlayback}
                onPrev={playPrevious}
                onNext={() => playNext(true)}
                onCast={castCurrentVideo}
                onPictureInPicture={() => startPictureInPicture()}
                isPictureInPicture={isPictureInPicture}
                onFullscreen={enterFullscreen}
                disabled={!currentVideo}
              />
              <View style={styles.controls}>
                <ControlButton label="-10" disabled={!currentVideo} onPress={() => seekBy(-10)} />
                <ControlButton label={`Vol ${Math.round(volume * 100)}%`} disabled={!currentVideo} onPress={() => changeVolume(0.08)} />
                <ControlButton label="+10" disabled={!currentVideo} onPress={() => seekBy(10)} />
                <ControlButton label="Playlist" disabled={!queue.length} onPress={() => setPlaylistSheetOpen(true)} />
              </View>
              <View style={styles.commentsCard}>
                <Text style={styles.commentsTitle}>Comments</Text>
                <Text style={styles.commentText}>Comments and discussion appear here when connected to a comments source.</Text>
              </View>
              <PlaylistPreview queue={queue} currentIndex={currentIndex} onOpen={() => setPlaylistSheetOpen(true)} />
            </ScrollView>
          ) : (
            <ScrollView style={styles.screen} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.homeContent}>
              <MobileHeader onRefresh={() => loadHomeFeed(activeTopic)} busy={busy} />
              <SearchBar query={query} setQuery={setQuery} runSearch={runSearch} busy={busy} />
              {screen !== "channel" && screen !== "subscriptions" ? <ChannelBubbles channels={channelBubbles} onOpen={openChannel} /> : null}
              {screen !== "channel" && screen !== "subscriptions" ? <ChipRow options={TOPIC_CHIPS.map((topic) => ({ value: topic.label, label: topic.label }))} value={activeTopic.label} onChange={(label) => chooseTopic(TOPIC_CHIPS.find((item) => item.label === label) || TOPIC_CHIPS[0])} /> : null}
              <Text style={styles.status}>{status}</Text>

              {screen === "channel" ? (
                <ChannelPanel channel={activeChannel} videos={channelVideos} subscribed={activeChannel ? isSubscribedChannel(activeChannel) : false} onPlay={playNow} onQueue={addToQueue} onSubscribe={() => activeChannel && toggleSubscription(activeChannel)} />
              ) : screen === "subscriptions" ? (
                <SubscriptionsPanel subscriptions={subscriptions} feed={feed} onOpen={openChannel} onPlay={playNow} onQueue={addToQueue} />
              ) : screen === "shorts" ? (
                <ShortsGrid videos={shortsVideos} onPlay={playNow} onQueue={addToQueue} />
              ) : screen === "you" ? (
                <YouPanel
                  apiBase={apiBase}
                  apiKey={apiKey}
                  updateApiBase={updateApiBase}
                  updateApiKey={updateApiKey}
                  mediaOptions={mediaOptions}
                  mediaType={mediaType}
                  updateMediaType={updateMediaType}
                  resolutionOptions={resolutionOptions}
                  resolution={resolution}
                  updateResolution={updateResolution}
                  history={history}
                  onPlay={playNow}
                  onQueue={addToQueue}
                />
              ) : (
                <>
                  {regularVideos.map((item) => (
                    <HomeVideoCard key={item.id || item.url} item={item} onPlay={playNow} onQueue={addToQueue} onPlaylist={() => openMixForVideo(item)} onChannel={() => openChannel(item)} />
                  ))}
                  {shortsVideos.length ? <ShortsShelf videos={shortsVideos} onPlay={playNow} onQueue={addToQueue} /> : null}
                </>
              )}
            </ScrollView>
          )}

          {screen !== "watch" && currentVideo ? (
            <MiniPlayer
              player={player}
              videoViewRef={videoViewRef}
              videoPanResponder={videoPanResponder}
              currentVideo={currentVideo}
              isPlaying={isPlaying}
              onPictureInPictureStart={() => setIsPictureInPicture(true)}
              onPictureInPictureStop={() => setIsPictureInPicture(false)}
              onOpen={() => setScreen("watch")}
              onPlay={togglePlayback}
              onClose={() => {
                player.pause();
                setCurrentVideo(null);
              }}
            />
          ) : null}

          <BottomNav active={screen} setScreen={setScreen} />

          {playlistSheetOpen ? (
            <PlaylistSheet
              playlist={activePlaylist}
              queue={queue}
              currentIndex={currentIndex}
              onClose={() => setPlaylistSheetOpen(false)}
              onPlay={(item, index) => playVideo(item, index)}
              onRemove={removeFromQueue}
              onClear={clearQueue}
            />
          ) : null}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function MobileHeader({ onRefresh, busy }) {
  return (
    <View style={styles.header}>
      <View style={styles.logoWrap}>
        <View style={styles.logoMark}><Text style={styles.logoPlay}>▶</Text></View>
        <Text style={styles.brand}>YouTube</Text>
      </View>
      <Pressable style={styles.headerIcon} onPress={onRefresh}>
        {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.headerIconText}>↻</Text>}
      </Pressable>
      <Text style={styles.headerIconText}>⌕</Text>
    </View>
  );
}

function WatchHeader({ onBack }) {
  return (
    <View style={styles.watchHeader}>
      <Pressable onPress={onBack} style={styles.backButton}><Text style={styles.backText}>⌄</Text></Pressable>
      <Text style={styles.watchHeaderTitle}>Watch</Text>
    </View>
  );
}

function SearchBar({ query, setQuery, runSearch, busy }) {
  return (
    <View style={styles.searchPanel}>
      <TextInput
        value={query}
        onChangeText={setQuery}
        onSubmitEditing={runSearch}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        placeholder="Search or paste video / playlist URL"
        placeholderTextColor="#777"
        style={styles.searchInput}
      />
      <Pressable style={styles.searchButton} onPress={runSearch}>
        {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.searchButtonText}>Search</Text>}
      </Pressable>
    </View>
  );
}

function PlayerSurface({ player, videoViewRef, videoPanResponder, currentVideo, progressPercent, bufferedPercent, onPictureInPictureStart, onPictureInPictureStop, setIsFullscreen }) {
  return (
    <View style={styles.videoShell} {...videoPanResponder.panHandlers}>
      <VideoView
        ref={videoViewRef}
        player={player}
        style={styles.player}
        nativeControls={false}
        allowsPictureInPicture
        startsPictureInPictureAutomatically={Boolean(currentVideo)}
        contentFit="contain"
        fullscreenOptions={{ enable: true, orientation: "landscape" }}
        onFullscreenEnter={() => setIsFullscreen(true)}
        onFullscreenExit={() => setIsFullscreen(false)}
        onPictureInPictureStart={onPictureInPictureStart}
        onPictureInPictureStop={onPictureInPictureStop}
      />
      {!currentVideo ? (
        <View style={styles.playerEmpty}>
          <Text style={styles.playerEmptyTitle}>Pick a video</Text>
          <Text style={styles.playerEmptyText}>Swipe up on the player for fullscreen.</Text>
        </View>
      ) : null}
      <View style={styles.progressTrack}>
        <View style={[styles.bufferedTrack, { width: `${bufferedPercent}%` }]} />
        <View style={[styles.progressFill, { width: `${progressPercent}%` }]} />
      </View>
    </View>
  );
}

function ActionRow({ isPlaying, isPictureInPicture, onPlay, onPrev, onNext, onCast, onPictureInPicture, onFullscreen, disabled }) {
  return (
    <View style={styles.actionStrip}>
      <RoundAction label="Prev" icon="⏮" disabled={disabled} onPress={onPrev} />
      <RoundAction label={isPlaying ? "Pause" : "Play"} icon={isPlaying ? "Ⅱ" : "▶"} disabled={disabled} onPress={onPlay} />
      <RoundAction label="Next" icon="⏭" disabled={disabled} onPress={onNext} />
      <RoundAction label="Cast" icon="▱" disabled={disabled} onPress={onCast} />
      <RoundAction label={isPictureInPicture ? "PiP on" : "PiP"} icon="▣" disabled={disabled} onPress={onPictureInPicture} />
      <RoundAction label="Full" icon="⛶" disabled={disabled} onPress={onFullscreen} />
    </View>
  );
}

function WatchChannelRow({ video, subscribed, onOpen, onSubscribe }) {
  if (!video) return null;
  return (
    <View style={styles.watchChannelRow}>
      <Pressable style={styles.watchChannelIdentity} onPress={onOpen}>
        <View style={styles.avatar}><Text style={styles.avatarText}>{initials(video.channel)}</Text></View>
        <View style={styles.cardCopy}>
          <Text style={styles.watchChannelName} numberOfLines={1}>{video.channel || "YouTube"}</Text>
          <Text style={styles.videoMeta} numberOfLines={1}>Open channel</Text>
        </View>
      </Pressable>
      <Pressable style={[styles.subscribeButton, subscribed && styles.subscribeButtonActive]} onPress={onSubscribe}>
        <Text style={[styles.subscribeButtonText, subscribed && styles.subscribeButtonTextActive]}>{subscribed ? "Subscribed" : "Subscribe"}</Text>
      </Pressable>
    </View>
  );
}

function RoundAction({ label, icon, onPress, disabled }) {
  return (
    <Pressable style={[styles.roundAction, disabled && styles.disabled]} disabled={disabled} onPress={onPress}>
      <Text style={styles.roundActionIcon}>{icon}</Text>
      <Text style={styles.roundActionText}>{label}</Text>
    </Pressable>
  );
}

function ChannelBubbles({ channels, onOpen }) {
  if (!channels.length) return null;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.channelRow}>
      {channels.map((channel) => (
        <Pressable key={channel.name} style={styles.channelBubble} onPress={() => onOpen(channel)}>
          <View style={styles.channelAvatar}><Text style={styles.channelAvatarText}>{initials(channel.name)}</Text></View>
          <Text style={styles.channelBubbleText} numberOfLines={1}>{channel.name}</Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

function ChipRow({ options, value, onChange }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
      {options.map((option) => (
        <Pressable key={option.value} style={[styles.chip, value === option.value && styles.chipActive]} onPress={() => onChange(option.value)}>
          <Text style={[styles.chipText, value === option.value && styles.chipTextActive]}>{option.label}</Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

function HomeVideoCard({ item, onPlay, onQueue, onPlaylist, onChannel }) {
  return (
    <View style={styles.homeCard}>
      <Pressable style={styles.homeThumbWrap} onPress={() => onPlay(item)}>
        {item.thumbnail ? <Image source={{ uri: item.thumbnail }} style={styles.thumb} /> : <View style={styles.thumbFallback} />}
        {item.duration ? <Text style={styles.duration}>{formatDuration(item.duration)}</Text> : null}
      </Pressable>
      <View style={styles.cardInfoRow}>
        <Pressable style={styles.avatar} onPress={onChannel}><Text style={styles.avatarText}>{initials(item.channel)}</Text></Pressable>
        <View style={styles.cardCopy}>
          <Text style={styles.videoTitle} numberOfLines={2}>{item.title || "Untitled video"}</Text>
          <Pressable onPress={onChannel}>
            <Text style={styles.videoMeta} numberOfLines={1}>{[item.channel, compactMeta(item)].filter(Boolean).join("  •  ")}</Text>
          </Pressable>
          <View style={styles.inlineActions}>
            <Pill label="Play" primary onPress={() => onPlay(item)} />
            <Pill label="Add" onPress={() => onQueue(item)} />
            <Pill label="Mix" onPress={onPlaylist} />
          </View>
        </View>
        <Text style={styles.moreDots}>⋮</Text>
      </View>
    </View>
  );
}

function ShortsShelf({ videos, onPlay, onQueue }) {
  return (
    <View style={styles.shelf}>
      <Text style={styles.shelfTitle}>Shorts</Text>
      <FlatList
        horizontal
        showsHorizontalScrollIndicator={false}
        data={videos.slice(0, 10)}
        keyExtractor={(item) => item.id || item.url}
        renderItem={({ item }) => <ShortCard item={item} onPlay={onPlay} onQueue={onQueue} />}
        contentContainerStyle={styles.shortsRow}
      />
    </View>
  );
}

function ShortsGrid({ videos, onPlay, onQueue }) {
  return (
    <View style={styles.shortsGrid}>
      {videos.map((item) => <ShortCard key={item.id || item.url} item={item} onPlay={onPlay} onQueue={onQueue} />)}
      {!videos.length ? <Text style={styles.empty}>No Shorts yet. Pick another topic or search.</Text> : null}
    </View>
  );
}

function ChannelPanel({ channel, videos, subscribed, onPlay, onQueue, onSubscribe }) {
  if (!channel) return <Text style={styles.empty}>Open a channel from a video.</Text>;
  return (
    <View>
      <View style={styles.channelHeaderPanel}>
        <View style={styles.channelHeaderAvatar}><Text style={styles.channelHeaderAvatarText}>{initials(channel.name)}</Text></View>
        <View style={styles.channelHeaderCopy}>
          <Text style={styles.channelHeaderTitle} numberOfLines={1}>{channel.name}</Text>
          <Text style={styles.videoMeta} numberOfLines={1}>{channel.url || "Channel"}</Text>
        </View>
        <Pressable style={[styles.subscribeButton, subscribed && styles.subscribeButtonActive]} onPress={onSubscribe}>
          <Text style={[styles.subscribeButtonText, subscribed && styles.subscribeButtonTextActive]}>{subscribed ? "Subscribed" : "Subscribe"}</Text>
        </Pressable>
      </View>
      {videos.map((item) => (
        <HomeVideoCard key={item.id || item.url} item={item} onPlay={onPlay} onQueue={onQueue} onPlaylist={() => onQueue(item)} />
      ))}
      {!videos.length ? <Text style={styles.empty}>No videos loaded for this channel yet.</Text> : null}
    </View>
  );
}

function SubscriptionsPanel({ subscriptions, feed, onOpen, onPlay, onQueue }) {
  const subscribedFeed = feed.filter((video) => subscriptions.some((channel) => channelKey(channel) === channelKey(channelFromVideo(video))));
  return (
    <View>
      <Text style={styles.sectionTitleText}>Subscriptions</Text>
      {subscriptions.map((channel) => <ChannelTile key={channelKey(channel)} channel={channel} onOpen={() => onOpen(channel)} />)}
      {!subscriptions.length ? <Text style={styles.empty}>Subscribe from a watch page and channels will appear here.</Text> : null}
      {subscribedFeed.length ? <Text style={styles.sectionTitleText}>From your channels</Text> : null}
      {subscribedFeed.map((item) => (
        <HomeVideoCard key={item.id || item.url} item={item} onPlay={onPlay} onQueue={onQueue} onPlaylist={() => onQueue(item)} onChannel={() => onOpen(item)} />
      ))}
    </View>
  );
}

function ChannelTile({ channel, onOpen }) {
  return (
    <Pressable style={styles.channelTile} onPress={onOpen}>
      <View style={styles.avatar}><Text style={styles.avatarText}>{initials(channel.name)}</Text></View>
      <View style={styles.cardCopy}>
        <Text style={styles.channelTileTitle} numberOfLines={1}>{channel.name}</Text>
        <Text style={styles.videoMeta} numberOfLines={1}>{channel.url || "Subscribed"}</Text>
      </View>
    </Pressable>
  );
}

function ShortCard({ item, onPlay, onQueue }) {
  return (
    <View style={styles.shortCard}>
      <Pressable style={styles.shortThumbWrap} onPress={() => onPlay(item)}>
        {item.thumbnail ? <Image source={{ uri: item.thumbnail }} style={styles.thumb} /> : <View style={styles.thumbFallback} />}
      </Pressable>
      <Text style={styles.shortTitle} numberOfLines={2}>{item.title || "Untitled short"}</Text>
      <View style={styles.inlineActions}>
        <Pill label="Play" primary onPress={() => onPlay(item)} />
        <Pill label="Add" onPress={() => onQueue(item)} />
      </View>
    </View>
  );
}

function YouPanel({ apiBase, apiKey, updateApiBase, updateApiKey, mediaOptions, mediaType, updateMediaType, resolutionOptions, resolution, updateResolution, history, onPlay, onQueue }) {
  return (
    <View>
      <View style={styles.settingsPanel}>
        <Text style={styles.label}>Resolver URL</Text>
        <TextInput value={apiBase} onChangeText={updateApiBase} autoCapitalize="none" autoCorrect={false} placeholder={DEFAULT_API_BASE} placeholderTextColor="#777" style={styles.input} />
        <Text style={styles.label}>Resolver key</Text>
        <TextInput value={apiKey} onChangeText={updateApiKey} autoCapitalize="none" autoCorrect={false} secureTextEntry placeholder="Optional" placeholderTextColor="#777" style={styles.input} />
      </View>
      <Text style={styles.sectionTitleText}>Media</Text>
      <ChipRow options={mediaOptions} value={mediaType} onChange={updateMediaType} />
      <Text style={styles.sectionTitleText}>Quality</Text>
      <ChipRow options={resolutionOptions} value={resolution} onChange={updateResolution} />
      <Text style={styles.sectionTitleText}>History</Text>
      {history.map((item) => <HomeVideoCard key={item.id || item.url} item={item} onPlay={onPlay} onQueue={onQueue} onPlaylist={() => onQueue(item)} />)}
      {!history.length ? <Text style={styles.empty}>Played videos will appear here.</Text> : null}
    </View>
  );
}

function MiniPlayer({ player, videoViewRef, videoPanResponder, currentVideo, isPlaying, onPictureInPictureStart, onPictureInPictureStop, onOpen, onPlay, onClose }) {
  return (
    <View style={styles.miniPlayer}>
      <Pressable style={styles.miniVideo} onPress={onOpen} {...videoPanResponder.panHandlers}>
        <VideoView
          ref={videoViewRef}
          player={player}
          style={styles.miniVideoView}
          nativeControls={false}
          allowsPictureInPicture
          startsPictureInPictureAutomatically={Boolean(currentVideo)}
          contentFit="cover"
          onPictureInPictureStart={onPictureInPictureStart}
          onPictureInPictureStop={onPictureInPictureStop}
        />
      </Pressable>
      <Pressable style={styles.miniText} onPress={onOpen}>
        <Text style={styles.miniTitle} numberOfLines={1}>{currentVideo.title}</Text>
        <Text style={styles.videoMeta} numberOfLines={1}>{currentVideo.channel}</Text>
      </Pressable>
      <Pressable style={styles.miniButton} onPress={onPlay}><Text style={styles.miniButtonText}>{isPlaying ? "Ⅱ" : "▶"}</Text></Pressable>
      <Pressable style={styles.miniButton} onPress={onClose}><Text style={styles.miniButtonText}>×</Text></Pressable>
    </View>
  );
}

function BottomNav({ active, setScreen }) {
  const items = [
    ["home", "⌂", "Home"],
    ["shorts", "♬", "Shorts"],
    ["create", "+", ""],
    ["subscriptions", "▣", "Subscriptions"],
    ["you", "b", "You"],
  ];
  return (
    <View style={styles.bottomNav}>
      {items.map(([key, icon, label]) => (
        <Pressable key={key} style={styles.navItem} onPress={() => key !== "create" && setScreen(key)}>
          <Text style={[styles.navIcon, active === key && styles.navActive]}>{icon}</Text>
          {label ? <Text style={[styles.navText, active === key && styles.navActive]}>{label}</Text> : null}
        </Pressable>
      ))}
    </View>
  );
}

function PlaylistPreview({ queue, currentIndex, onOpen }) {
  if (!queue.length) return null;
  const current = queue[currentIndex] || queue[0];
  return (
    <Pressable style={styles.playlistPreview} onPress={onOpen}>
      <Text style={styles.playlistPreviewTitle}>Mix - {current?.channel || "YouTube"}</Text>
      <Text style={styles.videoMeta}>{queue.length} videos in playlist</Text>
    </Pressable>
  );
}

function PlaylistSheet({ playlist, queue, currentIndex, onClose, onPlay, onRemove, onClear }) {
  return (
    <View style={styles.sheetBackdrop}>
      <View style={styles.playlistSheet}>
        <View style={styles.sheetHandle} />
        <View style={styles.sheetHeader}>
          <View style={styles.sheetTitleWrap}>
            <Text style={styles.sheetTitle} numberOfLines={1}>{playlist?.title || "Playlist"}</Text>
            <Text style={styles.videoMeta}>{queue.length} videos</Text>
          </View>
          <Pressable onPress={onClear}><Text style={styles.sheetAction}>Clear</Text></Pressable>
          <Pressable onPress={onClose}><Text style={styles.sheetClose}>×</Text></Pressable>
        </View>
        <FlatList
          data={queue}
          keyExtractor={(item) => item.uid || item.id || item.url}
          renderItem={({ item, index }) => (
            <QueueItem item={item} active={index === currentIndex} onPlay={() => onPlay(item, index)} onRemove={() => onRemove(index)} />
          )}
        />
      </View>
    </View>
  );
}

function QueueItem({ item, active, onPlay, onRemove }) {
  return (
    <View style={[styles.queueItem, active && styles.queueItemActive]}>
      <Text style={styles.dragHandle}>≡</Text>
      <Pressable onPress={onPlay}>
        {item.thumbnail ? <Image source={{ uri: item.thumbnail }} style={styles.queueThumb} /> : <View style={styles.queueThumbFallback} />}
      </Pressable>
      <View style={styles.queueText}>
        <Text style={styles.queueTitle} numberOfLines={2}>{item.title || "Untitled video"}</Text>
        <Text style={styles.videoMeta} numberOfLines={1}>{[item.channel, compactMeta(item)].filter(Boolean).join("  •  ")}</Text>
      </View>
      <Pressable style={styles.removeButton} onPress={onRemove}><Text style={styles.removeText}>⋮</Text></Pressable>
    </View>
  );
}

function ControlButton({ label, onPress, disabled = false }) {
  return (
    <Pressable disabled={disabled} style={[styles.controlButton, disabled && styles.disabled]} onPress={onPress}>
      <Text style={styles.controlText}>{label}</Text>
    </Pressable>
  );
}

function Pill({ label, onPress, primary = false }) {
  return (
    <Pressable style={[styles.pill, primary && styles.pillPrimary]} onPress={onPress}>
      <Text style={[styles.pillText, primary && styles.pillTextPrimary]}>{label}</Text>
    </Pressable>
  );
}

function FallbackCastButton({ style }) {
  return (
    <View style={[styles.fallbackCastButton, style]}>
      <Text style={styles.fallbackCastText}>Cast</Text>
    </View>
  );
}

function parseStoredArray(value) {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function persistList(key, value) {
  AsyncStorage.setItem(key, JSON.stringify(value)).catch(() => {});
}

function cleanVideo(video) {
  const url = video.webpage_url || video.url || "";
  return {
    id: video.id || videoIdFromUrl(url),
    title: decodeEntities(video.title || url || "Untitled video"),
    url,
    webpage_url: url,
    channel: decodeEntities(video.channel || video.uploader || "YouTube"),
    channel_url: video.channel_url || video.uploader_url || "",
    thumbnail: video.thumbnail || thumbnailFromUrl(url),
    duration: Number(video.duration || 0),
    upload_date: video.upload_date || video.publishedAt || "",
    view_count: Number(video.view_count || video.viewCount || 0),
    is_short: video.is_short === true || video.isShort === true,
  };
}

function channelFromVideo(video) {
  return cleanChannel({
    name: video?.channel || "YouTube",
    url: video?.channel_url || "",
    thumbnail: video?.channel_thumbnail || video?.thumbnail || "",
  });
}

function cleanChannel(channel) {
  return {
    name: decodeEntities(channel?.name || channel?.title || channel?.channel || ""),
    url: channel?.url || channel?.channel_url || "",
    thumbnail: channel?.thumbnail || "",
  };
}

function channelKey(channel) {
  const clean = cleanChannel(channel);
  return (clean.url || clean.name).trim().toLowerCase();
}

function queueItemFromVideo(video) {
  return {
    ...cleanVideo(video),
    uid: video.uid || `${Date.now()}-${Math.random().toString(16).slice(2)}`,
  };
}

function queueItemForStorage(video) {
  return {
    uid: video.uid,
    id: video.id,
    title: video.title,
    url: video.url,
    webpage_url: video.webpage_url,
    channel: video.channel,
    channel_url: video.channel_url,
    thumbnail: video.thumbnail,
    duration: video.duration,
    upload_date: video.upload_date,
    view_count: video.view_count,
    is_short: video.is_short,
  };
}

function splitVideoKinds(videos) {
  const regularVideos = [];
  const shortsVideos = [];
  for (const video of dedupeVideos(videos)) {
    if (isShortVideo(video)) shortsVideos.push(video);
    else regularVideos.push(video);
  }
  return { regularVideos, shortsVideos };
}

function dedupeVideos(videos) {
  const seen = new Set();
  const output = [];
  for (const video of videos) {
    const key = video?.id || video?.url;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    output.push(video);
  }
  return output;
}

function isShortVideo(video) {
  if (video?.is_short === true || video?.isShort === true) return true;
  const duration = Number(video?.duration || 0);
  const urlText = `${video?.url || ""} ${video?.webpage_url || ""}`;
  if (/\/shorts\//i.test(urlText)) return true;
  const text = `${video?.title || ""} ${video?.description || ""}`;
  if (/(^|[^\w])#shorts?\b/i.test(text)) return true;
  return (duration > 0 && duration <= SHORTS_LEGACY_MAX_SECONDS) || (duration > 0 && duration <= SHORTS_MAX_SECONDS && /short/i.test(text));
}

function uniqueChannels(videos) {
  const seen = new Set();
  const channels = [];
  for (const video of videos) {
    const channel = channelFromVideo(video);
    const key = channelKey(channel);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    channels.push(channel);
  }
  return channels;
}

function videoFromUrl(url) {
  return cleanVideo({ id: videoIdFromUrl(url), title: url, url, webpage_url: url, channel: "Direct URL", thumbnail: thumbnailFromUrl(url) });
}

function isUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function isPlaylistUrl(value) {
  if (!isUrl(value)) return false;
  try {
    const parsed = new URL(value);
    return Boolean(parsed.searchParams.get("list")) || /\/playlist\b/i.test(parsed.pathname);
  } catch {
    return false;
  }
}

function isNgrokFreeUrl(value) {
  try {
    return new URL(value).hostname.endsWith(".ngrok-free.dev");
  } catch {
    return false;
  }
}

function videoIdFromUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.hostname.includes("youtu.be")) return parsed.pathname.replace(/^\/+/, "") || "";
    const shortsMatch = parsed.pathname.match(/\/shorts\/([^/?#]+)/);
    return shortsMatch?.[1] || parsed.searchParams.get("v") || "";
  } catch {
    return "";
  }
}

function thumbnailFromUrl(url) {
  const id = videoIdFromUrl(url);
  return id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : "";
}

function readError(payload, status) {
  if (typeof payload.detail === "string") return payload.detail;
  if (Array.isArray(payload.detail)) return payload.detail.map((item) => item.msg || item.type).join("; ");
  return `Request failed with status ${status}`;
}

function optionList(base, extra, labeler) {
  return [...new Set([...base, ...extra].filter(Boolean))].map((value) => ({ value, label: labeler(value) }));
}

function mediaTypeKey(format) {
  const protocol = String(format.protocol || "").toLowerCase();
  const ext = String(format.ext || "").toLowerCase();
  if (protocol.includes("m3u8") || ext === "m3u8") return "m3u8";
  return ext || protocol || "other";
}

function mediaTypeLabel(value) {
  const labels = { auto: "Auto", m3u8: "HLS", mp4: "MP4", webm: "WebM", m4a: "M4A", mp3: "MP3" };
  return labels[value] || String(value).toUpperCase();
}

function resolutionLabel(value) {
  if (value === "auto") return "Auto";
  if (value === "audio") return "Audio";
  return `${value}p`;
}

function sortResolutionValues(left, right) {
  if (left === "auto") return -1;
  if (right === "auto") return 1;
  if (left === "audio") return 1;
  if (right === "audio") return -1;
  return Number(right) - Number(left);
}

function isUsableFormat(format) {
  const hasMedia = format.vcodec !== "none" || format.acodec !== "none";
  return Boolean(format.url && format.format_id && hasMedia);
}

function selectedFormatFromAvailable(formats, mediaType, resolution) {
  const maxHeight = Number(resolution);
  return formats
    .filter((format) => mediaType === "auto" || mediaTypeKey(format) === mediaType)
    .filter((format) => {
      if (resolution === "auto") return format.vcodec !== "none";
      if (resolution === "audio") return format.acodec !== "none" && format.vcodec === "none";
      return Number(format.height || 0) > 0 && Number(format.height) <= maxHeight;
    })
    .sort((left, right) => formatScore(right, mediaType) - formatScore(left, mediaType))[0] || null;
}

function formatScore(format, mediaType) {
  const hasVideo = format.vcodec !== "none";
  const hasAudio = format.acodec !== "none";
  const combined = hasVideo && hasAudio ? 100000000 : hasVideo ? 50000000 : hasAudio ? 10000000 : 0;
  const hlsPenalty = mediaType === "auto" && mediaTypeKey(format) === "m3u8" ? 20000000 : 0;
  return combined - hlsPenalty + Number(format.height || 0) * 1000 + Number(format.tbr || format.vbr || format.abr || 0);
}

function selectorFromControls(mediaType, resolution) {
  const heightFilter = /^\d+$/.test(resolution) ? `[height<=${resolution}]` : "";
  const hasAudioVideo = "[vcodec!=none][acodec!=none]";
  if (resolution === "audio") return mediaType === "auto" ? "bestaudio/best" : `bestaudio[ext=${mediaType}]/bestaudio/best`;
  if (mediaType === "auto") return heightFilter ? `best${heightFilter}${hasAudioVideo}/best${heightFilter}/best` : DEFAULT_FORMAT;
  if (mediaType === "m3u8") return heightFilter ? `best[protocol*=m3u8]${heightFilter}/best[protocol*=m3u8]/best${heightFilter}/best` : "best[protocol*=m3u8]/best";
  return heightFilter
    ? `best[ext=${mediaType}]${heightFilter}${hasAudioVideo}/best[ext=${mediaType}]${heightFilter}/best${heightFilter}/best`
    : `best[ext=${mediaType}]${hasAudioVideo}/best[ext=${mediaType}]/best`;
}

function playbackUrlForPayload(apiBase, apiKey, sourceUrl, format, payload) {
  if (isNgrokFreeUrl(apiBase) && payload?.direct_url) return payload.direct_url;
  const cleanBase = normalizeApiBase(apiBase);
  const params = new URLSearchParams({ url: sourceUrl });
  const effectiveFormat = payload?.format_fallback ? "" : format;
  if (effectiveFormat) params.set("video_format", effectiveFormat);
  if (apiKey) params.set("api_key", apiKey);
  return `${cleanBase}/stream?${params.toString()}`;
}

function normalizeApiBase(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const url = new URL(raw);
    url.hash = "";
    url.search = "";
    url.pathname = url.pathname
      .replace(/\/+(channels\/(?:search|videos)|resolve|formats|playlist|stream|search|docs|health)\/?$/i, "")
      .replace(/\/+$/, "");
    return url.toString().replace(/\/+$/, "");
  } catch {
    return raw
      .replace(/\/+(channels\/(?:search|videos)|resolve|formats|playlist|stream|search|docs|health)\/?$/i, "")
      .replace(/\/+$/, "");
  }
}

function isHlsPayload(payload, streamUrl = "") {
  const protocol = String(payload?.protocol || "").toLowerCase();
  const ext = String(payload?.ext || "").toLowerCase();
  const directUrl = String(payload?.direct_url || streamUrl || "").toLowerCase();
  return protocol.includes("m3u8") || ext === "m3u8" || directUrl.includes(".m3u8");
}

function contentTypeForPayload(payload, streamUrl) {
  if (isHlsPayload(payload, streamUrl)) return "application/x-mpegURL";
  const ext = String(payload?.ext || "").toLowerCase();
  if (ext === "webm") return "video/webm";
  if (ext === "mp3") return "audio/mpeg";
  if (ext === "m4a") return "audio/mp4";
  return "video/mp4";
}

function isResolvedExpired(payload) {
  if (!payload?.expires_at) return false;
  const expiresAt = new Date(payload.expires_at).getTime();
  return Number.isFinite(expiresAt) && expiresAt < Date.now() + 5 * 60 * 1000;
}

function cacheKey(apiBase, apiKey, url, format) {
  return `${apiBase}|${apiKey}|${url}|${format}`;
}

function sameVideo(left, right) {
  return sameUrl(left?.url, right?.url) || (left?.id && right?.id && left.id === right.id);
}

function sameUrl(left, right) {
  return String(left || "").replace(/\/+$/, "") === String(right || "").replace(/\/+$/, "");
}

function compactMeta(video) {
  const parts = [];
  if (video.view_count) parts.push(`${formatNumber(video.view_count)} views`);
  if (video.upload_date) parts.push(video.upload_date);
  return parts.join(" • ");
}

function castStateLabel(value) {
  const label = String(value || "");
  if (label === CAST_UNAVAILABLE) return "Cast build required";
  return label ? `Cast ${label}` : "";
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function initials(value) {
  return String(value || "YT").trim().slice(0, 2).toUpperCase();
}

function formatNumber(value) {
  return new Intl.NumberFormat(undefined, { notation: "compact" }).format(Number(value || 0));
}

function formatDuration(seconds) {
  const value = Number(seconds);
  if (!Number.isFinite(value) || value <= 0) return "";
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  const rest = Math.floor(value % 60).toString().padStart(2, "0");
  if (hours) return `${hours}:${minutes.toString().padStart(2, "0")}:${rest}`;
  return `${minutes}:${rest}`;
}

function decodeEntities(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function windowSafeTimeout(callback, delay) {
  setTimeout(callback, delay);
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: "#0f0f0f",
  },
  appShell: {
    flex: 1,
    position: "relative",
  },
  screen: {
    flex: 1,
    backgroundColor: "#0f0f0f",
  },
  homeContent: {
    paddingHorizontal: 14,
    paddingBottom: 170,
  },
  watchContent: {
    paddingBottom: 170,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingTop: 12,
    paddingBottom: 12,
  },
  logoWrap: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  logoMark: {
    width: 36,
    height: 26,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 7,
    backgroundColor: "#ff0033",
  },
  logoPlay: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "900",
  },
  brand: {
    color: "#f1f1f1",
    fontSize: 31,
    fontWeight: "900",
  },
  headerIcon: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  headerIconText: {
    color: "#f1f1f1",
    fontSize: 34,
  },
  watchHeader: {
    height: 46,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    backgroundColor: "#000",
  },
  backButton: {
    width: 42,
    height: 42,
    alignItems: "center",
    justifyContent: "center",
  },
  backText: {
    color: "#fff",
    fontSize: 34,
  },
  watchHeaderTitle: {
    color: "#f1f1f1",
    fontSize: 17,
    fontWeight: "900",
  },
  searchPanel: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 14,
  },
  searchInput: {
    flex: 1,
    minHeight: 44,
    borderRadius: 999,
    backgroundColor: "#1b1b1b",
    color: "#f1f1f1",
    paddingHorizontal: 16,
  },
  searchButton: {
    minWidth: 82,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 999,
    backgroundColor: "#ff0033",
    paddingHorizontal: 14,
  },
  searchButtonText: {
    color: "#fff",
    fontWeight: "900",
  },
  channelRow: {
    gap: 22,
    paddingVertical: 4,
    paddingRight: 20,
  },
  channelBubble: {
    width: 72,
    gap: 7,
    alignItems: "center",
  },
  channelAvatar: {
    width: 68,
    height: 68,
    borderRadius: 34,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#303030",
  },
  channelAvatarText: {
    color: "#fff",
    fontWeight: "900",
    fontSize: 19,
  },
  channelBubbleText: {
    color: "#ddd",
    fontSize: 12,
    width: "100%",
    textAlign: "center",
  },
  chipRow: {
    gap: 10,
    paddingVertical: 14,
    paddingRight: 16,
  },
  chip: {
    minHeight: 42,
    justifyContent: "center",
    borderRadius: 10,
    backgroundColor: "#252525",
    paddingHorizontal: 18,
  },
  chipActive: {
    backgroundColor: "#f1f1f1",
  },
  chipText: {
    color: "#f1f1f1",
    fontSize: 16,
    fontWeight: "800",
  },
  chipTextActive: {
    color: "#101010",
  },
  status: {
    color: "#9a9a9a",
    fontSize: 12,
    marginBottom: 8,
  },
  homeCard: {
    gap: 10,
    marginBottom: 24,
  },
  homeThumbWrap: {
    width: "100%",
    aspectRatio: 16 / 9,
    overflow: "hidden",
    borderRadius: 10,
    backgroundColor: "#242424",
  },
  thumb: {
    width: "100%",
    height: "100%",
  },
  thumbFallback: {
    flex: 1,
    backgroundColor: "#242424",
  },
  duration: {
    position: "absolute",
    right: 7,
    bottom: 7,
    overflow: "hidden",
    borderRadius: 5,
    backgroundColor: "rgba(0,0,0,0.84)",
    color: "#fff",
    fontSize: 12,
    fontWeight: "900",
    paddingHorizontal: 5,
    paddingVertical: 2,
  },
  cardInfoRow: {
    flexDirection: "row",
    gap: 12,
  },
  avatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#4a4a4a",
  },
  avatarText: {
    color: "#fff",
    fontWeight: "900",
  },
  cardCopy: {
    flex: 1,
    gap: 5,
  },
  videoTitle: {
    color: "#f1f1f1",
    fontSize: 17,
    fontWeight: "900",
    lineHeight: 22,
  },
  videoMeta: {
    color: "#aaa",
    fontSize: 13,
  },
  moreDots: {
    color: "#fff",
    fontSize: 24,
    paddingHorizontal: 4,
  },
  inlineActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 7,
    marginTop: 3,
  },
  pill: {
    minHeight: 30,
    justifyContent: "center",
    borderRadius: 999,
    backgroundColor: "#242424",
    paddingHorizontal: 12,
  },
  pillPrimary: {
    backgroundColor: "#f1f1f1",
  },
  pillText: {
    color: "#f1f1f1",
    fontSize: 12,
    fontWeight: "900",
  },
  pillTextPrimary: {
    color: "#0f0f0f",
  },
  shelf: {
    marginBottom: 24,
  },
  shelfTitle: {
    color: "#f1f1f1",
    fontSize: 22,
    fontWeight: "900",
    marginBottom: 12,
  },
  shortsRow: {
    gap: 12,
    paddingRight: 12,
  },
  shortsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  shortCard: {
    width: 156,
    gap: 7,
  },
  shortThumbWrap: {
    width: "100%",
    aspectRatio: 9 / 16,
    overflow: "hidden",
    borderRadius: 10,
    backgroundColor: "#242424",
  },
  shortTitle: {
    color: "#f1f1f1",
    fontSize: 13,
    fontWeight: "900",
    lineHeight: 17,
  },
  videoShell: {
    position: "relative",
    overflow: "hidden",
    backgroundColor: "#000",
  },
  player: {
    width: "100%",
    aspectRatio: 16 / 9,
    backgroundColor: "#000",
  },
  playerEmpty: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    backgroundColor: "rgba(0,0,0,0.28)",
  },
  playerEmptyTitle: {
    color: "#f1f1f1",
    fontSize: 16,
    fontWeight: "900",
  },
  playerEmptyText: {
    color: "#aaa",
    fontSize: 12,
  },
  progressTrack: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: 4,
    backgroundColor: "rgba(255,255,255,0.2)",
  },
  bufferedTrack: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: "rgba(255,255,255,0.34)",
  },
  progressFill: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: "#ff0033",
  },
  watchTitle: {
    color: "#f1f1f1",
    fontSize: 24,
    fontWeight: "900",
    lineHeight: 31,
    paddingHorizontal: 16,
    paddingTop: 18,
  },
  watchMeta: {
    color: "#aaa",
    fontSize: 15,
    paddingHorizontal: 16,
    paddingTop: 6,
  },
  watchChannelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 14,
  },
  watchChannelIdentity: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  watchChannelName: {
    color: "#f1f1f1",
    fontSize: 16,
    fontWeight: "900",
  },
  subscribeButton: {
    minHeight: 36,
    justifyContent: "center",
    borderRadius: 999,
    backgroundColor: "#f1f1f1",
    paddingHorizontal: 16,
  },
  subscribeButtonActive: {
    backgroundColor: "#2d2d2d",
  },
  subscribeButtonText: {
    color: "#0f0f0f",
    fontSize: 13,
    fontWeight: "900",
  },
  subscribeButtonTextActive: {
    color: "#f1f1f1",
  },
  actionStrip: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-around",
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 18,
  },
  roundAction: {
    width: 52,
    alignItems: "center",
    gap: 4,
  },
  roundActionIcon: {
    color: "#fff",
    fontSize: 28,
  },
  roundActionText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "800",
  },
  controls: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  controlButton: {
    minHeight: 36,
    justifyContent: "center",
    borderRadius: 999,
    backgroundColor: "#242424",
    paddingHorizontal: 14,
  },
  controlText: {
    color: "#f1f1f1",
    fontSize: 12,
    fontWeight: "900",
  },
  disabled: {
    opacity: 0.42,
  },
  commentsCard: {
    margin: 16,
    padding: 14,
    borderRadius: 18,
    backgroundColor: "#1b1b1b",
  },
  commentsTitle: {
    color: "#f1f1f1",
    fontSize: 18,
    fontWeight: "900",
    marginBottom: 8,
  },
  commentText: {
    color: "#bbb",
    fontSize: 14,
    lineHeight: 20,
  },
  playlistPreview: {
    marginHorizontal: 16,
    padding: 14,
    borderRadius: 14,
    backgroundColor: "#1b1b1b",
  },
  playlistPreviewTitle: {
    color: "#f1f1f1",
    fontSize: 17,
    fontWeight: "900",
  },
  settingsPanel: {
    gap: 8,
    marginTop: 4,
    marginBottom: 18,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#303030",
    backgroundColor: "#151515",
  },
  label: {
    color: "#aaa",
    fontSize: 11,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  input: {
    minHeight: 42,
    borderWidth: 1,
    borderColor: "#3f3f3f",
    borderRadius: 7,
    backgroundColor: "#101010",
    color: "#f1f1f1",
    paddingHorizontal: 12,
  },
  sectionTitleText: {
    color: "#f1f1f1",
    fontSize: 18,
    fontWeight: "900",
    marginTop: 14,
    marginBottom: 8,
  },
  channelHeaderPanel: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 18,
    paddingVertical: 12,
  },
  channelHeaderAvatar: {
    width: 74,
    height: 74,
    borderRadius: 37,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#303030",
  },
  channelHeaderAvatarText: {
    color: "#fff",
    fontSize: 23,
    fontWeight: "900",
  },
  channelHeaderCopy: {
    flex: 1,
    minWidth: 0,
  },
  channelHeaderTitle: {
    color: "#f1f1f1",
    fontSize: 24,
    fontWeight: "900",
  },
  channelTile: {
    minHeight: 64,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 10,
    padding: 10,
    borderRadius: 10,
    backgroundColor: "#181818",
  },
  channelTileTitle: {
    color: "#f1f1f1",
    fontSize: 16,
    fontWeight: "900",
  },
  miniPlayer: {
    position: "absolute",
    left: 14,
    right: 14,
    bottom: 82,
    minHeight: 74,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 8,
    borderRadius: 14,
    backgroundColor: "rgba(26,26,26,0.96)",
  },
  miniVideo: {
    width: 124,
    aspectRatio: 16 / 9,
    overflow: "hidden",
    borderRadius: 10,
    backgroundColor: "#000",
  },
  miniVideoView: {
    width: "100%",
    height: "100%",
  },
  miniText: {
    flex: 1,
  },
  miniTitle: {
    color: "#f1f1f1",
    fontSize: 13,
    fontWeight: "900",
  },
  miniButton: {
    width: 38,
    height: 38,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 19,
    backgroundColor: "#343434",
  },
  miniButtonText: {
    color: "#fff",
    fontSize: 22,
    fontWeight: "900",
  },
  bottomNav: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: 74,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-around",
    borderTopWidth: 1,
    borderTopColor: "#303030",
    backgroundColor: "rgba(18,18,18,0.98)",
  },
  navItem: {
    alignItems: "center",
    justifyContent: "center",
    minWidth: 62,
  },
  navIcon: {
    color: "#f1f1f1",
    fontSize: 30,
    fontWeight: "900",
  },
  navText: {
    color: "#f1f1f1",
    fontSize: 11,
    marginTop: 2,
  },
  navActive: {
    color: "#ffffff",
  },
  sheetBackdrop: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.22)",
  },
  playlistSheet: {
    maxHeight: "62%",
    paddingTop: 10,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    backgroundColor: "#111",
  },
  sheetHandle: {
    alignSelf: "center",
    width: 72,
    height: 5,
    borderRadius: 999,
    backgroundColor: "#555",
    marginBottom: 12,
  },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  sheetTitleWrap: {
    flex: 1,
  },
  sheetTitle: {
    color: "#f1f1f1",
    fontSize: 22,
    fontWeight: "900",
  },
  sheetAction: {
    color: "#3ea6ff",
    fontWeight: "900",
  },
  sheetClose: {
    color: "#fff",
    fontSize: 34,
  },
  queueItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  queueItemActive: {
    backgroundColor: "#252018",
  },
  dragHandle: {
    color: "#bbb",
    fontSize: 24,
  },
  queueThumb: {
    width: 124,
    aspectRatio: 16 / 9,
    borderRadius: 8,
    backgroundColor: "#242424",
  },
  queueThumbFallback: {
    width: 124,
    aspectRatio: 16 / 9,
    borderRadius: 8,
    backgroundColor: "#242424",
  },
  queueText: {
    flex: 1,
  },
  queueTitle: {
    color: "#f1f1f1",
    fontSize: 14,
    fontWeight: "800",
    lineHeight: 19,
  },
  removeButton: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  removeText: {
    color: "#fff",
    fontSize: 24,
  },
  fallbackCastButton: {
    alignItems: "center",
    justifyContent: "center",
  },
  fallbackCastText: {
    color: "#aaa",
    fontSize: 10,
    fontWeight: "800",
  },
  empty: {
    color: "#888",
    paddingVertical: 10,
  },
});
