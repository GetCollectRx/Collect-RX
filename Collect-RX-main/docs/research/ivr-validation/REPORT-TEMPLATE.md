# IVR Validation Report — [CARRIER NAME]

**Date:** [date]
**Vapi call ID:** [id]
**Outcome:** validated / partially validated / blocked at provider-auth gate / call failed

## Disclosure compliance
- [ ] Stated "automated calling system" within first 10 seconds
- [ ] Stated practice name (test name) within first 10 seconds
- Transcript excerpt: [paste opening lines]

## Menu path taken
[Numbered list of menu options selected, in order — this becomes the real
`carrier_ivr_instructions` content once confirmed across 2+ calls]

1. ...
2. ...

## Stop point
- What was asked for when the call ended: [policy number / DOB / live human / other]
- Time from dial to stop point: [seconds]
- Did the assistant follow the hard-stop rule correctly (no invented data)? yes/no

## Anomalies
- Hold music behavior: [spoke during hold? stayed silent?]
- Voicemail detection: [n/a / correct / incorrect]
- Anything unexpected in the transcript: [...]

## Confidence
- Tested [n] times on [date(s)]
- Consistent menu path across runs? yes/no
- Ready to populate `carrier_ivr_instructions` in `vapi-squad-config.json`? yes/no — if no, what's missing
