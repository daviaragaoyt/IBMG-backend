-- CreateEnum
CREATE TYPE "PersonType" AS ENUM ('MEMBER', 'VISITOR');

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('STAFF', 'PARTICIPANT');

-- CreateEnum
CREATE TYPE "CheckpointCategory" AS ENUM ('GENERAL', 'KIDS', 'PROPHETIC', 'PRAYER', 'EVANGELISM', 'CONSOLIDATION', 'STORE');

-- CreateTable
CREATE TABLE "people" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "age" INTEGER,
    "gender" TEXT,
    "type" "PersonType" NOT NULL DEFAULT 'VISITOR',
    "role" "Role" NOT NULL DEFAULT 'PARTICIPANT',
    "church" TEXT,
    "marketingSource" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "people_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "checkpoints" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "CheckpointCategory" NOT NULL DEFAULT 'GENERAL',
    "capacity" INTEGER,

    CONSTRAINT "checkpoints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "movements" (
    "id" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "personId" TEXT NOT NULL,
    "department" TEXT,
    "checkpointId" TEXT NOT NULL,

    CONSTRAINT "movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "manual_entries" (
    "id" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "type" "PersonType" NOT NULL,
    "gender" TEXT,
    "ageGroup" TEXT,
    "church" TEXT,
    "marketingSource" TEXT,
    "checkpointId" TEXT NOT NULL,

    CONSTRAINT "manual_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "people_email_key" ON "people"("email");

-- CreateIndex
CREATE UNIQUE INDEX "checkpoints_name_key" ON "checkpoints"("name");

-- AddForeignKey
ALTER TABLE "movements" ADD CONSTRAINT "movements_personId_fkey" FOREIGN KEY ("personId") REFERENCES "people"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movements" ADD CONSTRAINT "movements_checkpointId_fkey" FOREIGN KEY ("checkpointId") REFERENCES "checkpoints"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manual_entries" ADD CONSTRAINT "manual_entries_checkpointId_fkey" FOREIGN KEY ("checkpointId") REFERENCES "checkpoints"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
