import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import { startRulesEngine } from './rulesEngine.js';
import loadSecretsFromParameterStore from './awsConfig.js';
import { createEstimateRouter, createReconciliationRouter } from './routes/estimates.js';
import { createAuthRouter } from './routes/auth.js';
import { createSyncImportRouter } from './routes/syncImport.js';
import { requireAuth } from './middleware/auth.js';
import { auditMiddleware } from './middleware/auditLog.js';
import { sanitizeBody, guardSqlInjection } from './middleware/validation.js';
import { apiLimiter, authLimiter } from './middleware/rateLimiter.js';

const app = express();
const prisma = new PrismaClient();
let PORT = process.env.PORT || 3000;

// Load secrets from AWS Parameter Store (production) or .env (development)
async function initializeApp() {
  try {
    const secrets = await loadSecretsFromParameterStore();
    PORT = parseInt(secrets.PORT || '3000', 10);

    // Set environment variables for other services (Vapi, SendGrid, etc.)
    process.env.VAPI_API_KEY = secrets.VAPI_API_KEY;
    process.env.DATABASE_URL = secrets.DATABASE_URL;
    if (secrets.VAPI_WEBHOOK_SECRET) {
      process.env.VAPI_WEBHOOK_SECRET = secrets.VAPI_WEBHOOK_SECRET;
    }

    console.log('✅ Secrets loaded successfully');
    startServer();
  } catch (error) {
    console.error('❌ Failed to initialize app:', error);
    process.exit(1);
  }
}

function startServer() {

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc : ["'self'"],
      scriptSrc  : ["'self'"],
      styleSrc   : ["'self'", "'unsafe-inline'"],
      imgSrc     : ["'self'", 'data:', 'https:'],
      connectSrc : ["'self'"],
      fontSrc    : ["'self'"],
      objectSrc  : ["'none'"],
      frameSrc   : ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false, // allow Electron renderer
}));
app.use(cors());
app.use(express.json({ limit: '1mb' }));

// ── Security middleware (applied globally) ────────────────────────────────
app.use(sanitizeBody);
app.use(guardSqlInjection);
app.use(apiLimiter);

// ── Audit logging for PHI access (runs after auth populates req.user) ────
app.use(auditMiddleware(prisma));

// ── Health check (public) ─────────────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ── Auth routes (public, but with strict rate limiting) ───────────────────
app.use('/api/auth', authLimiter, createAuthRouter(prisma));

// ── Phase 3: Estimate & Reconciliation Routes ─────────────────────────────
app.use('/api/estimates', createEstimateRouter(prisma));
app.use('/api/reconciliations', createReconciliationRouter(prisma));

// ── Phase 4: AbelDent Sync Import Routes (called by desktop sync service) ─
app.use('/api/patients', createSyncImportRouter(prisma));
app.use('/api/claims', createSyncImportRouter(prisma));

// ── All routes below require a valid JWT ─────────────────────────────────
app.use('/api/dashboard', requireAuth);
app.use('/api/analytics', requireAuth);
app.use('/api/balances', requireAuth);
app.use('/api/outreach', requireAuth);
app.use('/api/pay', requireAuth);
app.use('/api/rules', requireAuth);
app.use('/api/queue', requireAuth);
app.use('/api/admin', requireAuth);
app.use('/api/practices', requireAuth);

// Dashboard: recent activity (newest 10 balances regardless of status)
app.get('/api/dashboard/recent', async (req, res) => {
  try {
    const practiceId = req.query.practiceId as string;
    const balances = await prisma.balance.findMany({
      where: { practiceId },
      include: {
        patient: true,
        states: { orderBy: { stageAt: 'desc' }, take: 1 },
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    res.json(balances.map(b => ({
      id: b.id,
      amount: b.amountCents / 100,
      status: b.status,
      daysOutstanding: Math.floor((Date.now() - new Date(b.createdAt).getTime()) / 86_400_000),
      currentStage: b.states[0]?.stage ?? 'CREATED',
      createdAt: b.createdAt,
      patient: { displayName: b.patient.displayName },
    })));
  } catch (error) {
    console.error('Recent activity error:', error);
    res.status(500).json({ error: 'Failed to fetch recent activity' });
  }
});

// Dashboard stats
app.get('/api/dashboard/stats', async (req, res) => {
  try {
    const practiceId = req.query.practiceId as string;
    
    const openBalances = await prisma.balance.findMany({
      where: { 
        practiceId,
        status: 'OPEN' 
      },
      include: {
        states: {
          orderBy: { stageAt: 'desc' },
          take: 1
        }
      }
    });

    const totalOpenAR = openBalances.reduce((sum, b) => sum + b.amountCents, 0);

    const now = new Date();
    const aging = {
      '0-30': 0,
      '31-60': 0,
      '>60': 0
    };

    const stageCounts: Record<string, number> = {};

    openBalances.forEach(balance => {
      const daysOld = Math.floor((now.getTime() - balance.createdAt.getTime()) / (1000 * 60 * 60 * 24));
      
      if (daysOld <= 30) aging['0-30'] += balance.amountCents;
      else if (daysOld <= 60) aging['31-60'] += balance.amountCents;
      else aging['>60'] += balance.amountCents;

      const currentStage = balance.states[0]?.stage || 'CREATED';
      stageCounts[currentStage] = (stageCounts[currentStage] || 0) + 1;
    });

    res.json({
      totalOpenAR: totalOpenAR / 100,
      aging: {
        '0-30': aging['0-30'] / 100,
        '31-60': aging['31-60'] / 100,
        '>60': aging['>60'] / 100
      },
      stageCounts,
      openBalanceCount: openBalances.length
    });
  } catch (error) {
    console.error('Dashboard stats error:', error);
    res.status(500).json({ error: 'Failed to fetch dashboard stats' });
  }
});

// Analytics: Collection Rate
app.get('/api/analytics/collection-rate', async (req, res) => {
  try {
    const practiceId = req.query.practiceId as string;
    
    // Get all balances (including closed ones)
    const allBalances = await prisma.balance.findMany({
      where: { practiceId },
      include: {
        paymentEvents: true,
        states: {
          orderBy: { stageAt: 'asc' }
        }
      }
    });

    const paidBalances = allBalances.filter(b => b.status === 'PAID');
    const openBalances = allBalances.filter(b => b.status === 'OPEN');
    const totalBalances = allBalances.length;

    const collectionRate = totalBalances > 0 ? (paidBalances.length / totalBalances) * 100 : 0;
    
    // Calculate average days to payment
    const daysToPayment = paidBalances.map(b => {
      const firstState = b.states[0];
      const payment = b.paymentEvents[0];
      if (!firstState || !payment) return 0;
      return Math.floor((payment.paidAt.getTime() - firstState.stageAt.getTime()) / (1000 * 60 * 60 * 24));
    }).filter(d => d > 0);

    const avgDaysToPayment = daysToPayment.length > 0 
      ? daysToPayment.reduce((a, b) => a + b, 0) / daysToPayment.length 
      : 0;

    const totalCollected = paidBalances.reduce((sum, b) => sum + b.amountCents, 0);
    const totalOutstanding = openBalances.reduce((sum, b) => sum + b.amountCents, 0);

    res.json({
      collectionRate: Number(collectionRate.toFixed(2)),
      avgDaysToPayment: Number(avgDaysToPayment.toFixed(1)),
      totalCollected: totalCollected / 100,
      totalOutstanding: totalOutstanding / 100,
      paidCount: paidBalances.length,
      openCount: openBalances.length,
      totalCount: totalBalances
    });
  } catch (error) {
    console.error('Collection rate error:', error);
    res.status(500).json({ error: 'Failed to fetch collection rate' });
  }
});

// Analytics: Stage Funnel
app.get('/api/analytics/stage-funnel', async (req, res) => {
  try {
    const practiceId = req.query.practiceId as string;
    
    const allBalances = await prisma.balance.findMany({
      where: { practiceId },
      include: {
        states: {
          orderBy: { stageAt: 'asc' }
        }
      }
    });

    const stages = ['CREATED', 'NOTIFIED', 'REMINDER_1', 'REMINDER_2', 'ESCALATED', 'STAFF_REVIEW', 'CLOSED'];
    const funnel: any[] = [];

    stages.forEach((stage, index) => {
      const reachedStage = allBalances.filter(b => 
        b.states.some(s => s.stage === stage)
      ).length;

      const previousStage = index > 0 ? funnel[index - 1].count : allBalances.length;
      const dropOff = previousStage - reachedStage;
      const dropOffRate = previousStage > 0 ? (dropOff / previousStage) * 100 : 0;

      funnel.push({
        stage,
        count: reachedStage,
        dropOff,
        dropOffRate: Number(dropOffRate.toFixed(2))
      });
    });

    res.json({ funnel });
  } catch (error) {
    console.error('Stage funnel error:', error);
    res.status(500).json({ error: 'Failed to fetch stage funnel' });
  }
});

// Analytics: Top Priority Balances
app.get('/api/analytics/priority-balances', async (req, res) => {
  try {
    const practiceId = req.query.practiceId as string;
    
    const balances = await prisma.balance.findMany({
      where: { 
        practiceId,
        status: 'OPEN'
      },
      include: {
        patient: true,
        states: {
          orderBy: { stageAt: 'desc' },
          take: 1
        }
      }
    });

    const now = new Date();
    const prioritized = balances.map(b => {
      const daysOutstanding = Math.floor((now.getTime() - b.createdAt.getTime()) / (1000 * 60 * 60 * 24));
      const currentStage = b.states[0]?.stage || 'CREATED';
      
      // Priority score: (days * 10) + (amount / 100)
      const priorityScore = (daysOutstanding * 10) + (b.amountCents / 100);

      return {
        ...b,
        daysOutstanding,
        currentStage,
        priorityScore,
        amount: b.amountCents / 100
      };
    });

    // Sort by priority score and take top 10
    const top10 = prioritized
      .sort((a, b) => b.priorityScore - a.priorityScore)
      .slice(0, 10);

    res.json({ priorityBalances: top10 });
  } catch (error) {
    console.error('Priority balances error:', error);
    res.status(500).json({ error: 'Failed to fetch priority balances' });
  }
});

// Analytics: Message Effectiveness
app.get('/api/analytics/message-effectiveness', async (req, res) => {
  try {
    const practiceId = req.query.practiceId as string;
    
    const outreachEvents = await prisma.outreachEvent.findMany({
      where: {
        balance: { practiceId }
      },
      include: {
        balance: {
          include: {
            paymentEvents: true
          }
        }
      }
    });

    const messageTypes = ['NOTIFIED', 'REMINDER_1', 'REMINDER_2', 'ESCALATED'];
    const effectiveness: any[] = [];

    messageTypes.forEach(type => {
      const messages = outreachEvents.filter(e => e.templateKey === type);
      const totalSent = messages.length;
      
      const responded = messages.filter(e => e.responseStatus !== 'NONE').length;
      const paid = messages.filter(e => e.responseStatus === 'PAY').length;
      
      const responseRate = totalSent > 0 ? (responded / totalSent) * 100 : 0;
      const paymentRate = totalSent > 0 ? (paid / totalSent) * 100 : 0;

      effectiveness.push({
        messageType: type,
        totalSent,
        responded,
        paid,
        responseRate: Number(responseRate.toFixed(2)),
        paymentRate: Number(paymentRate.toFixed(2))
      });
    });

    res.json({ effectiveness });
  } catch (error) {
    console.error('Message effectiveness error:', error);
    res.status(500).json({ error: 'Failed to fetch message effectiveness' });
  }
});

// Analytics: Time to Payment Trends
app.get('/api/analytics/payment-trends', async (req, res) => {
  try {
    const practiceId = req.query.practiceId as string;
    
    const paidBalances = await prisma.balance.findMany({
      where: { 
        practiceId,
        status: 'PAID'
      },
      include: {
        paymentEvents: {
          orderBy: { paidAt: 'desc' },
          take: 1
        },
        states: {
          orderBy: { stageAt: 'asc' },
          take: 1
        }
      }
    });

    // Group by week
    const weeklyData: Record<string, { count: number; totalDays: number; totalAmount: number }> = {};

    paidBalances.forEach(b => {
      const payment = b.paymentEvents[0];
      const firstState = b.states[0];
      if (!payment || !firstState) return;

      const paidDate = new Date(payment.paidAt);
      const weekStart = new Date(paidDate);
      weekStart.setDate(paidDate.getDate() - paidDate.getDay());
      const weekKey = weekStart.toISOString().split('T')[0];

      const daysToPayment = Math.floor((payment.paidAt.getTime() - firstState.stageAt.getTime()) / (1000 * 60 * 60 * 24));

      if (!weeklyData[weekKey]) {
        weeklyData[weekKey] = { count: 0, totalDays: 0, totalAmount: 0 };
      }

      weeklyData[weekKey].count++;
      weeklyData[weekKey].totalDays += daysToPayment;
      weeklyData[weekKey].totalAmount += b.amountCents;
    });

    const trends = Object.entries(weeklyData)
      .map(([week, data]) => ({
        week,
        paymentsCount: data.count,
        avgDaysToPayment: Number((data.totalDays / data.count).toFixed(1)),
        totalAmount: data.totalAmount / 100
      }))
      .sort((a, b) => a.week.localeCompare(b.week))
      .slice(-12); // Last 12 weeks

    res.json({ trends });
  } catch (error) {
    console.error('Payment trends error:', error);
    res.status(500).json({ error: 'Failed to fetch payment trends' });
  }
});


// Get all balances with filters
app.get('/api/balances', async (req, res) => {
  try {
    const { practiceId, stage, minAmount, maxAmount } = req.query;

    const balances = await prisma.balance.findMany({
      where: {
        practiceId: practiceId as string,
        status: 'OPEN'
      },
      include: {
        patient: true,
        states: {
          orderBy: { stageAt: 'desc' },
          take: 1
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    let filtered = balances;

    if (stage) {
      filtered = filtered.filter(b => b.states[0]?.stage === stage);
    }

    if (minAmount) {
      filtered = filtered.filter(b => b.amountCents >= Number(minAmount) * 100);
    }

    if (maxAmount) {
      filtered = filtered.filter(b => b.amountCents <= Number(maxAmount) * 100);
    }

    const result = filtered.map(b => ({
      ...b,
      amountCents: b.amountCents,
      amount: b.amountCents / 100,
      currentStage: b.states[0]?.stage || 'CREATED',
      daysOutstanding: Math.floor((Date.now() - b.createdAt.getTime()) / (1000 * 60 * 60 * 24))
    }));

    res.json(result);
  } catch (error) {
    console.error('Get balances error:', error);
    res.status(500).json({ error: 'Failed to fetch balances' });
  }
});

// Get balance detail
app.get('/api/balances/:id', async (req, res) => {
  try {
    const balance = await prisma.balance.findUnique({
      where: { id: req.params.id },
      include: {
        patient: true,
        states: {
          orderBy: { stageAt: 'asc' }
        },
        outreachEvents: {
          orderBy: { sentAt: 'asc' }
        },
        paymentEvents: {
          orderBy: { paidAt: 'asc' }
        }
      }
    });

    if (!balance) {
      return res.status(404).json({ error: 'Balance not found' });
    }

    res.json({
      ...balance,
      amount: balance.amountCents / 100,
      daysOutstanding: Math.floor((Date.now() - balance.createdAt.getTime()) / (1000 * 60 * 60 * 24))
    });
  } catch (error) {
    console.error('Get balance detail error:', error);
    res.status(500).json({ error: 'Failed to fetch balance details' });
  }
});

// Get outreach events (outbox)
app.get('/api/outreach', async (req, res) => {
  try {
    const { practiceId } = req.query;
    
    const events = await prisma.outreachEvent.findMany({
      where: {
        balance: {
          practiceId: practiceId as string
        }
      },
      include: {
        balance: {
          include: {
            patient: true
          }
        }
      },
      orderBy: { sentAt: 'desc' },
      take: 100
    });

    res.json(events);
  } catch (error) {
    console.error('Get outreach events error:', error);
    res.status(500).json({ error: 'Failed to fetch outreach events' });
  }
});

// Simulate patient response
app.post('/api/outreach/:id/respond', async (req, res) => {
  try {
    const { responseType } = req.body; // 'PAY', 'QUESTION', 'DISPUTE'
    const event = await prisma.outreachEvent.findUnique({
      where: { id: req.params.id },
      include: { balance: true }
    });

    if (!event) {
      return res.status(404).json({ error: 'Outreach event not found' });
    }

    await prisma.outreachEvent.update({
      where: { id: event.id },
      data: { responseStatus: responseType }
    });

    if (responseType === 'PAY') {
      await prisma.paymentEvent.create({
        data: {
          balanceId: event.balanceId,
          amountCents: event.balance.amountCents,
          method: 'LINK',
          result: 'SUCCESS'
        }
      });

      await prisma.balance.update({
        where: { id: event.balanceId },
        data: { status: 'PAID' }
      });

      await prisma.balanceState.create({
        data: {
          balanceId: event.balanceId,
          stage: 'CLOSED'
        }
      });
    } else if (responseType === 'DISPUTE') {
      await prisma.balance.update({
        where: { id: event.balanceId },
        data: { status: 'IN_DISPUTE' }
      });

      await prisma.balanceState.create({
        data: {
          balanceId: event.balanceId,
          stage: 'STAFF_REVIEW'
        }
      });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Respond to outreach error:', error);
    res.status(500).json({ error: 'Failed to process response' });
  }
});

// Payment page
app.post('/api/pay/:balanceId', async (req, res) => {
  try {
    const balance = await prisma.balance.findUnique({
      where: { id: req.params.balanceId }
    });

    if (!balance) {
      return res.status(404).json({ error: 'Balance not found' });
    }

    await prisma.paymentEvent.create({
      data: {
        balanceId: balance.id,
        amountCents: balance.amountCents,
        method: 'LINK',
        result: 'SUCCESS'
      }
    });

    await prisma.balance.update({
      where: { id: balance.id },
      data: { status: 'PAID' }
    });

    await prisma.balanceState.create({
      data: {
        balanceId: balance.id,
        stage: 'CLOSED'
      }
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Payment error:', error);
    res.status(500).json({ error: 'Payment failed' });
  }
});

// Generate synthetic balances
app.post('/api/admin/generate-balances', async (req, res) => {
  try {
    const { practiceId, count = 50 } = req.body;

    const patients = await prisma.patient.findMany({
      where: { practiceId }
    });

    if (patients.length === 0) {
      return res.status(400).json({ error: 'No patients found. Run seed first.' });
    }

    const balances = [];
    const now = new Date();

    for (let i = 0; i < count; i++) {
      const patient = patients[Math.floor(Math.random() * patients.length)];
      const daysAgo = Math.floor(Math.random() * 45);
      const createdAt = new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000);
      const dueDate = new Date(createdAt.getTime() + 30 * 24 * 60 * 60 * 1000);
      
      const amountCents = Math.floor(Math.random() * 100000) + 5000; // $50 to $1000

      const balance = await prisma.balance.create({
        data: {
          practiceId,
          patientId: patient.id,
          amountCents,
          createdAt,
          dueDate,
          status: 'OPEN',
          source: 'DENTRIX_SYNC',
          lastDentrixSyncAt: createdAt
        }
      });

      await prisma.balanceState.create({
        data: {
          balanceId: balance.id,
          stage: 'CREATED',
          stageAt: createdAt
        }
      });

      balances.push(balance);
    }

    res.json({ 
      success: true, 
      count: balances.length,
      message: `Generated ${balances.length} synthetic balances` 
    });
  } catch (error) {
    console.error('Generate balances error:', error);
    res.status(500).json({ error: 'Failed to generate balances' });
  }
});

// Get practices
app.get('/api/practices', async (_req, res) => {
  try {
    const practices = await prisma.practice.findMany();
    res.json(practices);
  } catch (error) {
    console.error('Get practices error:', error);
    res.status(500).json({ error: 'Failed to fetch practices' });
  }
});

// Get rules
app.get('/api/rules', async (req, res) => {
  try {
    const { practiceId } = req.query;
    
    const ruleSets = await prisma.ruleSet.findMany({
      where: {
        practiceId: practiceId as string,
        isActive: true
      },
      include: {
        rules: true
      }
    });

    res.json(ruleSets);
  } catch (error) {
    console.error('Get rules error:', error);
    res.status(500).json({ error: 'Failed to fetch rules' });
  }
});

// Update rule
app.put('/api/rules/:id', async (req, res) => {
  try {
    const { conditions, actionParams } = req.body;
    
    const rule = await prisma.rule.update({
      where: { id: req.params.id },
      data: {
        conditions: JSON.stringify(conditions),
        actionParams: JSON.stringify(actionParams)
      }
    });

    res.json(rule);
  } catch (error) {
    console.error('Update rule error:', error);
    res.status(500).json({ error: 'Failed to update rule' });
  }
});

// ── Queue priority (carrier call order set from the desktop app) ─────────────

const VALID_CARRIERS = [
  'sun_life', 'canada_life', 'manulife',
  'green_shield', 'rbc_insurance', 'telus_adjudicare',
];

// POST /api/queue/priority  — body: { practiceId, carrier, date }
app.post('/api/queue/priority', async (req, res) => {
  const { practiceId, carrier, date } = req.body as {
    practiceId: string;
    carrier: string | null;
    date: string;
  };

  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date))
    return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
  if (!practiceId)
    return res.status(400).json({ error: 'practiceId is required' });
  if (carrier && !VALID_CARRIERS.includes(carrier))
    return res.status(400).json({ error: `carrier must be one of: ${VALID_CARRIERS.join(', ')} or null` });

  try {
    const priorityDate = new Date(date + 'T00:00:00.000Z');
    const record = await prisma.queuePriority.upsert({
      where  : { practiceId_priorityDate: { practiceId, priorityDate } },
      update : { carrier: carrier ?? null },
      create : { practiceId, carrier: carrier ?? null, priorityDate },
    });
    res.json({ ok: true, carrier: record.carrier, date });
  } catch (error) {
    console.error('Queue priority POST error:', error);
    res.status(500).json({ error: 'Failed to set queue priority' });
  }
});

// GET /api/queue/priority?practiceId=xxx&date=YYYY-MM-DD
app.get('/api/queue/priority', async (req, res) => {
  const practiceId = req.query.practiceId as string;
  const date = (req.query.date as string) ?? new Date().toISOString().split('T')[0];

  if (!practiceId) return res.status(400).json({ error: 'practiceId is required' });

  try {
    const priorityDate = new Date(date + 'T00:00:00.000Z');
    const record = await prisma.queuePriority.findUnique({
      where: { practiceId_priorityDate: { practiceId, priorityDate } },
    });
    res.json({ carrier: record?.carrier ?? null, date });
  } catch (error) {
    console.error('Queue priority GET error:', error);
    res.status(500).json({ error: 'Failed to fetch queue priority' });
  }
});

// Serve static frontend (Vite dist). Desktop sets COLLECTRX_DIST_DIR to the path inside the .app.
const distPath = process.env.COLLECTRX_DIST_DIR
  ? path.resolve(process.env.COLLECTRX_DIST_DIR)
  : path.join(process.cwd(), 'dist');
console.log('📁 Static files path:', distPath);

app.use(express.static(distPath));

// SPA catch-all - only for non-API routes
app.get('*', (req, res, next) => {
  // Skip API routes
  if (req.path.startsWith('/api')) {
    return next();
  }
  const indexPath = path.join(distPath, 'index.html');
  res.sendFile(indexPath, (err) => {
    if (err) {
      console.error('Error serving index.html:', err, 'Path:', indexPath);
      res.status(404).send('Frontend not found. API available at /api/health');
    }
  });
});

  app.listen(PORT, () => {
    console.log(`✅ Server running on port ${PORT}`);
    console.log('📁 Serving frontend from:', distPath);
    startRulesEngine(prisma);
  });
}

// Start the app
initializeApp();
