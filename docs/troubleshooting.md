# Troubleshooting protocols

Decision trees for when something on the lock screen does not work.

Each protocol starts from a symptom and narrows to one cause. They exist
because the first time the banner failed, four settings were checked, all were
correct, and the actual cause — the widget extension never registering — was
not on anyone's list. The checks are ordered so the cheapest one that can
*eliminate a whole branch* comes first, not the one that is easiest to reach.

**Start every protocol from the Diagnostika screen.** It reports the fields
these trees refer to. Copy the report before changing anything, so there is a
before-and-after.

---

## P1 · The banner does not appear at all

The single most useful fact: a Live Activity is **created by the app** but
**drawn by the widget extension**. Those are separate processes, and either can
fail without the other noticing. So the first question is never about settings.

### Step 1 — Is the extension inside the installed app?

Diagnostika → **Widget'o plėtinys** → `Plėtinys diske`.

| Reads | Means | Go to |
|---|---|---|
| `NĖRA` | The sideloading tool stripped it during install | **P1-A** |
| `VilniusCommuteWidgets.appex` | It shipped correctly | Step 2 |

### Step 2 — Did iOS register it?

Same section → `Widget'ai sistemoje` and `Valdikliai pridėti`.

Then check by hand: lock screen → long press → **Customize** → **Lock Screen**
→ tap a bottom button → is **Vilnius · Kalbėk** in the list?

| Control in the list | Means | Go to |
|---|---|---|
| No | The extension is on disk but unregistered — a provisioning failure | **P1-B** |
| Yes | The extension works; this is a display setting | Step 3 |

### Step 3 — Is the Activity actually alive?

Diagnostika → **Gyvosios veiklos**.

| State | Means | Fix |
|---|---|---|
| `Leidžiamos sistemoje: NE` | Turned off for this app | `Settings → Vilnius → Live Activities` → ON |
| `Šiuo metu veikia: 0` | The app never created one, or it ended | Gyvoji veikla → Paleisti, then re-check |
| `laukia (iOS dar neparodė)` | Accepted but not displayed — almost always Step 4 | Step 4 |
| `atmesta` | It was swiped away. Not a bug | Start a new one |
| `pasenusi` | Its content aged past `staleDate` | Stop and start again |
| `aktyvi` | It is genuinely live | Step 4 |

### Step 4 — Lock screen display settings

All three must be ON. The second is the one people miss, because it is not in
the app's own settings page:

1. `Settings → Vilnius → Live Activities`
2. `Settings → Face ID & Passcode` → **ALLOW ACCESS WHEN LOCKED** → **Live Activities**
3. `Settings → Notifications → Vilnius → Allow Notifications`

After changing any of them: **stop and restart the Activity.** An existing one
does not pick up the new setting.

### Step 5 — Look somewhere other than the lock screen

If the phone has a Dynamic Island, background the app and look at the top of
the screen. The Island is **not** governed by the lock-screen settings above,
so:

- **Visible in the Island, absent from the lock screen** → the problem is
  isolated to Step 4, and one of those three is still off.
- **Absent from both** → go back to Step 1; the extension is the suspect
  again, whatever the earlier steps said.

---

### P1-A · The extension was stripped at install

The `.ipa` is fine — CI verifies the `.appex` is inside it on every build. It
is being removed on the way in.

1. In Sideloadly, look for any option mentioning **extensions** or **plugins**
   and make sure it is not removing them. Several sideloaders strip extensions
   by default, because each one needs its own provisioning profile.
2. Reinstall, then re-check `Plėtinys diske`.

### P1-B · Present but unregistered

A free Apple ID does allow app extensions, so this is not automatically a
dead end.

**Not** the App ID budget, despite the temptation to blame it. That limit — 10
App IDs per 7 days — counts **distinct** bundle identifiers. Reinstalling the
same app reuses the same two (`…app` and `…app.widgets`) and consumes nothing
further, so repeated installs in one day do not exhaust it. What does expire
after 7 days is the signing certificate, which needs re-signing, not a new ID.

1. Reboot once. Extension registration sometimes settles on the next launch.
2. Delete the app completely, then install once. This costs the downloaded
   whisper models, which live in Application Support and go with it.
3. Verify the signing step actually covered the `.appex`. An extension left
   unsigned, or signed with a profile that does not match its bundle id, is
   installed and then ignored by iOS.
4. If it still fails after a clean install, treat it as a genuine free-account
   limit and record it — that changes Phase 4's design rather than being
   something to keep retrying.

---

## P2 · The banner appears but shows the wrong thing

| Symptom | Cause | Fix |
|---|---|---|
| Countdown stuck at `00:00` | `leaveAt` is in the past; the range clamps rather than inverting | Start a fresh Activity |
| Greyed out or faded | Past `staleDate`; iOS marks it stale | Expected. Phase 3 will keep it updated |
| Badges have no colour | It is being drawn in `vibrant`/`accented` mode | Expected on the lock screen. Colour is guaranteed only in the Island, home-screen widgets and the app |
| Times look like clock times | Reading `12:00` as a time of day | The countdown carries a `min` suffix; the clock time does not |

---

## P3 · The lock-screen control is missing from Customize

Same root as P1 Step 1–2 — the control and the banner come from one extension.
Run **P1 Step 1**, then:

- Control missing **and** `Plėtinys diske: NĖRA` → **P1-A**
- Control missing **but** the `.appex` is on disk → **P1-B**
- Control present but cannot be added → the slot may be full; remove another
  control first

---

## P4 · The control is there, but pressing it does nothing

1. Diagnostika → **Balsas** → `Įrašymas iš užrakto`.
   - `dar nebandyta` → the intent never ran. The press is not reaching the app
   - `nepavyko: …` → it ran and failed; the message says why
   - `pavyko …` → it worked. The marker is the evidence
2. If it never runs, check `Settings → Face ID & Passcode → Control Center`
   is ON — controls are blocked on a locked device otherwise.
3. Microphone must already be granted. iOS will not show a permission prompt
   on a locked screen; it fails silently instead. Grant it in the app first.

---

## P5 · The alarm does not ring

1. Diagnostika → **Leidimai** → `AlarmKit`. Must read `suteikta`.
2. AlarmKit is deliberately separate from notifications: it is designed to
   ring through silent mode and Focus. If it is authorised and still silent,
   that is a real bug worth reporting, not a settings problem.
3. Check `Mažos galios režimas` in the **Fonas** section — Low Power Mode does
   not block an alarm, but it does suspend the background work that schedules
   one in time.

---

## P6 · Tracking stops while the phone is in a pocket

Diagnostika → **Leidimai** and **Fonas**:

| Field | Required | Why |
|---|---|---|
| `Vieta` | `visada` | "When in use" stops the moment the screen locks |
| `Vietos tikslumas` | `tikslus` | Reduced accuracy cannot tell which stop you are at, while the permission still reads as granted |
| `Background App Refresh` | `įjungta` | Off means no background work at all |
| `Mažos galios režimas` | `išjungtas` | Suspends background refresh and throttles location |

The accuracy one is worth singling out: it fails while everything looks
permitted, which is the hardest kind of failure to find by eye.

---

## When to stop troubleshooting

If a protocol ends without a cause, that is a finding — write it in
`capability-probe.md` as an open question rather than repeating the tree.
Several of these branches end at "this is a genuine free-account limit", and
reaching one of those is an answer, not a failure.
