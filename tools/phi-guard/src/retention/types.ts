export interface FieldStatus {
  /** Dotted path of a content field in the source's response. */
  field: string;
  present: boolean;
}

export interface SourceResult {
  /**
   * False when the call has not finished, so absent fields prove nothing yet.
   */
  complete: boolean;
  /** A short fixed-vocabulary note about the call state. Never response content. */
  detail: string;
  fields: FieldStatus[];
}

/**
 * Where call content could be retained. Vapi is the only implementation now;
 * a LiveKit source can implement this without changes to the CLI.
 */
export interface RetentionSource {
  readonly name: string;
  check(callId: string): Promise<SourceResult>;
}

export type RetentionErrorKind = "network" | "http" | "parse" | "size" | "azure";

/** Carries a fixed message only: never response bodies, field values, or credentials. */
export class RetentionError extends Error {
  readonly kind: RetentionErrorKind;

  constructor(kind: RetentionErrorKind, message: string) {
    super(message);
    this.name = "RetentionError";
    this.kind = kind;
  }
}
