# lockgpt

lockgpt keeps old ai chats out of sight when someone borrows your browser.

it runs on chatgpt and claude. set a pin, start a guest session, then hand over the keyboard. when you return, unlock and choose what happens to the chats made during that session.

## what is in here

- one pin for guest mode
- chatgpt and claude support
- a clean chat for the guest
- a session-only guest chat list
- guest chat deletion and owner review after unlock
- a lock that survives browser restarts

## build it

you need a recent node.js release and npm.

```sh
npm install
npm run build
```

the chrome build is placed in `dist`.

## install in chrome or edge

1. open `chrome://extensions` or `edge://extensions`
2. turn on **developer mode**
3. click **load unpacked**
4. select the project’s `dist` folder
5. pin lockgpt from the extensions menu

## install in firefox

create the Firefox package:

```sh
npm run package:firefox
```

this creates `lockgpt-firefox.xpi` and the unpacked Firefox build in `dist-firefox`.

for local testing, open `about:debugging#/runtime/this-firefox`, choose **load temporary add-on**, then select `dist-firefox/manifest.json`.

regular Firefox only installs signed add-ons permanently. use the temporary install for development, or install a signed package once LockGPT is published through Firefox Add-ons.

## use it

1. open chatgpt or claude
2. click the LockGPT toolbar icon and create a six-digit pin
3. choose **lock & start guest session**
4. let the guest use the clean chat, create more chats, or switch between the chats made in that session
5. open LockGPT again, enter the pin, and keep or delete the guest chats

## privacy boundary

lockgpt is for everyday privacy, not account isolation. the guest still uses the signed-in chatgpt or claude account, along with any account-level capabilities already available there. it does not encrypt provider data or create a second account.

use a separate browser profile or account when you need a stronger boundary.

## troubleshooting

after updating the extension, reload it from the browser’s extensions page and refresh the chat tab. chatgpt and claude change their interfaces regularly, so a provider-side change may need a LockGPT update.
