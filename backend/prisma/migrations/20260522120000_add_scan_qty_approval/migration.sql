-- CreateTable
CREATE TABLE "ScanQtyApproval" (
    "id" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "rak" INTEGER NOT NULL,
    "locationCode" TEXT NOT NULL,
    "scanLogId" TEXT NOT NULL,
    "approvedQty" INTEGER NOT NULL,
    "approvedBy" TEXT NOT NULL,
    "approvedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sessionId" TEXT NOT NULL,

    CONSTRAINT "ScanQtyApproval_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ScanQtyApproval_scanLogId_key" ON "ScanQtyApproval"("scanLogId");

-- CreateIndex
CREATE INDEX "ScanQtyApproval_sessionId_idx" ON "ScanQtyApproval"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "ScanQtyApproval_sessionId_sku_rak_locationCode_key" ON "ScanQtyApproval"("sessionId", "sku", "rak", "locationCode");

-- AddForeignKey
ALTER TABLE "ScanQtyApproval" ADD CONSTRAINT "ScanQtyApproval_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "OpnameSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScanQtyApproval" ADD CONSTRAINT "ScanQtyApproval_scanLogId_fkey" FOREIGN KEY ("scanLogId") REFERENCES "ScanLog"("id") ON DELETE CASCADE ON UPDATE CASCADE;
