# Connect Gmail (one-time, ~15 min)

This creates a private OAuth "key" that lets the sweep read **your own** Gmail, read-only.
Nothing is shared with anyone — the credentials live only on your Mac in this folder.

Do these on the Google account whose mail you want swept (your **personal Gmail**).

---

## 1. Create a project
1. Go to <https://console.cloud.google.com>.
2. Top bar → project dropdown → **New Project**. Name it `Weekly Sweep` → **Create**.
3. Make sure that new project is selected (top bar) before continuing.

## 2. Enable the Gmail API
1. Search bar → type **Gmail API** → open it → **Enable**.

## 3. Set up the consent screen
1. Left menu → **APIs & Services → OAuth consent screen** (newer console: **Google Auth Platform → Branding**).
2. User type: **External** → Create.
3. App name: `Weekly Sweep`. User support email: your email. Developer contact: your email. Save and continue.
4. **Scopes** step — you can just **Save and continue** (we request the scope from code).
5. **Test users** step → **Add users** → add **your own Gmail address** → Save and continue.
   *(Skipping this is the #1 reason auth fails with "access blocked".)*

## 4. ⚠️ Avoid weekly re-login — publish the app
While an app is in **Testing**, Google **expires the login after 7 days**, which would make you
re-authorise every Sunday. To stop that:

1. Back on the **OAuth consent screen / Audience** page, find **Publishing status**.
2. Click **Publish app** → confirm. Status becomes **In production**.
3. It will say *"unverified"* — that's expected and fine for personal use. You'll see a one-time
   *"Google hasn't verified this app"* warning when you log in → click **Advanced → Go to Weekly Sweep (unsafe)**.
   It's *your* app reading *your* mail; the warning only exists because we haven't paid for Google's
   public-app review (unnecessary for personal use).

## 5. Create the credentials
1. Left menu → **APIs & Services → Credentials** → **Create credentials → OAuth client ID**.
2. Application type: **Desktop app**. Name: `Weekly Sweep desktop` → **Create**.
3. In the popup → **Download JSON**.

## 6. Drop the file in
Save the downloaded file as exactly:

```
Task Capture App/sweep/credentials.json
```

Then tell me it's in place. I'll run the fetch — a browser window opens once for you to approve
(pick your account → "Go to Weekly Sweep" → Allow). After that it's silent every week.

---

**What I can/can't see:** read-only access to your mail. I cannot send, delete, or change anything.
You can revoke it any time at <https://myaccount.google.com/permissions>.
