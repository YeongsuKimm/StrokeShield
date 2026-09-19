# Getting the alert working

Two ways to deliver the alert text. **Use email-to-SMS** (free, no Twilio); the Twilio steps further down are the legacy option.

## Email-to-SMS with your Gmail (Verizon phone)
The backend emails `<your 10 digits>@vtext.com` (Verizon's text gateway) from your Gmail; Verizon turns it into a text. The address is built on the server from `DEMO_PHONE_NUMBER`. Nothing in a request can change it.

1. **Turn on 2-Step Verification** for the Gmail account you'll send from: myaccount.google.com > Security > 2-Step Verification. (Gmail only allows app passwords with it on. Work/school accounts may block app passwords.)
2. **Create an app password:** myaccount.google.com/apppasswords > name it `StrokeShield` > Create. Google shows 16 letters in 4 groups: copy it (you can't see it again).
3. **Put it in `.env`** yourself (never in chat or git):
   ```
   ALERT_CHANNEL=email_sms
   SMS_GATEWAY_DOMAIN=vtext.com
   SMTP_USER=you@gmail.com
   SMTP_APP_PASSWORD=abcd efgh ijkl mnop
   DEMO_PHONE_NUMBER=+1XXXXXXXXXX
   ```
   Spaces in the app password are fine.
4. **Check it:** `python scripts/sms_check.py`. It validates `.env`, then logs in to Gmail (no mail sent). Every line should be PASS.
5. **Send one real test:** set `DRY_RUN=false`, restart the backend, then `python scripts/sms_check.py --send`. The text should arrive within about a minute, from your Gmail address.
6. Set `DRY_RUN=true` again when you're done testing.

Things to know: delivery is best-effort with no receipt; the message is one short text (no patient name, location rounded); if it never arrives, check Gmail's Sent folder for a bounce, try again, and keep the DRY_RUN demo as the fallback. Verizon's gateway is scheduled to shut down on 2027-03-31; AT&T and T-Mobile already closed theirs, so this only works for a Verizon number (or set `SMS_GATEWAY_DOMAIN` for a carrier that still has one, e.g. `email.uscc.net` for US Cellular).

---

## Legacy: Twilio trial

The app sends **one SMS** (with the symptoms and a map link) to `DEMO_PHONE_NUMBER`. Never to anyone else: the number comes only from `.env`.
Check where you are at any time: `python scripts/sms_check.py` (read-only: validates `.env`, then asks Twilio; it sends nothing).

## What you need in `.env`
| Setting | What it is |
|---|---|
| `TWILIO_ACCOUNT_SID` | starts with `AC`, console.twilio.com dashboard |
| `TWILIO_AUTH_TOKEN` | 32 characters, same page ("show") |
| `TWILIO_FROM_NUMBER` | the **Twilio phone number** the text comes FROM, in `+1XXXXXXXXXX` form. **Not your own phone.** |
| `DEMO_PHONE_NUMBER` | your own phone, the one that receives the text (`+1XXXXXXXXXX`) |
| `DRY_RUN` | `true` = the app only logs the alert. Set to `false` only when you want real sends. |

## Steps
1. **Get a Twilio phone number.** console.twilio.com > Phone Numbers > Manage > Buy a number (trial accounts can get one with the trial credit; pick one with **SMS** capability). Copy it into `TWILIO_FROM_NUMBER`.
2. **Verify your own phone.** Phone Numbers > Manage > **Verified Caller IDs** > Add a new caller ID. Trial accounts can only text verified numbers. Enter the code Twilio sends.
3. `python scripts/sms_check.py`: every line must be PASS (it also warns if your sender is a US local number, see below).
4. Send one real test: `python scripts/sms_check.py --send`. It goes through the app's own alert path (same guard, same message format) and prints the message SID. The text starts with "Sent from your Twilio trial account -" on a trial account: expected.
5. Only then set `DRY_RUN=false` in `.env` for the demo (and back to `true` afterwards).

## If the text doesn't arrive
Open the message in the Twilio console (Monitor > Logs > Messaging) and read the error code:
| Code | Meaning / fix |
|---|---|
| 21608 | Trial account and the destination isn't verified: step 2 |
| 21606 | The FROM number can't send SMS: choose one with SMS capability |
| 21211 / 21614 | The destination isn't a valid mobile number: check `DEMO_PHONE_NUMBER` |
| 21610 | You replied STOP to that number earlier: text START to it from your phone |
| 20003 | Wrong SID or token |
| **30034** | US carriers block texts from **unregistered US local numbers** (A2P 10DLC). Options: a **toll-free** number (needs toll-free verification), A2P 10DLC registration (can take days), or a non-SMS fallback for the demo (e.g. Twilio's WhatsApp sandbox: needs a code change, ask). Plan for this early; it is the most likely surprise. |

## Safety (unchanged)
Destination only from `DEMO_PHONE_NUMBER`; no phone number is accepted from any request; `DRY_RUN` defaults to true; one alert per 2 minutes; the risk score is re-checked on the server. `sms_check.py --send` uses the same path, so it can only ever text your own number.
