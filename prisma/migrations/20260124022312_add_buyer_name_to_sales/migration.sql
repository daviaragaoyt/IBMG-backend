-- DropForeignKey
ALTER TABLE "sales" DROP CONSTRAINT "sales_checkpointId_fkey";

-- AlterTable
ALTER TABLE "sales" ADD COLUMN     "buyerName" TEXT,
ADD COLUMN     "orderCode" TEXT,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'COMPLETED',
ALTER COLUMN "checkpointId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_checkpointId_fkey" FOREIGN KEY ("checkpointId") REFERENCES "checkpoints"("id") ON DELETE SET NULL ON UPDATE CASCADE;
