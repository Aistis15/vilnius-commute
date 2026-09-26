# Product vision

From the user, 2026-09-26, after using the first build on a real phone. This
extends the original spec rather than replacing it: where the two differ, this
is the newer intent.

The sentence everything else follows from:

> **The banner is the interface.** You never open the app. You press a button
> on the lock screen, say where you are going, and the phone tells you when to
> leave.

---

## The flow

```
lock screen button
   ↓
banner opens with a bold question:  "Kur keliausime šiandien?"
   ↓
speak: "Man reikia į Akropolį keturiolika dvidešimt"   → trip planned, done
       "Man reikia į Akropolį"                          → banner offers two buttons
   ↓
   [ Dabar ]  [ Planuoti ]
   ↓                ↓
  plan for now   asks again: what time?  → speak the time
   ↓
planned trip, using preferences set during onboarding
```

Not speaking is a first-class path, not a fallback: tapping the banner
dismisses the question and opens search plus a time picker in the app.

### Why voice leads

Because the target user includes a child who has just started school. Speaking
"I need to get to school" is easier than any amount of tapping. Parents set up
presets — home, school, grandparents, after-school club — and the child says
where they are going.

---

## Preferences, set during onboarding

The app is still needed, just not day to day. On first run it asks how the
person wants to travel:

- Fastest possible, whatever it takes?
- Prefer staying on one bus, if there is one?
- Keep transfers to a minimum?
- Happy to walk further to a stop, or not?

The goal is always "get there as fast as possible", but the fastest route
sometimes means walking a long stretch. That trade-off is exactly what these
settle, and it is why they cannot be guessed.

---

## What the banner shows

Every number carries its unit — `12 min`, `14:20` — because a trip can be
planned for the morning or for the evening and there must be no doubt which is
which. This already drove the `min` suffix on the countdown.

Content during a planned trip:

- how long until you leave
- when the first bus departs
- where to walk, and how far
- how long until the bus arrives

Stated goal: simple enough that a small child can use it. Trafi does the job,
but planning can be made much easier.

---

## Ending a trip

The banner disappears on arrival. When the phone detects you are at or near
the destination, the banner asks **"Ar baigėte kelionę?"** with yes/no buttons,
rather than vanishing on its own or lingering.

---

## Saved places

Unlimited, user-named, completely custom: university, work, home, gym, school,
whatever. **Trafi allows only two, and that is a real, named frustration** —
there are more places someone travels to regularly than that.

Two ways in:

1. The app notices you travel somewhere often and offers to save it: *"save
   this destination?"* — you say the name out loud ("mokykla") and it is
   stored.
2. You name one yourself at any time.

But saved places must never be the only way. Anywhere in Lithuania — an
address, a landmark — must work, spoken, with nothing else to do afterwards.

---

## What the platform allows, and what it does not

Checked against Apple's documentation rather than assumed, because one part of
the vision is not buildable as described.

### Possible

| Wanted | How |
|---|---|
| Lock-screen button that starts the banner | `ControlWidget` + `LiveActivityStartingIntent` (iOS 16.1+) |
| Buttons **in** the banner — "Dabar" / "Planuoti" / "Atvykau" | Apple: *"Live Activities can contain SwiftUI buttons and toggles"* |
| Speaking from the lock screen | `AudioRecordingIntent` (iOS 18+) on the control, then whisper |
| Banner content changing through the trip | An Activity is updated; each stage renders differently |
| Tapping the banner to open the app | Deep link from the Activity |
| More detail without opening the app | Dynamic Island expanded view |

### Not possible

**Swiping between pages inside the banner.** A Live Activity is not a
miniature app — it is a view the system re-renders, and it handles buttons and
toggles only. No gestures, no scrolling, no paging. A text field inside it is
out for the same reason.

What replaces it, and gets close:

1. **The banner changes by itself as the trip progresses** — countdown, then
   walk-to-stop with the arrow and distance, then on-board with the next
   transfer, then walk-to-destination. The information you wanted on separate
   pages arrives when it is the relevant thing, which needs no swipe at all.
2. **The Dynamic Island expanded view** holds more than the banner, on a long
   press.
3. **Tapping opens the app** for the full picture, search and the time picker.

This is a genuine platform limit, not a shortcut. If paging inside the banner
turns out to be essential, the honest answer is that iOS does not offer it.

---

## What this changes about the plan

- **Voice moves from Phase 5 to the critical path.** It is the primary input,
  not an extra. Whisper's Lithuanian accuracy stops being a nice-to-have.
- **Onboarding preferences become Phase 3 work**, because routing cannot pick
  between "fastest" and "fewest transfers" without them.
- **Saved places need unlimited entries and a naming flow**, including the
  "you go here often, shall I save it?" prompt.
- **Arrival detection** is needed for the "did you finish?" prompt.

## What blocks all of it today

The widget extension does not register on the device. No extension means no
banner and no lock-screen control — which is to say, no interface. Everything
above sits behind that one problem, and it is the only thing worth working on
until it is solved.
