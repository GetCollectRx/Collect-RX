import { DefaultAzureCredential } from "@azure/identity";
import { BlobServiceClient } from "@azure/storage-blob";
import { RetentionError } from "./types.js";

const MAX_NAMES_KEPT = 1000;

export interface BlobQuery {
  account: string;
  container: string;
  prefix: string;
  callId: string;
}

export type BlobLister = (query: BlobQuery) => Promise<string[]>;

/**
 * Lists blob names under a prefix whose name contains the call id. Blob contents
 * are never downloaded. Authentication is DefaultAzureCredential only.
 */
export const listMatchingBlobs: BlobLister = async (query) => {
  const needle = query.callId.toLowerCase();
  const names: string[] = [];
  try {
    const service = new BlobServiceClient(
      `https://${query.account}.blob.core.windows.net`,
      new DefaultAzureCredential(),
    );
    const container = service.getContainerClient(query.container);
    for await (const blob of container.listBlobsFlat({ prefix: query.prefix })) {
      if (blob.name.toLowerCase().includes(needle) && names.length < MAX_NAMES_KEPT) {
        names.push(blob.name);
      }
    }
  } catch (error) {
    // Only the error class and status are kept: messages can echo account or request details.
    const status = typeof error === "object" && error !== null && "statusCode" in error ? error.statusCode : undefined;
    const label = error instanceof Error ? error.name : "UnknownError";
    const suffix = typeof status === "number" ? ` (HTTP ${String(status)})` : "";
    throw new RetentionError("azure", `Azure listing failed: ${label}${suffix}`);
  }
  return names;
};
