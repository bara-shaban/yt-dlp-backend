# AI-Wa7shTube Mobile

Expo React Native client for the `yt-dlp-backend` resolver.

## Run

```bash
npm install
npm run ios
# or
npm run android
```

Use a development build for Chromecast because `react-native-google-cast` is a native module and is not available inside Expo Go.

On a physical phone, the app now defaults to:

```text
https://organic-space-goggles-4jwg4v79r5rpc5qg5-10000.app.github.dev
```

If you need another backend, set the API URL in the app to your computer LAN IP or deployed resolver URL, for example:

```text
http://192.168.1.20:10001
```

Android emulators can use:

```text
http://10.0.2.2:10001
```

If the backend requires an API key, enter it in the You tab. For internal EAS builds you can also provide:

```text
EXPO_PUBLIC_RESOLVER_URL
EXPO_PUBLIC_RESOLVER_API_KEY
```

Those values are bundled into the app, so use them only for internal APK/ad hoc builds. The GitHub Pages website reads `RESOLVER_API_KEY` and `GOOGLE_CLIENT_ID` from repository secrets during the Pages deploy workflow.

The web app now supports official Google OAuth account import for YouTube subscriptions and playlists. The mobile app still uses backend search plus local subscriptions/playlists until a native Google OAuth client is configured for iOS and Android. The public YouTube Data API does not provide the exact personalized Home, For You, or Shorts recommendation feeds.

## Share on real phones

The build scripts use `npx eas-cli`, so they can fetch the EAS CLI when needed. You can also install it once globally:

```bash
npm install -g eas-cli
```

Build a shareable Android APK:

```bash
npm run build:android:apk
```

When EAS finishes, open the build URL on an Android phone and install the APK. For iPhone, use:

```bash
npm run build:ios:preview
```

iOS internal builds require a paid Apple Developer account and registered device UDIDs. For wider iPhone sharing, create a production/TestFlight build with `npm run build:ios:production`.

The app supports:

- YouTube search through `/search`
- YouTube playlist loading through `/playlist`
- Resolver playback through `/resolve` and `/stream`
- Quality chips backed by `/formats`
- Queue, playlist, and watch history persistence
- Picture in Picture on supported iOS/Android builds
- Regular video and Shorts separation
- Chromecast handoff through `react-native-google-cast`
- Swipe up on the video surface to enter fullscreen
