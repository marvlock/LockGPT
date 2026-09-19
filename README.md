# lockgpt

a small browser extension for lending your browser without putting your old ai chats on display.

it works with chatgpt and claude. turn on guest mode, hand over the browser, and unlock with your pin when you are back.

## what it does

- hides existing chatgpt and claude conversations
- gives the guest a clean chat and a small list of chats they create
- lets the guest make more chats, switch between them, or delete them
- lets you keep or delete the session’s chats after you unlock
- keeps the lock on after a browser restart

## run it locally

```sh
npm install
npm run build
```

then open `chrome://extensions`:

1. turn on developer mode
2. click **load unpacked**
3. choose the `dist` folder
4. pin lockgpt if you want it next to the address bar

## firefox

build the firefox package with:

```sh
npm run package:firefox
```

this creates `lockgpt-firefox.xpi`. for local testing, open `about:debugging#/runtime/this-firefox`, choose **load temporary add-on**, and select `dist/manifest.json`.

## use it

open chatgpt or claude, click the lockgpt icon, create a six-digit pin, then choose **lock & start guest session**.

the guest can use the fresh chat, start more chats, and move between chats made in that session. open lockgpt again and enter the pin to return to your normal view.

after unlocking, choose whether to keep or delete the guest chats.

## a note on privacy

lockgpt is for everyday privacy when someone borrows your browser. it does not create a separate account, encrypt provider data, or remove account-level features such as memory and connected apps. the guest is still using the signed-in account.

for a stronger boundary, use a separate browser profile or account.

## if it gets stuck

reload lockgpt in `chrome://extensions`, then refresh the chatgpt or claude tab. both sites change their interface often, so the extension may occasionally need an update.
