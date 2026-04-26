-- CreateTable
CREATE TABLE "Practice" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'America/New_York',
    "passwordHash" TEXT NOT NULL,

    CONSTRAINT "Practice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Patient" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "preferredChannel" TEXT NOT NULL DEFAULT 'email',
    "phoneFake" TEXT NOT NULL,
    "emailFake" TEXT NOT NULL,

    CONSTRAINT "Patient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Balance" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "source" TEXT NOT NULL DEFAULT 'DENTRIX_SYNC',
    "lastDentrixSyncAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Balance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BalanceState" (
    "id" TEXT NOT NULL,
    "balanceId" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "stageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BalanceState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutreachEvent" (
    "id" TEXT NOT NULL,
    "balanceId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "templateKey" TEXT NOT NULL,
    "messageBody" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveryStatus" TEXT NOT NULL DEFAULT 'SENT',
    "responseStatus" TEXT NOT NULL DEFAULT 'NONE',

    CONSTRAINT "OutreachEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentEvent" (
    "id" TEXT NOT NULL,
    "balanceId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "method" TEXT NOT NULL DEFAULT 'LINK',
    "result" TEXT NOT NULL DEFAULT 'SUCCESS',

    CONSTRAINT "PaymentEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RuleSet" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "RuleSet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Rule" (
    "id" TEXT NOT NULL,
    "ruleSetId" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "conditions" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "actionParams" TEXT NOT NULL,

    CONSTRAINT "Rule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QueuePriority" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "carrier" TEXT,
    "priorityDate" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QueuePriority_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CarrierOrder" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "order" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CarrierOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PatientBalance" (
    "id" TEXT NOT NULL,
    "patientToken" TEXT NOT NULL,
    "abeldentPatientId" TEXT,
    "patientFirstName" TEXT NOT NULL,
    "patientLastName" TEXT NOT NULL,
    "patientEmail" TEXT,
    "patientPhone" TEXT,
    "carrierCode" TEXT,
    "procedureCode" TEXT,
    "procedureDescription" TEXT,
    "treatmentDate" TIMESTAMP(3),
    "adjudicationDate" TIMESTAMP(3),
    "amountBilled" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "insurancePaid" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "patientOwes" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "daysSinceAdjudication" INTEGER NOT NULL DEFAULT 0,
    "practiceId" TEXT,
    "reminderStatus" TEXT NOT NULL DEFAULT 'none',
    "paymentStatus" TEXT NOT NULL DEFAULT 'outstanding',
    "amountPaid" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "stripePaymentLink" TEXT,
    "stripePaymentLinkId" TEXT,
    "stripePaymentIntentId" TEXT,
    "lastReminderEmailAt" TIMESTAMP(3),
    "lastReminderSmsAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PatientBalance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StripeConnectAccount" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "stripeAccountId" TEXT NOT NULL,
    "onboardingComplete" BOOLEAN NOT NULL DEFAULT false,
    "chargesEnabled" BOOLEAN NOT NULL DEFAULT false,
    "payoutsEnabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StripeConnectAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PatientBenefits" (
    "id" TEXT NOT NULL,
    "patientToken" TEXT NOT NULL,
    "carrierCode" TEXT NOT NULL,
    "planYear" TEXT NOT NULL,
    "annualMax" DOUBLE PRECISION,
    "annualMaxUsed" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "deductible" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "deductibleMet" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "staleFlag" BOOLEAN NOT NULL DEFAULT false,
    "lastVerifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PatientBenefits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BenefitCoverage" (
    "id" TEXT NOT NULL,
    "patientToken" TEXT NOT NULL,
    "carrierCode" TEXT NOT NULL,
    "cdtCategory" TEXT NOT NULL,
    "coveragePct" DOUBLE PRECISION NOT NULL,
    "waitingPeriodMonths" INTEGER NOT NULL DEFAULT 0,
    "waitingPeriodStart" TIMESTAMP(3),
    "frequencyLimitMonths" INTEGER,
    "lastServiceDate" TIMESTAMP(3),
    "lastVerifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BenefitCoverage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlanYear" (
    "id" TEXT NOT NULL,
    "patientToken" TEXT NOT NULL,
    "carrierCode" TEXT NOT NULL,
    "planYearStart" TIMESTAMP(3) NOT NULL,
    "planYearEnd" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlanYear_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EligibilityCall" (
    "id" TEXT NOT NULL,
    "patientToken" TEXT NOT NULL,
    "carrierCode" TEXT NOT NULL,
    "vapiCallId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'initiated',
    "outcome" TEXT,
    "transcript" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EligibilityCall_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "QueuePriority_practiceId_priorityDate_key" ON "QueuePriority"("practiceId", "priorityDate");

-- CreateIndex
CREATE UNIQUE INDEX "CarrierOrder_practiceId_key" ON "CarrierOrder"("practiceId");

-- CreateIndex
CREATE INDEX "PatientBalance_patientToken_idx" ON "PatientBalance"("patientToken");

-- CreateIndex
CREATE INDEX "PatientBalance_paymentStatus_idx" ON "PatientBalance"("paymentStatus");

-- CreateIndex
CREATE INDEX "PatientBalance_reminderStatus_idx" ON "PatientBalance"("reminderStatus");

-- CreateIndex
CREATE INDEX "PatientBalance_practiceId_idx" ON "PatientBalance"("practiceId");

-- CreateIndex
CREATE UNIQUE INDEX "StripeConnectAccount_practiceId_key" ON "StripeConnectAccount"("practiceId");

-- CreateIndex
CREATE UNIQUE INDEX "StripeConnectAccount_stripeAccountId_key" ON "StripeConnectAccount"("stripeAccountId");

-- CreateIndex
CREATE INDEX "PatientBenefits_patientToken_idx" ON "PatientBenefits"("patientToken");

-- CreateIndex
CREATE INDEX "PatientBenefits_carrierCode_idx" ON "PatientBenefits"("carrierCode");

-- CreateIndex
CREATE UNIQUE INDEX "PatientBenefits_patientToken_carrierCode_planYear_key" ON "PatientBenefits"("patientToken", "carrierCode", "planYear");

-- CreateIndex
CREATE INDEX "BenefitCoverage_patientToken_idx" ON "BenefitCoverage"("patientToken");

-- CreateIndex
CREATE UNIQUE INDEX "BenefitCoverage_patientToken_carrierCode_cdtCategory_key" ON "BenefitCoverage"("patientToken", "carrierCode", "cdtCategory");

-- CreateIndex
CREATE INDEX "PlanYear_patientToken_idx" ON "PlanYear"("patientToken");

-- CreateIndex
CREATE UNIQUE INDEX "PlanYear_patientToken_carrierCode_planYearStart_key" ON "PlanYear"("patientToken", "carrierCode", "planYearStart");

-- CreateIndex
CREATE INDEX "EligibilityCall_patientToken_idx" ON "EligibilityCall"("patientToken");

-- AddForeignKey
ALTER TABLE "Patient" ADD CONSTRAINT "Patient_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Balance" ADD CONSTRAINT "Balance_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Balance" ADD CONSTRAINT "Balance_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BalanceState" ADD CONSTRAINT "BalanceState_balanceId_fkey" FOREIGN KEY ("balanceId") REFERENCES "Balance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutreachEvent" ADD CONSTRAINT "OutreachEvent_balanceId_fkey" FOREIGN KEY ("balanceId") REFERENCES "Balance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentEvent" ADD CONSTRAINT "PaymentEvent_balanceId_fkey" FOREIGN KEY ("balanceId") REFERENCES "Balance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RuleSet" ADD CONSTRAINT "RuleSet_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rule" ADD CONSTRAINT "Rule_ruleSetId_fkey" FOREIGN KEY ("ruleSetId") REFERENCES "RuleSet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

