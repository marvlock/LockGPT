# LockGPT

LockGPT keeps old AI chats out of sight when someone borrows your browser.

It runs on ChatGPT and Claude. Set a PIN, start a guest session, then hand over the keyboard. When you return, unlock and choose what happens to the chats made during that session.

## What is in here

- One PIN for guest mode
- ChatGPT and Claude support
- A clean chat for the guest
- A session-only guest chat list
- Guest chat deletion and owner review after unlock
- A lock that survives browser restarts

## Build it

You need a recent Node.js release and npm.

```sh
npm install
npm run build
```

The Chrome build is placed in `dist`.

## Install in Chrome or Edge

1. Open `chrome://extensions` or `edge://extensions`.
2. Turn on **Developer mode**.
3. Click **Load unpacked**.
4. Select the project’s `dist` folder.
5. Pin LockGPT from the extensions menu.

## Install in Firefox

Create the Firefox package:

```sh
npm run package:firefox
```

This creates `lockgpt-firefox.xpi` and the unpacked Firefox build in `dist-firefox`.

For local testing, open `about:debugging#/runtime/this-firefox`, choose **Load Temporary Add-on**, then select `dist-firefox/manifest.json`.

Regular Firefox only installs signed add-ons permanently. Use the temporary install for development, or install a signed package once LockGPT is published through Firefox Add-ons.

## Use it

1. Open ChatGPT or Claude.
2. Click the LockGPT toolbar icon and create a six-digit PIN.
3. Choose **Lock & start guest session**.
4. Let the guest use the clean chat, create more chats, or switch between the chats made in that session.
5. Open LockGPT again, enter the PIN, and keep or delete the guest chats.

## Privacy boundary

LockGPT is for everyday privacy, not account isolation. The guest still uses the signed-in ChatGPT or Claude account, along with any account-level capabilities already available there. It does not encrypt provider data or create a second account.

Use a separate browser profile or account when you need a stronger boundary.

## Troubleshooting

After updating the extension, reload it from the browser’s extensions page and refresh the chat tab. ChatGPT and Claude change their interfaces regularly, so a provider-side change may need a LockGPT update.
