export type IdentifierType =
  | "PATIENT_NAME"
  | "DOB"
  | "DATE"
  | "MEMBER_ID"
  | "CLAIM_NUMBER"
  | "HEALTH_NUMBER"
  | "PHONE"
  | "EMAIL"
  | "DIGIT_SEQUENCE";

export interface CallContext {
  patientFirstName?: string;
  patientLastName?: string;
  /** ISO 8601, YYYY-MM-DD */
  dateOfBirth?: string;
  memberId?: string;
  claimNumber?: string;
}

export interface Finding {
  token: string;
  type: IdentifierType;
}

export interface RedactionResult {
  redacted: string;
  findings: Finding[];
}
