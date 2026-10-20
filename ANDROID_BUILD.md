# Build the Android APK

This app uses Capacitor. The web app is bundled into the Android project; a backend is not needed to launch the frontend.

## Build with Android Studio

1. Install Android Studio with Android SDK 36 and JDK 21.
2. From the project folder run `npm install` and `npm run build`.
3. Run `npx cap sync android`.
4. Open the `android` folder in Android Studio and wait for Gradle sync.
5. Select **Build > Build Bundle(s) / APK(s) > Build APK(s)**.

The debug APK is written to `android/app/build/outputs/apk/debug/app-debug.apk`.

## Build from a terminal

On a machine where Gradle can start its local daemon, run:

```powershell
npm install
npm run build
npx cap sync android
cd android
.\gradlew.bat assembleDebug
```

The APK is a debug build for local installation. Create a signed release build separately before distribution.
