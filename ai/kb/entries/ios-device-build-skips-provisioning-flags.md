---
id: ios-device-build-skips-provisioning-flags
title: `npm run ios -- --device` never lets Xcode create a provisioning profile once the project already names a team — the first build for a new device, entitlement or expired profile needs one hand-run `xcodebuild -allowProvisioningUpdates`
type: gotcha
status: current
tags: [ios, signing, xcode, expo, apple-developer, device]
sources: [node_modules/expo/node_modules/@expo/cli/build/src/run/ios/XcodeBuild.js, node_modules/expo/node_modules/@expo/cli/build/src/run/ios/codeSigning/configureCodeSigning.js, .expo/xcodebuild.log, ai/tasks/26-apple-sign-in/implementation-log-step-2.md, b15d384]
last_verified: 2026-10-07
verify: F=node_modules/expo/node_modules/@expo/cli/build/src/run/ios/codeSigning/configureCodeSigning.js && grep -A3 '^async function ensureDeviceIsCodeSignedForDeploymentAsync' "$F" | grep -q 'return null;' && grep -q "'-allowProvisioningUpdates'" node_modules/expo/node_modules/@expo/cli/build/src/run/ios/XcodeBuild.js && (! test -f ios/ShoppingLoop.xcodeproj/project.pbxproj || grep -qE 'DEVELOPMENT_TEAM = "?YZ75T58P4Z"?;' ios/ShoppingLoop.xcodeproj/project.pbxproj)
related: [native-build-toolchain]
indexed: false
---

**Symptom.** `npm run ios -- --device` prints `› Auto signing app using team(s): YZ75T58P4Z`, then
xcodebuild fails with exit 65: `No profiles for 'com.shoppingloop.app' were found … Automatic
signing is disabled and unable to generate a profile. To enable automatic signing, pass
-allowProvisioningUpdates to xcodebuild.` The "Auto signing" line is misleading — nothing is
being auto-provisioned.

**Cause (Expo CLI 57.0.27).** For a device build, `getXcodeBuildArgsAsync` in `XcodeBuild.js` adds
`DEVELOPMENT_TEAM=… -allowProvisioningUpdates -allowProvisioningDeviceRegistration` only when
`ensureDeviceIsCodeSignedForDeploymentAsync` returns a team id. That function returns `null` — no
flags — whenever every target in `ios/ShoppingLoop.xcodeproj/project.pbxproj` already has a
`DEVELOPMENT_TEAM`, which ours does (`YZ75T58P4Z`, quoted or not depending on the prebuild,
`CODE_SIGN_STYLE = Automatic`). Only when the
team is missing does Expo write it and return the id. So with a team already set, xcodebuild may
use an existing profile but can never create one. `.expo/xcodebuild.log`'s first lines show the
real invocation: no provisioning flags in it.

**Fix.** Run Expo's own command once by hand with the flags, from the repo root, then go back to
`npm run ios -- --device`, which finds the profile from then on:

```
LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 RCT_NO_LAUNCH_PACKAGER=true xcodebuild -workspace ios/ShoppingLoop.xcworkspace -configuration Debug -scheme ShoppingLoop -destination id=<UDID> -allowProvisioningUpdates -allowProvisioningDeviceRegistration COCOAPODS_PARALLEL_CODE_SIGN=true COMPILER_INDEX_STORE_ENABLE=NO build
```

Get the UDID from `xcrun devicectl list devices`. This registers the device to the team, creates
the App ID if needed, and writes the profile to
`~/Library/Developer/Xcode/UserData/Provisioning Profiles/`.

**The user runs it, in their own terminal — not the agent.** The agent's command sandbox blocks
apple.com, so run by the agent it fails with `Unable to log in with account … (Underlying error
code -1001)`, which reads like a bad Apple login and is not one. Hand the command to the user.

**When it comes back.** Whenever a new profile is needed: a phone not yet registered, a new
capability or entitlement, or the profile expiring. A new entitlement shows as the profile "does
not support the Sign In with Apple capability" — the case task 26 hit when `usesAppleSignIn` put
`com.apple.developer.applesignin` in `ios/ShoppingLoop/ShoppingLoop.entitlements`. The profile with
that entitlement was made 2026-10-06 and expires 2027-10-06. The same command fixes all three.

Stripping `DEVELOPMENT_TEAM` from the pbxproj to make Expo take its own path also works, but only
once: Expo writes the team back. Retire this entry if a later `@expo/cli` passes the flags for a
project that already names a team; the `verify:` fails when the early `return null` goes.
