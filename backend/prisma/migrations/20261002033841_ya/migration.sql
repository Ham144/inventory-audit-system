-- AlterTable
ALTER TABLE "CompareItem" ADD COLUMN     "delegatedAt" TIMESTAMP(3),
ADD COLUMN     "delegatedBy" TEXT,
ADD COLUMN     "delegatedTo" TEXT,
ADD COLUMN     "finalCorrectionAt" TIMESTAMP(3),
ADD COLUMN     "finalCorrectionBy" TEXT,
ADD COLUMN     "finalCorrectionQty" INTEGER,
ADD COLUMN     "finalCorrectionRak" INTEGER;

-- AlterTable
ALTER TABLE "ScanLog" ADD COLUMN     "step" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "mongooseId" TEXT,
ADD COLUMN     "type" TEXT NOT NULL DEFAULT 'external';

-- CreateTable
CREATE TABLE "OfficeMapping" (
    "id" TEXT NOT NULL,
    "officeName" TEXT NOT NULL,
    "locationCode" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OfficeMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TracingInput" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "physicalQty" INTEGER NOT NULL DEFAULT 0,
    "office" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "rak" INTEGER NOT NULL,
    "createdat" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TracingInput_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SkuReminder" (
    "id" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "resolvedOffices" TEXT[],
    "officeDelegations" JSONB NOT NULL DEFAULT '{}',
    "startPeriod" TIMESTAMP(3),
    "endPeriod" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SkuReminder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OfficePeriod" (
    "id" TEXT NOT NULL,
    "office" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'FREE',
    "openedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OfficePeriod_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OfficeMapping_locationCode_key" ON "OfficeMapping"("locationCode");

-- CreateIndex
CREATE UNIQUE INDEX "SkuReminder_sku_key" ON "SkuReminder"("sku");

-- CreateIndex
CREATE UNIQUE INDEX "OfficePeriod_office_key" ON "OfficePeriod"("office");

-- AddForeignKey
ALTER TABLE "TracingInput" ADD CONSTRAINT "TracingInput_username_fkey" FOREIGN KEY ("username") REFERENCES "User"("username") ON DELETE CASCADE ON UPDATE CASCADE;
