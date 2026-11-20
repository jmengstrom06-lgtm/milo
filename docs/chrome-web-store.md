# Putting Milo's extension in the Chrome Web Store

About 15 minutes of your time, then Google reviews it (usually a few days; longer the first time because it can read pages).

## 1. Make the upload file
```
cd ~/milo && npm run ext:zip
```
That makes `release/milo-extension-0.1.0.zip`.

## 2. Developer account (one time, $5)
1. Go to **chrome.google.com/webstore/devconsole** and sign in with the Google account you want Milo published under.
2. Pay the one-time $5 registration fee and accept the agreement.
3. Verify the contact email it asks for.

## 3. Upload
1. **New item** → choose the zip from step 1.
2. Fill in the tabs below by copy-pasting.

### Store listing
- **Name:** Milo
- **Summary (132 chars max):** Lets Milo, your study buddy for Mac, open assignments and use web pages for you. Requires the Milo app.
- **Category:** Education
- **Language:** English
- **Description:**

> Milo is a study buddy that lives on your Mac screen. This extension is his hands in Chrome.
>
> With it, Milo can:
> • Open your assignment in D2L or Canvas when you say "start my stats homework"
> • Read the page you're on so he can break the assignment into small steps
> • Click buttons, fill in fields, switch tabs and open pages when you ask him to
>
> It only does something when you ask Milo out loud or in his chat. It never runs on its own, never sends your browsing anywhere, and talks only to the Milo app on your own Mac.
>
> Requires the Milo app for Mac.

- **Icon:** `extension/icon128.png`
- **Screenshots (1280×800, at least 1):** take 1 to 3 on your Mac:
  1. Milo's Game Plan card next to a D2L assignment ("start my homework")
  2. Milo's research panel or a filled-in form
  3. Milo on screen with the "Got it" card
  (Cmd+Shift+4 then Space then click a window, or Cmd+Shift+5. Resize to 1280×800 in Preview: Tools → Adjust Size.)

### Privacy practices tab
- **Single purpose:** Lets the Milo desktop app read and operate the web page the student asks it to, so it can open assignments and complete web tasks for them.
- **Permission justifications:**
  - **tabs:** To list the open tabs and switch, open or close the tab the student asks for ("open my D2L tab", "close this tab").
  - **scripting:** To read the page the student is on (text and buttons) and to click or type on it when the student asks Milo to.
  - **alarms:** To keep the connection to the Milo app on the student's Mac alive while Chrome is open.
  - **nativeMessaging:** To find the Milo app on the same Mac (it tells the extension which local port to connect to). No data leaves the computer through it.
  - **Host permission (all sites):** Students ask Milo to work on whatever site their class uses (D2L, Canvas, Google Docs, Quizlet…), so it can't be limited to a fixed list. It only acts on a page when the student asks.
- **Remote code:** No, I am not using remote code.
- **Data usage:** check **Website content** (it reads the page you ask about) and **User activity** (it clicks and types when asked). Then check all three certifications:
  - I do not sell or transfer user data to third parties, outside of the approved use cases
  - I do not use or transfer user data for purposes unrelated to my item's single purpose
  - I do not use or transfer user data to determine creditworthiness or for lending purposes
- **Privacy policy URL:** paste the link to the policy below once it's online (see step 4).

### Distribution
- **Visibility:** start with **Unlisted** (only people with the link can install it). Switch to Public later.
- **Regions:** All regions.

## 4. Privacy policy (Google requires a public link)
Easiest: put it on your domain once you have it (e.g. yourdomain.com/privacy). Until then, a published Google Doc works: paste the text below into a Google Doc → File → Share → Publish to web → copy the link.

> **Milo Privacy Policy**
>
> Milo is a study companion app for Mac with an optional Chrome extension.
>
> **What the extension can see.** When you ask Milo to do something in your browser, the extension reads the page you're on (its text and buttons) and clicks or types for you. It does nothing unless you ask.
>
> **Where it goes.** The extension talks only to the Milo app on your own Mac, over a local connection. When you ask Milo a question, the text he needs to answer it (for example, an assignment's instructions) is sent to our AI provider (Anthropic) to work it out, and isn't used to train models. Screenshots stay on your Mac.
>
> **What we store.** If you sign in, Milo saves your classes, saved work (drawings, sheets, study sets, study plans) and a few things you tell him (like your name) to your account so they follow you to a new Mac. Only you can see them. We store usage counts (not content) to keep daily limits fair, and anonymous crash reports.
>
> **What we never do.** We don't sell your data, show ads, or share your information with anyone except the services that run Milo (Supabase for your account, Anthropic for AI, ElevenLabs and Deepgram for voice).
>
> **Deleting.** Say "forget everything" in Milo's account panel to clear what he remembers, or email us to delete your account and all its data.
>
> Contact: [your email]

## 5. After Google approves it
1. In the developer dashboard, open Milo → **Package** and copy the **Item ID** (32 letters, like `abcdefghijklmnopabcdefghijklmnop`).
2. Send it to me. I'll add it to Milo so the store version can find him, then publish an update with `npm run release`.

Until then, the store version installs fine but shows "not connected"; the copy you loaded by hand keeps working.
