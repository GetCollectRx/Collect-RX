/**
 * Whether an API error message is an access denial (the role or grant does not allow the page) as opposed to a
 * fault. A denial is the system working as designed, so it must not be shown as "Something went wrong".
 */
const DENIAL_PATTERN = /does not have access|no auditor grant|access denied|not authorized|not authorised|forbidden/iu;

export function isAccessDeniedMessage(message: string): boolean {
  return DENIAL_PATTERN.test(message);
}

/** What to tell the person. Keeps the server's reason, adds what they can do about it. */
export function accessDeniedGuidance(message: string): string {
  if (/grant/iu.test(message)) {
    return 'Ask the practice owner to grant you access to this practice.';
  }
  return 'Your role cannot open this page. Use the menu on the left for the pages your role includes.';
}
