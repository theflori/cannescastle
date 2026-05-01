# Château Privé — Email Templates & Formspree Setup

All emails in English. Ready to copy-paste.
Replace placeholders in `[BRACKETS]` before sending.

---

## 1. Formspree Setup (one-time)

**Endpoint already wired in form:** `https://formspree.io/f/xojrqvgr`

In your Formspree dashboard for this form:

### a) Enable Auto-Reply (sends Email #1 below automatically)
- Settings → **Autoresponder** → Enable
- Reply-from name: `Château Privé`
- Reply-from email: your sender (e.g. `rsvp@chateau-prive.com`)
- Subject + body: see **Email #1** below

### b) Notification to host (Email #2)
- Settings → **Notifications**
- Recipients: your email + any co-hosts
- Subject template: `New RSVP — [name] ([email])`
- Formspree will include all form fields in the body automatically

### c) Allowed domains
- Settings → **Domains** → add your live domain (e.g. `chateau-prive.com`)
- This stops third parties from abusing the endpoint

### d) Optional fields already in the form
- `_subject` → controls notification subject line
- `_next` → redirects to `thanks.html` on success (already wired)
- Add `_replyto` mapped to email field if not auto-detected

---

## 2. Email #1 — Auto-Reply to Applicant
**Trigger:** sent automatically by Formspree the moment they submit the form.
**From:** `Château Privé <rsvp@chateau-prive.com>`
**To:** the applicant
**Subject:** `Your request has been received — Château Privé`

```
Dear [Name],

Thank you for your interest in Château Privé.

Your request has been received and is now under review by the hosts.
Due to limited capacity, not all requests can be approved.

Confirmed guests will receive a separate access confirmation by email,
including the precise location, time, and dress code, in the days leading
up to the event.

Until then, we kindly ask you to keep this invitation confidential and
not to share the link or any details with third parties.

Warm regards,
The Hosts
Château Privé
Cannes · May 15, 2026
```

---

## 3. Email #2 — Internal Notification to Host
**Trigger:** Formspree sends this automatically on every submission.
**From:** `Formspree <noreply@formspree.io>` (or custom sender if upgraded)
**To:** you (host inbox)
**Subject:** `New RSVP — [Name] ([Email])`

Body is auto-populated by Formspree with all form fields.
No action needed from you — this is just for review.

---

## 4. Email #3 — Approval / Confirmation
**Trigger:** sent manually by you to approved guests.
**From:** `Château Privé <rsvp@chateau-prive.com>`
**To:** approved applicant
**Subject:** `You are confirmed — Château Privé, 15 May 2026`

```
Dear [Name],

It is our pleasure to confirm your attendance at Château Privé,
a private evening hosted during the 79th Cannes Film Festival.

   ——————————————————————————————

   DATE      Friday, 15 May 2026
   DOORS     5:00 PM — late
   ADDRESS   [Full address, only revealed here]
             [Postal code, Cannes, France]
   DRESS     Glamour Chic
   ARRIVAL   Doors close 7:00 PM sharp.
             Late arrival may be denied.

   ——————————————————————————————

Please bring a valid photo ID. Your name will be on the guest list at the
gate. This invitation is strictly personal — plus ones cannot be admitted.

Parking is limited; we recommend arriving by car service or taxi.
GPS coordinates and a detailed arrival map will be sent the day before.

We kindly ask, once more, that you treat this invitation with discretion.
The location, the guest list, and any media captured at the venue are
confidential.

We look forward to welcoming you.

Warm regards,
The Hosts
Château Privé
```

---

## 5. Email #4 — Polite Decline
**Trigger:** sent manually by you to applicants who cannot be accommodated.
**From:** `Château Privé <rsvp@chateau-prive.com>`
**To:** declined applicant
**Subject:** `Regarding your request — Château Privé`

```
Dear [Name],

Thank you very much for your request to attend Château Privé.

We were genuinely glad to hear from you. Regrettably, due to the
intimate scale of the evening and limited capacity, we are unable
to accommodate every request this year.

We hope our paths cross at a future occasion, and we wish you a
wonderful festival.

Warm regards,
The Hosts
Château Privé
```

---

## 6. Email #5 — Final Details (Reminder, ~3 days before)
**Trigger:** sent manually to all confirmed guests, ~3 days before event.
**From:** `Château Privé <rsvp@chateau-prive.com>`
**To:** confirmed guests (BCC list)
**Subject:** `Final details — Château Privé, this Friday`

```
Dear Guests,

A short note ahead of Friday evening.

   ——————————————————————————————

   WHEN          Friday, 15 May 2026
                 Doors 5:00 PM, close 7:00 PM sharp

   WHERE         [Full address]
                 [Postal code, Cannes]
                 GPS: [coordinates]

   DRESS         Glamour Chic

   ARRIVING      By taxi or car service is strongly recommended.
                 On-site parking is limited.
                 Please present photo ID at the gate.

   ——————————————————————————————

A reminder that this evening is private. We ask you not to share the
location, the guest list, or any photographs taken on the premises.

If anything changes on your side, please reply to this email.

Looking forward to Friday.

Warm regards,
The Hosts
Château Privé
```

---

## 7. Email #6 — Day Of (optional, morning of event)
**Trigger:** sent the morning of the event to confirmed guests.
**From:** `Château Privé <rsvp@chateau-prive.com>`
**To:** confirmed guests (BCC)
**Subject:** `Tonight — Château Privé`

```
Dear Guests,

We are looking forward to welcoming you tonight.

   DOORS    5:00 PM — close 7:00 PM sharp
   WHERE    [Address] · GPS [coordinates]
   DRESS    Glamour Chic
   ID       Please carry photo identification.

A car service is recommended. On-site parking is very limited.

If you can no longer attend, kindly let us know by reply so the spot
can be honoured graciously.

Warm regards,
The Hosts
Château Privé
```

---

## 8. Email #7 — Cancellation by Guest (template for replies)
If a confirmed guest writes to cancel.
**From:** `Château Privé <rsvp@chateau-prive.com>`
**Subject:** `Re: Château Privé — your message`

```
Dear [Name],

Thank you for letting us know. We are sorry you cannot make it,
but appreciate the courtesy of your note.

We hope to see you on another occasion.

Warm regards,
The Hosts
Château Privé
```

---

## 9. Sender / Domain Recommendations

For best deliverability (so emails don't land in spam):

- Send from a real domain: `rsvp@chateau-prive.com`, not `@gmail.com`.
- Set up **SPF, DKIM, DMARC** records on the domain (your DNS host or
  Cloudflare can do this in a few clicks).
- Consider using a transactional email service for the manual sends:
  **Resend, Postmark, or Mailgun** — all have free tiers, all support
  one-line setup with a custom domain.
- For the auto-reply, Formspree handles deliverability for you on
  paid plans; on the free plan it works but is rate-limited.

---

## 10. Tone Notes

- Always sign off with **"Warm regards, The Hosts"** — never with a
  personal name.
- Never name other guests in any email.
- Never include the address until the guest is confirmed (Email #3).
- Keep paragraphs short. Two to four lines maximum.
- No emojis. No exclamation points beyond one per email at most.
- The tone is warm, but private and discreet — never effusive.
