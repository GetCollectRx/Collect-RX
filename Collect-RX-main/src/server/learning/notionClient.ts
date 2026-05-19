import type { NotionLearningItem } from './types.js';

const NOTION_VERSION = '2022-06-28';

type NotionProp = {
  type: string;
  title?: { plain_text: string }[];
  rich_text?: { plain_text: string }[];
  select?: { name: string } | null;
  status?: { name: string } | null;
  number?: number | null;
};

function plainFromRich(prop: NotionProp | undefined): string {
  if (!prop) return '';
  if (prop.type === 'title' && prop.title) {
    return prop.title.map((t) => t.plain_text).join('');
  }
  if (prop.type === 'rich_text' && prop.rich_text) {
    return prop.rich_text.map((t) => t.plain_text).join('');
  }
  if (prop.type === 'select' && prop.select) return prop.select.name;
  if (prop.type === 'status' && prop.status) return prop.status.name;
  if (prop.type === 'number' && prop.number != null) return String(prop.number);
  return '';
}

function pickProp(props: Record<string, NotionProp>, names: string[]): NotionProp | undefined {
  for (const n of names) {
    if (props[n]) return props[n];
  }
  const lower = Object.fromEntries(
    Object.entries(props).map(([k, v]) => [k.toLowerCase(), v]),
  );
  for (const n of names) {
    if (lower[n.toLowerCase()]) return lower[n.toLowerCase()];
  }
  return undefined;
}

export function getNotionConfig(): { apiKey: string; databaseId: string } | null {
  const apiKey = (process.env.NOTION_API_KEY || '').trim();
  const databaseId = (process.env.NOTION_LEARNING_DATABASE_ID || '').trim();
  if (!apiKey || !databaseId) return null;
  return { apiKey, databaseId };
}

export async function pullLearningBacklog(
  statuses: string[],
): Promise<NotionLearningItem[]> {
  const cfg = getNotionConfig();
  if (!cfg) {
    throw new Error('NOTION_API_KEY and NOTION_LEARNING_DATABASE_ID are required');
  }

  const filter =
    statuses.length === 1
      ? {
          property: 'Status',
          status: { equals: statuses[0] },
        }
      : {
          or: statuses.map((name) => ({
            property: 'Status',
            status: { equals: name },
          })),
        };

  const res = await fetch(
    `https://api.notion.com/v1/databases/${cfg.databaseId}/query`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cfg.apiKey}`,
        'Notion-Version': NOTION_VERSION,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        filter,
        page_size: 50,
      }),
    },
  );

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Notion query failed (${res.status}): ${body.slice(0, 400)}`);
  }

  const data = (await res.json()) as {
    results: { id: string; properties: Record<string, NotionProp> }[];
  };

  return data.results.map((page) => {
    const props = page.properties;
    const title =
      plainFromRich(pickProp(props, ['Name', 'Title', 'Task'])) || 'Untitled';
    const status = plainFromRich(pickProp(props, ['Status'])) || '';
    const priority = plainFromRich(pickProp(props, ['Priority'])) || 'P2';
    const phase = plainFromRich(pickProp(props, ['Phase'])) || '';
    const description =
      plainFromRich(pickProp(props, ['Description', 'Notes', 'Details'])) || '';
    const effortProp = pickProp(props, ['Effort', 'Points', 'Story Points']);
    const effortPoints =
      effortProp?.type === 'number' && effortProp.number != null
        ? effortProp.number
        : null;

    return {
      pageId: page.id,
      title,
      status,
      priority,
      phase,
      description,
      effortPoints,
    };
  });
}

export async function appendResearchToNotionPage(
  pageId: string,
  markdown: string,
): Promise<void> {
  const cfg = getNotionConfig();
  if (!cfg) return;

  const lines = markdown.split('\n').slice(0, 40);
  const children = lines.map((line) => ({
    object: 'block',
    type: 'paragraph',
    paragraph: {
      rich_text: [{ type: 'text', text: { content: line.slice(0, 2000) } }],
    },
  }));

  await fetch(`https://api.notion.com/v1/blocks/${pageId}/children`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${cfg.apiKey}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ children }),
  });
}

export async function updateNotionPageStatus(
  pageId: string,
  statusName: string,
): Promise<void> {
  const cfg = getNotionConfig();
  if (!cfg) return;

  await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${cfg.apiKey}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      properties: {
        Status: { status: { name: statusName } },
      },
    }),
  });
}
