import { useEffect, useState, useCallback } from 'react';
import {
  Card,
  CardHeader,
  Button,
  Badge,
  Modal,
  ProgressBar,
  Table,
  Thead,
  Tbody,
  Th,
  Tr,
  Td,
  TableEmpty,
  useToast,
} from '../../components/ui';

interface Campaign {
  id: string;
  name: string;
  active: boolean;
  totalProspects: number;
  emailsSent: number;
  emailsOpened: number;
  emailsClicked: number;
  repliedCount: number;
  convertedCount: number;
  conversionRate: string;
  createdAt: string;
  updatedAt: string;
}

interface Prospect {
  id: string;
  practiceName: string;
  contactName?: string;
  email?: string;
  city?: string;
  province?: string;
  stage: string;
  score?: number;
  lastEmailSentAt?: string;
  emailOpenCount: number;
  emailClickCount: number;
  closedWonAt?: string;
  emailRepliedAt?: string;
  tier?: string;
  segment?: string;
}

interface EmailEvent {
  id: string;
  eventType: string;
  eventTimestamp: string;
  emailSubject?: string;
  metadata?: Record<string, unknown>;
}

interface CampaignStats {
  totalProspects: number;
  emailsSent: number;
  emailsOpened: number;
  emailsClicked: number;
  repliedCount: number;
  convertedCount: number;
  conversionRate: string;
  bouncedCount: number;
  eventsByType: Record<string, number>;
}

interface TopProspect {
  id: string;
  practiceName: string;
  contactName?: string;
  email?: string;
  city?: string;
  engagement: number;
  emailOpenCount: number;
  emailClickCount: number;
  stage: string;
}

type CityFilter = string | null;
type SegmentFilter = string | null;
type TierFilter = string | null;

export function CampaignManager() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [campaignStats, setCampaignStats] = useState<CampaignStats | null>(null);
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(null);
  const [prospects, setProspects] = useState<Prospect[]>([]);
  const [topProspects, setTopProspects] = useState<TopProspect[]>([]);
  const [filteredProspects, setFilteredProspects] = useState<Prospect[]>([]);
  const [loading, setLoading] = useState(false);
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [campaignName, setCampaignName] = useState('');
  const [emailsSentToday, setEmailsSentToday] = useState(0);
  const [selectedProspectId, setSelectedProspectId] = useState<string | null>(null);
  const [prospectHistory, setProspectHistory] = useState<EmailEvent[]>([]);
  const [cityFilter, setCityFilter] = useState<CityFilter>(null);
  const [segmentFilter, setSegmentFilter] = useState<SegmentFilter>(null);
  const [tierFilter, setTierFilter] = useState<TierFilter>(null);
  const [cities, setCities] = useState<string[]>([]);
  const [segments, setSegments] = useState<string[]>([]);
  const [tiers, setTiers] = useState<string[]>([]);
  const { showToast } = useToast();

  useEffect(() => {
    fetchCampaigns();
  }, []);

  useEffect(() => {
    if (selectedCampaignId) {
      fetchCampaignStats(selectedCampaignId);
      fetchProspects(selectedCampaignId);
      fetchTopProspects(selectedCampaignId);
      fetchEmailsSentToday(selectedCampaignId);
    }
  }, [selectedCampaignId]);

  useEffect(() => {
    applyFilters();
  }, [prospects, cityFilter, segmentFilter, tierFilter]);

  const fetchCampaigns = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/campaigns');
      if (res.ok) {
        const data = (await res.json()) as Campaign[];
        setCampaigns(data);
      } else {
        showToast('error', 'Failed to fetch campaigns');
      }
    } catch (err) {
      console.error('Failed to fetch campaigns', err);
      showToast('error', 'Error loading campaigns');
    } finally {
      setLoading(false);
    }
  };

  const fetchCampaignStats = async (campaignId: string) => {
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/stats`);
      if (res.ok) {
        const data = (await res.json()) as { stats: CampaignStats };
        setCampaignStats(data.stats);
      }
    } catch (err) {
      console.error('Failed to fetch campaign stats', err);
    }
  };

  const fetchProspects = async (campaignId: string) => {
    try {
      setLoading(true);
      const res = await fetch(`/api/campaigns/${campaignId}/prospects`);
      if (res.ok) {
        const data = (await res.json()) as Prospect[];
        setProspects(data);
        extractFilterOptions(data);
      }
    } catch (err) {
      console.error('Failed to fetch prospects', err);
      showToast('error', 'Error loading prospects');
    } finally {
      setLoading(false);
    }
  };

  const fetchTopProspects = async (campaignId: string) => {
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/prospects?sort=engagement&limit=10`);
      if (res.ok) {
        const data = (await res.json()) as Prospect[];
        const topList = data.map((p) => ({
          ...p,
          engagement: (p.emailOpenCount || 0) + (p.emailClickCount || 0) * 2,
        })) as TopProspect[];
        setTopProspects(topList);
      }
    } catch (err) {
      console.error('Failed to fetch top prospects', err);
    }
  };

  const fetchEmailsSentToday = async (campaignId: string) => {
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/emails-sent-today`);
      if (res.ok) {
        const data = (await res.json()) as { count: number };
        setEmailsSentToday(data.count);
      }
    } catch (err) {
      console.error('Failed to fetch emails sent today', err);
    }
  };

  const fetchProspectHistory = async (prospectId: string) => {
    try {
      const res = await fetch(`/api/campaigns/prospects/${prospectId}/history`);
      if (res.ok) {
        const data = (await res.json()) as EmailEvent[];
        setProspectHistory(data);
      }
    } catch (err) {
      console.error('Failed to fetch prospect history', err);
      showToast('error', 'Error loading prospect history');
    }
  };

  const extractFilterOptions = (prospectsData: Prospect[]) => {
    const citySet = new Set<string>();
    const segmentSet = new Set<string>();
    const tierSet = new Set<string>();

    prospectsData.forEach((p) => {
      if (p.city) citySet.add(p.city);
      if (p.segment) segmentSet.add(p.segment);
      if (p.tier) tierSet.add(p.tier);
    });

    setCities(Array.from(citySet).sort());
    setSegments(Array.from(segmentSet).sort());
    setTiers(Array.from(tierSet).sort());
  };

  const applyFilters = () => {
    let filtered = prospects;

    if (cityFilter) {
      filtered = filtered.filter((p) => p.city === cityFilter);
    }
    if (segmentFilter) {
      filtered = filtered.filter((p) => p.segment === segmentFilter);
    }
    if (tierFilter) {
      filtered = filtered.filter((p) => p.tier === tierFilter);
    }

    setFilteredProspects(filtered);
  };

  const handleImportCSV = async () => {
    if (!csvFile || !campaignName.trim()) {
      showToast('error', 'Please provide campaign name and CSV file');
      return;
    }

    const text = await csvFile.text();
    const lines = text.split('\n');
    const headers = lines[0].split(',').map((h) => h.trim());

    const prospectList: Array<Record<string, string>> = [];
    for (let i = 1; i < lines.length; i++) {
      if (!lines[i].trim()) continue;
      const values = lines[i].split(',').map((v) => v.trim());
      const prospect: Record<string, string> = {};

      headers.forEach((header, idx) => {
        const key = header.toLowerCase().replace(/\s+/g, '');
        prospect[key] = values[idx] || '';
      });

      if (prospect.email) {
        prospectList.push({
          practiceName: prospect.practicename || '',
          contactName: prospect.contactname || prospect.owner || '',
          email: prospect.email,
          city: prospect.city || '',
          province: prospect.province || 'ON',
        });
      }
    }

    setLoading(true);
    try {
      const res = await fetch('/api/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: campaignName.trim() }),
      });

      if (res.ok) {
        showToast('success', 'Campaign created successfully');
        setCsvFile(null);
        setCampaignName('');
        fetchCampaigns();
      } else {
        showToast('error', 'Failed to create campaign');
      }
    } catch (err) {
      console.error('Import failed', err);
      showToast('error', 'Import failed');
    } finally {
      setLoading(false);
    }
  };

  const handleSendBatch = async () => {
    if (!selectedCampaignId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/campaigns/${selectedCampaignId}/send-batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          emailSubject: 'Check out CollectRx',
        }),
      });

      if (res.ok) {
        const data = (await res.json()) as { batchSize: number };
        showToast('success', `Queued ${data.batchSize} prospects for sending`);
        fetchCampaigns();
        if (selectedCampaignId) {
          fetchCampaignStats(selectedCampaignId);
          fetchProspects(selectedCampaignId);
          fetchEmailsSentToday(selectedCampaignId);
        }
      } else {
        showToast('error', 'Failed to send batch');
      }
    } catch (err) {
      console.error('Send batch failed', err);
      showToast('error', 'Send batch failed');
    } finally {
      setLoading(false);
    }
  };

  const handleSendFollowups = async () => {
    if (!selectedCampaignId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/campaigns/${selectedCampaignId}/send-batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          emailSubject: 'Quick follow-up',
        }),
      });

      if (res.ok) {
        const data = (await res.json()) as { batchSize: number };
        showToast('success', `Queued ${data.batchSize} follow-up emails`);
        fetchCampaigns();
        if (selectedCampaignId) {
          fetchCampaignStats(selectedCampaignId);
          fetchProspects(selectedCampaignId);
        }
      } else {
        showToast('error', 'Failed to send follow-ups');
      }
    } catch (err) {
      console.error('Send follow-ups failed', err);
      showToast('error', 'Send follow-ups failed');
    } finally {
      setLoading(false);
    }
  };

  const handleExportReports = async () => {
    if (!selectedCampaignId) return;

    try {
      const campaign = campaigns.find((c) => c.id === selectedCampaignId);
      if (!campaign || !campaignStats) return;

      const csvContent = [
        ['Campaign Report'],
        [`Campaign: ${campaign.name}`],
        [`Generated: ${new Date().toISOString()}`],
        [],
        ['Metrics'],
        ['Total Prospects', campaignStats.totalProspects],
        ['Emails Sent', campaignStats.emailsSent],
        ['Emails Opened', campaignStats.emailsOpened],
        ['Emails Clicked', campaignStats.emailsClicked],
        ['Replies', campaignStats.repliedCount],
        ['Conversions', campaignStats.convertedCount],
        ['Conversion Rate', `${campaignStats.conversionRate}%`],
        [],
        ['Prospect Details'],
        ['Practice', 'Contact', 'Email', 'City', 'Stage', 'Opens', 'Clicks', 'Last Email'],
        ...prospects.map((p) => [
          p.practiceName,
          p.contactName || '',
          p.email || '',
          p.city || '',
          p.stage,
          p.emailOpenCount,
          p.emailClickCount,
          p.lastEmailSentAt ? new Date(p.lastEmailSentAt).toLocaleDateString() : '',
        ]),
      ];

      const csv = csvContent.map((row) => row.join(',')).join('\n');
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `campaign-report-${selectedCampaignId}-${Date.now()}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      showToast('success', 'Report exported successfully');
    } catch (err) {
      console.error('Export failed', err);
      showToast('error', 'Export failed');
    }
  };

  const handleSelectProspect = useCallback((prospectId: string) => {
    setSelectedProspectId(prospectId);
    fetchProspectHistory(prospectId);
  }, []);

  const handleClearFilters = () => {
    setCityFilter(null);
    setSegmentFilter(null);
    setTierFilter(null);
  };

  const selectedProspect = prospects.find((p) => p.id === selectedProspectId);

  return (
    <div className="space-y-6 p-6">
      <Card>
        <CardHeader
          title="Email Campaign Manager"
          subtitle="Monitor active campaigns, track engagement, and manage bulk email operations"
        />
      </Card>

      {/* Campaign Selection and Overview */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card>
          <CardHeader title="Active Campaigns" />
          <div className="space-y-2 p-4">
            {campaigns.length === 0 ? (
              <p className="text-sm text-gray-600">No campaigns found</p>
            ) : (
              campaigns.map((campaign) => (
                <button
                  key={campaign.id}
                  onClick={() => setSelectedCampaignId(campaign.id)}
                  className={`w-full text-left p-3 rounded-md border-2 transition ${
                    selectedCampaignId === campaign.id
                      ? 'border-blue-500 bg-blue-50'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <div className="font-medium text-sm">{campaign.name}</div>
                  <div className="text-xs text-gray-600 mt-1">
                    {campaign.totalProspects} prospects • {campaign.emailsOpened} opened
                  </div>
                  <div className="flex gap-2 mt-2">
                    <Badge color={campaign.active ? 'green' : 'gray'}>
                      {campaign.active ? 'Active' : 'Inactive'}
                    </Badge>
                  </div>
                </button>
              ))
            )}
          </div>
        </Card>

        {/* Stats Cards */}
        {campaignStats && selectedCampaignId && (
          <Card>
            <CardHeader title="Campaign Stats" />
            <div className="space-y-3 p-4">
              <div>
                <div className="text-xs text-gray-600">Total Prospects</div>
                <div className="text-2xl font-bold">{campaignStats.totalProspects}</div>
              </div>
              <div>
                <div className="text-xs text-gray-600">Open Rate</div>
                <div className="text-2xl font-bold">
                  {campaignStats.emailsSent > 0
                    ? ((campaignStats.emailsOpened / campaignStats.emailsSent) * 100).toFixed(1)
                    : '0'}
                  %
                </div>
              </div>
              <div>
                <div className="text-xs text-gray-600">Click Rate</div>
                <div className="text-2xl font-bold">
                  {campaignStats.emailsSent > 0
                    ? ((campaignStats.emailsClicked / campaignStats.emailsSent) * 100).toFixed(1)
                    : '0'}
                  %
                </div>
              </div>
              <div>
                <div className="text-xs text-gray-600">Conversion Rate</div>
                <div className="text-2xl font-bold text-green-600">{campaignStats.conversionRate}%</div>
              </div>
            </div>
          </Card>
        )}

        {/* Emails Sent Today */}
        {selectedCampaignId && (
          <Card>
            <CardHeader title="Today's Progress" />
            <div className="p-4 space-y-3">
              <div>
                <ProgressBar
                  value={Math.min((emailsSentToday / 100) * 100, 100)}
                  label="Emails Sent Today"
                  amount={`${emailsSentToday} sent`}
                  color="#3B82F6"
                  height={10}
                />
              </div>
              <div className="text-xs text-gray-600 pt-2 border-t">
                {new Date().toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </div>
            </div>
          </Card>
        )}
      </div>

      {/* Bulk Actions */}
      {selectedCampaignId && (
        <Card>
          <CardHeader title="Bulk Actions" />
          <div className="p-4 flex flex-wrap gap-3">
            <Button
              onClick={handleSendBatch}
              disabled={loading}
              variant="primary"
            >
              {loading ? 'Sending...' : 'Send Initial Batch'}
            </Button>
            <Button
              onClick={handleSendFollowups}
              disabled={loading}
              variant="secondary"
            >
              {loading ? 'Sending...' : 'Send Follow-ups'}
            </Button>
            <Button
              onClick={handleExportReports}
              disabled={loading}
              variant="secondary"
            >
              Export Reports (CSV)
            </Button>
          </div>
        </Card>
      )}

      {/* Top Prospects by Engagement */}
      {selectedCampaignId && topProspects.length > 0 && (
        <Card>
          <CardHeader title="Top Prospects by Engagement" subtitle="Sorted by opens + clicks" />
          <div className="overflow-x-auto">
            <Table>
              <Thead>
                <Tr>
                  <Th>Practice</Th>
                  <Th>Contact</Th>
                  <Th>City</Th>
                  <Th>Opens</Th>
                  <Th>Clicks</Th>
                  <Th>Engagement Score</Th>
                  <Th>Stage</Th>
                  <Th>Action</Th>
                </Tr>
              </Thead>
              <Tbody>
                {topProspects.map((prospect) => (
                  <Tr key={prospect.id}>
                    <Td>{prospect.practiceName}</Td>
                    <Td>{prospect.contactName || '-'}</Td>
                    <Td>{prospect.city || '-'}</Td>
                    <Td>{prospect.emailOpenCount}</Td>
                    <Td>{prospect.emailClickCount}</Td>
                    <Td>
                      <Badge color="green">{prospect.engagement}</Badge>
                    </Td>
                    <Td>
                      <Badge color="blue">{prospect.stage}</Badge>
                    </Td>
                    <Td>
                      <button
                        onClick={() => handleSelectProspect(prospect.id)}
                        className="text-xs text-blue-600 hover:underline"
                      >
                        Details
                      </button>
                    </Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
          </div>
        </Card>
      )}

      {/* Filters and All Prospects */}
      {selectedCampaignId && (
        <Card>
          <CardHeader title="All Prospects" subtitle="Filter and view full prospect list" />
          <div className="p-4 space-y-4">
            {/* Filters */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 pb-4 border-b">
              <div>
                <label htmlFor="city-filter" className="block text-xs font-medium text-gray-700 mb-1">City</label>
                <select
                  id="city-filter"
                  value={cityFilter || ''}
                  onChange={(e) => setCityFilter(e.target.value || null)}
                  className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                >
                  <option value="">All Cities</option>
                  {cities.map((city) => (
                    <option key={city} value={city}>
                      {city}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="segment-filter" className="block text-xs font-medium text-gray-700 mb-1">Segment</label>
                <select
                  id="segment-filter"
                  value={segmentFilter || ''}
                  onChange={(e) => setSegmentFilter(e.target.value || null)}
                  className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                >
                  <option value="">All Segments</option>
                  {segments.map((seg) => (
                    <option key={seg} value={seg}>
                      {seg}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="tier-filter" className="block text-xs font-medium text-gray-700 mb-1">Tier</label>
                <select
                  id="tier-filter"
                  value={tierFilter || ''}
                  onChange={(e) => setTierFilter(e.target.value || null)}
                  className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                >
                  <option value="">All Tiers</option>
                  {tiers.map((tier) => (
                    <option key={tier} value={tier}>
                      {tier}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex items-end">
                <Button onClick={handleClearFilters} variant="secondary" className="w-full">
                  Clear Filters
                </Button>
              </div>
            </div>

            {/* Prospects Table */}
            {filteredProspects.length > 0 ? (
              <div className="overflow-x-auto">
                <Table>
                  <Thead>
                    <Tr>
                      <Th>Practice</Th>
                      <Th>Contact</Th>
                      <Th>Email</Th>
                      <Th>City</Th>
                      <Th>Stage</Th>
                      <Th>Opens</Th>
                      <Th>Clicks</Th>
                      <Th>Last Email</Th>
                      <Th>Action</Th>
                    </Tr>
                  </Thead>
                  <Tbody>
                    {filteredProspects.map((prospect) => (
                      <Tr key={prospect.id}>
                        <Td className="font-medium">{prospect.practiceName}</Td>
                        <Td>{prospect.contactName || '-'}</Td>
                        <Td className="text-xs text-blue-600">{prospect.email || '-'}</Td>
                        <Td>{prospect.city || '-'}</Td>
                        <Td>
                          <Badge
                            color={
                              prospect.stage === 'engaged'
                                ? 'green'
                                : prospect.stage === 'bounced'
                                  ? 'red'
                                  : 'gray'
                            }
                          >
                            {prospect.stage}
                          </Badge>
                        </Td>
                        <Td>{prospect.emailOpenCount || 0}</Td>
                        <Td>{prospect.emailClickCount || 0}</Td>
                        <Td className="text-xs">
                          {prospect.lastEmailSentAt
                            ? new Date(prospect.lastEmailSentAt).toLocaleDateString()
                            : 'Never'}
                        </Td>
                        <Td>
                          <button
                            onClick={() => handleSelectProspect(prospect.id)}
                            className="text-xs text-blue-600 hover:underline font-medium"
                          >
                            View
                          </button>
                        </Td>
                      </Tr>
                    ))}
                  </Tbody>
                </Table>
              </div>
            ) : (
              <Tbody>
                <TableEmpty
                  message={
                    cityFilter || segmentFilter || tierFilter
                      ? 'No prospects found. Try adjusting your filters.'
                      : 'No prospects to display'
                  }
                  colSpan={9}
                />
              </Tbody>
            )}
          </div>
        </Card>
      )}

      {/* Import Campaign */}
      <Card>
        <CardHeader title="Import Campaign from CSV" />
        <div className="p-4 space-y-4">
          <div>
            <label htmlFor="campaign-name" className="block text-sm font-medium text-gray-700 mb-2">Campaign Name</label>
            <input
              id="campaign-name"
              type="text"
              value={campaignName}
              onChange={(e) => setCampaignName(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="e.g., Ottawa GTA Q3 Outreach"
            />
          </div>
          <div>
            <label htmlFor="csv-file" className="block text-sm font-medium text-gray-700 mb-2">CSV File</label>
            <input
              id="csv-file"
              type="file"
              accept=".csv"
              onChange={(e) => setCsvFile(e.target.files?.[0] || null)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
            />
            <p className="text-xs text-gray-600 mt-1">
              Expected columns: practiceName, contactName, email, city, province (optional: segment, tier)
            </p>
          </div>
          <Button onClick={handleImportCSV} disabled={loading} variant="primary">
            {loading ? 'Importing...' : 'Import Campaign'}
          </Button>
        </div>
      </Card>

      {/* Prospect Detail Modal */}
      {selectedProspectId && selectedProspect && (
        <Modal
          open={!!selectedProspectId}
          onClose={() => setSelectedProspectId(null)}
          title={`${selectedProspect.practiceName} - ${selectedProspect.contactName || 'Contact'}`}
        >
          <div className="space-y-4">
            {/* Prospect Info */}
            <div className="grid grid-cols-2 gap-4 pb-4 border-b">
              <div>
                <div className="text-xs text-gray-600">Email</div>
                <div className="font-medium text-sm">{selectedProspect.email || '-'}</div>
              </div>
              <div>
                <div className="text-xs text-gray-600">City</div>
                <div className="font-medium text-sm">{selectedProspect.city || '-'}</div>
              </div>
              <div>
                <div className="text-xs text-gray-600">Stage</div>
                <Badge color="blue">{selectedProspect.stage}</Badge>
              </div>
              <div>
                <div className="text-xs text-gray-600">Engagement</div>
                <div className="font-medium text-sm">
                  {(selectedProspect.emailOpenCount || 0) + (selectedProspect.emailClickCount || 0) * 2}
                </div>
              </div>
            </div>

            {/* Email History */}
            <div>
              <h4 className="font-medium mb-3">Email Activity</h4>
              {prospectHistory.length > 0 ? (
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {prospectHistory.map((event) => (
                    <div
                      key={event.id}
                      className="flex justify-between items-start p-2 bg-gray-50 rounded text-xs"
                    >
                      <div>
                        <Badge color="gray">{event.eventType}</Badge>
                        {event.emailSubject && (
                          <div className="text-gray-700 mt-1">{event.emailSubject}</div>
                        )}
                      </div>
                      <div className="text-gray-600">
                        {new Date(event.eventTimestamp).toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-gray-600">No email events recorded</p>
              )}
            </div>

            {/* Summary Stats */}
            <div className="grid grid-cols-3 gap-2 pt-4 border-t">
              <div className="text-center">
                <div className="text-lg font-bold text-blue-600">{selectedProspect.emailOpenCount || 0}</div>
                <div className="text-xs text-gray-600">Opens</div>
              </div>
              <div className="text-center">
                <div className="text-lg font-bold text-green-600">{selectedProspect.emailClickCount || 0}</div>
                <div className="text-xs text-gray-600">Clicks</div>
              </div>
              <div className="text-center">
                <div className="text-lg font-bold text-purple-600">
                  {selectedProspect.emailRepliedAt ? '1' : '0'}
                </div>
                <div className="text-xs text-gray-600">Replies</div>
              </div>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
