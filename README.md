# LockGPT

LockGPT lets you hand someone your browser without handing over your ChatGPT history. When guest mode is on, your existing chats are covered and the guest can only use chats they create during that session.

## Install it in Chrome

1. Download or clone this project.
2. Open a terminal in `lockgpt-extension` and run:

   ```sh
   npm install
   npm run build
   ```

3. Open `chrome://extensions` in Chrome.
4. Turn on **Developer mode**.
5. Click **Load unpacked** and select the `dist` folder inside this project.
6. Pin LockGPT from Chrome’s extensions menu if you want it beside the address bar.

## Use it

The first time you open LockGPT, create a PIN with at least six digits.

When you want to lend your browser:

1. Open ChatGPT.
2. Click the LockGPT icon.
3. Click **Lock & start guest session**.

Your current ChatGPT tabs are protected. The active tab opens a fresh chat for the guest. Guests can start more chats, move between the chats they created, and delete their own guest chats from the small LockGPT panel.

To get back to your normal ChatGPT account, open LockGPT and enter your PIN.

After unlocking, you can review the guest chats once. Choose **Keep selected** to leave them in the account, or **Delete selected** to remove them through ChatGPT.

## A quick note about privacy

LockGPT is for casual privacy when someone borrows your browser. It hides and blocks normal access to your existing ChatGPT conversations; it does not create a separate ChatGPT account or encrypt ChatGPT’s data. A guest still uses the account that is signed in, including any account-level features that account has available.

Use a separate browser profile or a separate account when you need stronger separation.

## If something looks wrong

Reload the extension from `chrome://extensions`, then refresh the ChatGPT tab. ChatGPT changes its interface from time to time, so an update may occasionally need an adjustment to LockGPT as well.
