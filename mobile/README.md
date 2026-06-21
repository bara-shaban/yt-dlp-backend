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

On a physical phone, set the API URL in the app to your computer LAN IP or deployed Render URL, for example:

```text
http://192.168.1.20:10001
```

Android emulators can use:

```text
http://10.0.2.2:10001
```

The app supports:

- YouTube search through `/search`
- YouTube playlist loading through `/playlist`
- Resolver playback through `/resolve` and `/stream`
- Quality chips backed by `/formats`
- Queue, playlist, and watch history persistence
- Regular video and Shorts separation
- Chromecast handoff through `react-native-google-cast`
- Swipe up on the video surface to enter fullscreen
