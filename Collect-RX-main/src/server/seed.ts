import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...');

  const defaultPassword = process.env.SEED_PRACTICE_PASSWORD || 'changeme';
  const passwordHash = await bcrypt.hash(defaultPassword, 12);
  if (!process.env.SEED_PRACTICE_PASSWORD) {
    console.log('   (Using default practice password "changeme"; set SEED_PRACTICE_PASSWORD to override.)');
  }

  // Create practice
  const practice = await prisma.practice.create({
    data: {
      name: 'Tenth Line Family Dentistry',
      timezone: 'America/New_York',
      passwordHash,
    },
  });
  console.log(`✅ Created practice: ${practice.name}`);

  // Create 80 patients
  const patients = [];
  for (let i = 1; i <= 80; i++) {
    const patientNum = String(i).padStart(2, '0');
    const patient = await prisma.patient.create({
      data: {
        practiceId: practice.id,
        displayName: `Patient A${patientNum}`,
        preferredChannel: i % 3 === 0 ? 'sms' : 'email',
        phoneFake: `555-01${patientNum}`,
        emailFake: `patient.a${patientNum}@fake-email.test`
      }
    });
    patients.push(patient);
  }
  console.log(`✅ Created ${patients.length} patients`);

  // Create 50 balances with varied dates and amounts
  const now = new Date();
  for (let i = 0; i < 50; i++) {
    const patient = patients[Math.floor(Math.random() * patients.length)];
    const daysAgo = Math.floor(Math.random() * 45); // 0-45 days old
    const createdAt = new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000);
    const dueDate = new Date(createdAt.getTime() + 30 * 24 * 60 * 60 * 1000);
    
    const amounts = [
      7500,   // $75
      12000,  // $120
      25000,  // $250
      35000,  // $350
      55000,  // $550
      85000,  // $850
      150000, // $1500
    ];
    const amountCents = amounts[Math.floor(Math.random() * amounts.length)];

    const balance = await prisma.balance.create({
      data: {
        practiceId: practice.id,
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
  }
  console.log(`✅ Created 50 balances with varied amounts and dates`);

  // Create default rule set
  const ruleSet = await prisma.ruleSet.create({
    data: {
      practiceId: practice.id,
      name: 'Default A/R Rules',
      isActive: true
    }
  });

  const rules = [
    {
      trigger: 'BALANCE_CREATED',
      conditions: JSON.stringify({}),
      action: 'SEND_MESSAGE',
      actionParams: JSON.stringify({ templateKey: 'NOTIFIED' })
    },
    {
      trigger: 'DAYS_SINCE_STAGE',
      conditions: JSON.stringify({ stage: 'NOTIFIED', days: 5 }),
      action: 'SEND_MESSAGE',
      actionParams: JSON.stringify({ templateKey: 'REMINDER_1' })
    },
    {
      trigger: 'DAYS_SINCE_STAGE',
      conditions: JSON.stringify({ stage: 'REMINDER_1', days: 10 }),
      action: 'SEND_MESSAGE',
      actionParams: JSON.stringify({ templateKey: 'REMINDER_2' })
    },
    {
      trigger: 'DAYS_SINCE_STAGE',
      conditions: JSON.stringify({ stage: 'REMINDER_2', days: 20 }),
      action: 'ESCALATE_STAGE',
      actionParams: JSON.stringify({ stage: 'ESCALATED' })
    },
    {
      trigger: 'AMOUNT_THRESHOLD',
      conditions: JSON.stringify({ minAmount: 50000 }),
      action: 'ESCALATE_STAGE',
      actionParams: JSON.stringify({ stage: 'ESCALATED' })
    }
  ];

  for (const ruleData of rules) {
    await prisma.rule.create({
      data: {
        ruleSetId: ruleSet.id,
        ...ruleData
      }
    });
  }
  console.log(`✅ Created default rule set with ${rules.length} rules`);

  console.log('\n✨ Seed completed successfully!');
  console.log(`\n📊 Practice ID: ${practice.id}`);
  console.log('💡 Use this Practice ID in the app to view data');
}

main()
  .catch((e) => {
    console.error('❌ Seed error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
