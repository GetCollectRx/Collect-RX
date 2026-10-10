# log_call_outcome (tool id ce2c119d-eaaa-4d14-9980-3d946ee9cd5d, shown as v3)
Posts to https://collect-rx.fly.dev/api/webhooks/vapi. Strict mode off, async off.

Required: scenario (enum of 10: CLAIM_NOT_RECEIVED, NOT_COVERED, MAX_BENEFITS_REACHED, NEED_INFORMATION, PROCESSING, CLAIM_PAID, PARTIAL_PAYMENT, CLAIM_DENIED, TRANSFER, UNCLEAR), callSummary (2 to 4 sentences, no patient name, DOB, or full claim or policy numbers).
Optional strings: repName (default ""), eobSentDate, appealRights, deadlineDate, deadlineAction, referenceNumber, shortfallReason, unresolvedFields, amountStatedByRep, denialOrReductionCode, submissionDestination, submissionMethod, documentationRequested.
Optional booleans: eobSentToPatient, matchesExpectedAmount, automationSuspicionFlag.

# request_staff_handoff (tool id 545fd4a4-1859-40f1-a872-eef0bdaf3a76, shown as v2)
No parameters. Same URL, 20 second timeout, HMAC credential collectrx-backend-hmac.
