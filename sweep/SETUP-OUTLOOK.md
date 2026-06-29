# Connect Outlook / Microsoft 365 (work account)

Registers a private app on your company's Microsoft tenant so the sweep can read your
work mailbox (read-only) and write approved appointments to your calendar.

> ⚠️ Work account: this may need IT/admin approval depending on company policy and whether
> your tenant lets users register apps. If a step says "need admin approval", that's the
> tenant blocking self-service — contact IT rather than forcing it.

## 1. Register the app (Microsoft Entra admin center)
1. Go to <https://entra.microsoft.com> → sign in with your **work** account.
2. **App registrations** → **New registration**.
3. Name: `Weekly Sweep`. Supported account types: **Accounts in this organizational directory only**.
   Leave Redirect URI blank. **Register**.
4. On the Overview page, copy the **Application (client) ID** and **Directory (tenant) ID**.

## 2. Permissions
1. **API permissions** → **Add a permission** → **Microsoft Graph** → **Delegated permissions**.
2. Add: **Mail.Read**, **Calendars.ReadWrite**, **User.Read**, **offline_access**. → **Add permissions**.
   (You consent to these at first sign-in; no admin consent needed unless your tenant requires it.)

## 3. Allow device sign-in
1. **Authentication** → **Advanced settings** → **Allow public client flows** → **Yes** → **Save**.

## 4. Drop the IDs in
Create `sweep/ms_config.json`:
```json
{ "client_id": "<Application (client) ID>", "tenant_id": "<Directory (tenant) ID>" }
```

## 5. Connect
```bash
./.venv/bin/python sweep/outlook_fetch.py
```
Prints a `microsoft.com/devicelogin` code → enter it, sign in with your work account, approve
read-mail + read/write-calendar. Token caches to `sweep/ms_token.json`; later runs are silent.

**Access:** read-only on mail; read/write on calendar (so approved appointments can be added).
Revoke anytime from your Microsoft account, or have IT remove the app registration.
