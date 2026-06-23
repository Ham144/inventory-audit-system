-- CreateTable
CREATE TABLE "OpnameSession" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "office" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ONGOING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OpnameSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScanLog" (
    "id" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "rak" INTEGER NOT NULL,
    "qty" INTEGER NOT NULL,
    "operator" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "office" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,

    CONSTRAINT "ScanLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScanQtyApproval" (
    "id" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "rak" INTEGER NOT NULL,
    "office" TEXT NOT NULL,
    "scanLogId" TEXT NOT NULL,
    "approvedQty" INTEGER NOT NULL,
    "approvedBy" TEXT NOT NULL,
    "approvedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sessionId" TEXT NOT NULL,

    CONSTRAINT "ScanQtyApproval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompareItem" (
    "id" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "physicalQty" INTEGER NOT NULL DEFAULT 0,
    "systemQty" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'BELUM_COMPARE',
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sessionId" TEXT NOT NULL,

    CONSTRAINT "CompareItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ScanLog_sku_idx" ON "ScanLog"("sku");

-- CreateIndex
CREATE INDEX "ScanLog_sessionId_idx" ON "ScanLog"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "ScanQtyApproval_scanLogId_key" ON "ScanQtyApproval"("scanLogId");

-- CreateIndex
CREATE INDEX "ScanQtyApproval_sessionId_idx" ON "ScanQtyApproval"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "ScanQtyApproval_sessionId_sku_rak_office_key" ON "ScanQtyApproval"("sessionId", "sku", "rak", "office");

-- CreateIndex
CREATE UNIQUE INDEX "CompareItem_sessionId_sku_key" ON "CompareItem"("sessionId", "sku");

-- AddForeignKey
ALTER TABLE "ScanLog" ADD CONSTRAINT "ScanLog_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "OpnameSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScanQtyApproval" ADD CONSTRAINT "ScanQtyApproval_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "OpnameSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScanQtyApproval" ADD CONSTRAINT "ScanQtyApproval_scanLogId_fkey" FOREIGN KEY ("scanLogId") REFERENCES "ScanLog"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompareItem" ADD CONSTRAINT "CompareItem_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "OpnameSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
