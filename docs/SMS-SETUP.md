# Getting the SMS alert working (Twilio trial)

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
