// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

const { withMainActivity } = require("expo/config-plugins");
const {
  mergeContents,
} = require("@expo/config-plugins/build/utils/generateCode");

/**
 * Tag written into the generated MainActivity so the mod is idempotent. Expo
 * runs prebuild mods repeatedly, and `expo prebuild` can be run against an
 * existing `android/` directory, so an unconditional insert would stack.
 */
const TAG = "lisa-splash-no-client-exit";

/**
 * Anchor. `super.onCreate(null)` is React Native's own template line, not one
 * of expo-splash-screen's `@generated` markers, so this does not depend on
 * expo-splash-screen's marker text staying stable. expo-splash-screen anchors
 * its own `SplashScreenManager.registerOnActivity(this)` on the same line at
 * offset 0 (immediately BEFORE it), so inserting at offset 1 lands after both
 * the registration and `super.onCreate` — the Activity is fully attached, and
 * still far ahead of `onResume`, which is where the platform latches whether
 * the app handles the splash exit.
 */
const ANCHOR = /super\.onCreate\(null\)/;

/**
 * Kotlin inserted into `MainActivity.onCreate`.
 *
 * `android.os.Build` is fully qualified on purpose: the RN template happens to
 * import it today, but relying on that would make this plugin fail to compile
 * the first time the template drops the import.
 */
const SNIPPET = `    // Opt out of the Android 12+ client-side splash-exit handshake.
    //
    // expo-splash-screen's SplashScreenManager.registerOnActivity() always calls
    // splashScreen.setOnExitAnimationListener(), which latches
    // ActivityRecord.mHandleExitSplashScreen = true on the server at
    // resume-report time. That switches on the cross-process transfer state
    // machine: COPYING -> ATTACH_TO_CLIENT -> FINISH. On entering
    // ATTACH_TO_CLIENT the system arms TRANSFER_SPLASH_SCREEN_TIMEOUT (2000ms)
    // and hands over the splash bitmap; the app must then build a
    // SplashScreenView, attach it, and call reportSplashScreenAttached -- which
    // ActivityThread gates behind an onPreDraw plus a postOnAnimation, so it
    // requires the UI thread to COMPLETE A FRAME.
    //
    // Miss those 2000ms and the server takes the timeout path, which (unlike
    // the success path) skips mStartingWindow.cancelAnimation() and still asks
    // for a reveal animation. Two STARTING_REVEAL animations then exist -- one
    // on the starting window, one on the main window -- and the cancel loop in
    // WindowState#removeIfPossible short-circuits on the first match, so the
    // main window's reveal is never cancelled. StartingWindowAnimationAdaptor
    // discards its finish callback, so nothing else ends it: WindowManager
    // believes the activity is animating until it is destroyed.
    //
    // UiAutomation.injectInputEvent(event, sync) implies waitForAnimations=true,
    // which blocks in WindowManagerService#waitForAnimationsToComplete for
    // ANIMATION_COMPLETED_TIMEOUT_MS (5000ms), TWICE per gesture. Automated taps
    // then cost ~10s and per-character text entry breaches the driver's
    // deadline. On a 2-core software-GL emulator frames cost 700-1900ms, so
    // 2000ms is one to three frames of budget.
    //
    // Clearing the listener removes the failure mode rather than making it less
    // likely: with no exit listener registered, mHandleExitSplashScreen stays
    // false, transferSplashScreenIfNeeded() returns immediately, and the state
    // machine never leaves TRANSFER_SPLASH_SCREEN_IDLE. There is no copy, no
    // attach, no 2000ms deadline, and no second reveal to strand. The system
    // performs the splash exit itself, as it does for any app that does not opt
    // in.
    //
    // Cost: the 400ms alpha fade of the splash VIEW. The splash itself is
    // unaffected -- it still shows, and still stays up until
    // SplashScreen.hideAsync(), because that is expo's own
    // keepSplashScreenOnScreen pre-draw gate, independent of the exit listener.
    //
    // Not alternatives, so they are not worth re-trying: SplashScreenOptions.fade
    // is inert on Android in expo-splash-screen 57.0.2 (declared, never read --
    // configureSplashScreen uses only duration). Reducing duration does not help
    // either, because the deadline is on the platform's attach report, which
    // happens before any exit animation would run. Nor do disabled animations or
    // zeroed animation scales: this is a STUCK animation, not a slow one.
    if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.S) {
      splashScreen.clearOnExitAnimationListener()
    }`;

/**
 * Merges the snippet into MainActivity, converting a missing anchor into an
 * actionable failure.
 *
 * A silent no-op is exactly the failure this plugin exists to prevent, so
 * prebuild must fail rather than emit a build that merely looks patched.
 * `mergeContents` already throws when the anchor is absent, but its message
 * names only the regex; this rethrows with the file and constant to edit.
 * @param {string} contents Current MainActivity source.
 * @returns {object} The mergeContents result, with the snippet inserted.
 */
const mergeOrThrow = contents => {
  try {
    return mergeContents({
      src: contents,
      newSrc: SNIPPET,
      tag: TAG,
      anchor: ANCHOR,
      offset: 1,
      comment: "    //",
    });
  } catch (error) {
    throw new Error(
      "withAndroidSplashNoClientExit could not find `super.onCreate(null)` in " +
        "MainActivity, so the splash-exit listener would not be cleared and the " +
        "stranded-reveal defect would re-open. Failing prebuild deliberately: " +
        "an unpatched build is the outcome this plugin exists to prevent.\n\n" +
        "Most likely a React Native upgrade changed the onCreate signature. " +
        "THIS FILE IS MANAGED BY LISA and is replaced on each `lisa` run, so " +
        "editing ANCHOR here will be reverted — report the RN version and the " +
        "MainActivity onCreate line upstream instead.\n\n" +
        "To unblock immediately, remove this plugin from your app config. That " +
        "restores the defect (slow first frames strand a reveal animation and " +
        "degrade every synced input event) but is a deliberate, visible choice " +
        "rather than a silently unpatched build.\n\n" +
        `Underlying error: ${error instanceof Error ? error.message : String(error)}`
    );
  }
};

/**
 * Expo config plugin that stops the app from taking over the Android 12+
 * splash-screen exit animation.
 *
 * Without this, a slow first frame can miss the platform's 2000ms
 * splash-transfer deadline, which strands a `STARTING_REVEAL` animation on the
 * activity's main window for the life of that activity. Every subsequent
 * synced input event then waits out WindowManager's 5000ms animation budget
 * twice. See the snippet's own comments for the full chain.
 *
 * Must run AFTER `expo-splash-screen`, which registers the listener this
 * removes. Appending it to the plugin list after that entry is what guarantees
 * mod order.
 * @param {object} config The Expo config being modified.
 * @returns {object} The config with the MainActivity mod applied.
 */
const withAndroidSplashNoClientExit = config =>
  withMainActivity(config, config => {
    const { modResults } = config;

    if (modResults.language !== "kt") {
      throw new Error(
        "withAndroidSplashNoClientExit expects a Kotlin MainActivity, got " +
          `"${modResults.language}". Port the snippet to Java before removing ` +
          "this guard — silently skipping would re-open the stranded-reveal defect."
      );
    }

    const merged = mergeOrThrow(modResults.contents);

    return {
      ...config,
      modResults: {
        ...modResults,
        contents: merged.contents,
      },
    };
  });

module.exports = withAndroidSplashNoClientExit;
module.exports.TAG = TAG;
