/**
 * PMS connector registry — AbelDent is production; Dentrix is a registered stub for phase 2.
 */
export type PmsConnectorId = 'abeldent' | 'dentrix';

export interface PmsConnectorDescriptor {
  id: PmsConnectorId;
  label: string;
  ingestMode: 'desktop_connector' | 'csv_only';
  status: 'production' | 'planned';
  docsPath?: string;
}

export const PMS_CONNECTORS: PmsConnectorDescriptor[] = [
  {
    id: 'abeldent',
    label: 'AbelDent',
    ingestMode: 'desktop_connector',
    status: 'production',
  },
  {
    id: 'dentrix',
    label: 'Dentrix',
    ingestMode: 'desktop_connector',
    status: 'planned',
    docsPath: 'docs/product/DENTRIX-CONNECTOR-SPIKE.md',
  },
];

export function getPmsConnector(id: string): PmsConnectorDescriptor | undefined {
  return PMS_CONNECTORS.find((c) => c.id === id);
}

export function assertPmsConnectorProduction(id: string): void {
  const c = getPmsConnector(id);
  if (!c || c.status !== 'production') {
    throw new Error(`PMS connector "${id}" is not production-ready`);
  }
}
