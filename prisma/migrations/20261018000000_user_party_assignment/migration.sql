-- CreateTable
CREATE TABLE "UserCustomer" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserCustomer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserSupplier" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserSupplier_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UserCustomer_businessId_userId_idx" ON "UserCustomer"("businessId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "UserCustomer_userId_customerId_key" ON "UserCustomer"("userId", "customerId");

-- CreateIndex
CREATE INDEX "UserSupplier_businessId_userId_idx" ON "UserSupplier"("businessId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "UserSupplier_userId_supplierId_key" ON "UserSupplier"("userId", "supplierId");

-- AddForeignKey
ALTER TABLE "UserCustomer" ADD CONSTRAINT "UserCustomer_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserCustomer" ADD CONSTRAINT "UserCustomer_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserCustomer" ADD CONSTRAINT "UserCustomer_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserSupplier" ADD CONSTRAINT "UserSupplier_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserSupplier" ADD CONSTRAINT "UserSupplier_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserSupplier" ADD CONSTRAINT "UserSupplier_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

