export function generateMessageBody(
  templateKey: string,
  patientDisplayName: string,
  amount: number,
  balanceId: string,
  daysOutstanding: number
): string {
  const paymentLink = `http://localhost:5173/pay/${balanceId}`;

  const templates: Record<string, string> = {
    NOTIFIED: `Hi ${patientDisplayName},

This is a friendly reminder that you have an outstanding balance of $${amount.toFixed(2)} from your recent visit.

You can easily pay online using this secure link:
${paymentLink}

If you have any questions or need to discuss payment options, please don't hesitate to reach out to us.

Thank you for choosing our practice!`,

    REMINDER_1: `Dear ${patientDisplayName},

We wanted to follow up regarding your outstanding balance of $${amount.toFixed(2)}, which is now ${daysOutstanding} days past due.

Please submit your payment at your earliest convenience:
${paymentLink}

If you're experiencing any difficulties with payment or have questions about your account, please contact our office so we can assist you.

Thank you for your prompt attention to this matter.`,

    REMINDER_2: `Dear ${patientDisplayName},

Your account has an overdue balance of $${amount.toFixed(2)} that is ${daysOutstanding} days outstanding.

Immediate payment is required to avoid further collection action. Please pay now:
${paymentLink}

If this balance is not resolved within the next few days, your account may be escalated for additional review.

Please contact our office immediately if you need to arrange a payment plan or discuss this balance.`,

    ESCALATED: `IMPORTANT NOTICE - ${patientDisplayName}

Your account balance of $${amount.toFixed(2)} is now ${daysOutstanding} days past due and has been escalated for administrative review.

Per our practice policy, accounts that remain unpaid beyond this point may be:
- Reported to credit agencies
- Subject to collection proceedings
- Restricted from future scheduling

FINAL OPPORTUNITY TO PAY:
${paymentLink}

Contact our billing department immediately at [Practice Phone] to resolve this matter.`
  };

  return templates[templateKey] || `Message for ${patientDisplayName} regarding $${amount.toFixed(2)}`;
}
