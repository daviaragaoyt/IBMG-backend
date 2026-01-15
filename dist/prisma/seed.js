"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
// prisma/seed.ts
const client_1 = require("@prisma/client");
const prisma = new client_1.PrismaClient();
function main() {
    return __awaiter(this, void 0, void 0, function* () {
        console.log('🌱 Iniciando seed do banco de dados...');
        // 1. Locais (Checkpoints) - USANDO ENUMS, NÃO STRINGS
        const locations = [
            { name: "Recepção / Entrada", category: CheckpointCategory.GENERAL },
            { name: "Salinha Kids", category: CheckpointCategory.KIDS },
            { name: "Tenda de Oração", category: CheckpointCategory.PRAYER },
            { name: "Cantina", category: CheckpointCategory.PRAYER },
            { name: "Casa dos Mártires", category: CheckpointCategory.PRAYER },
            { name: "Sala Profética", category: CheckpointCategory.PROPHETIC },
            { name: "Livraria", category: CheckpointCategory.STORE }
        ];
        for (const loc of locations) {
            // Upsert é melhor que findFirst + create para evitar erros de rodar 2x
            yield prisma.checkpoint.upsert({
                where: { name: loc.name },
                update: {},
                create: {
                    name: loc.name,
                    category: loc.category
                }
            });
            console.log(`✅ Local garantido: ${loc.name}`);
        }
        // 2. Criar um Admin padrão
        const adminEmail = "admin@ibmg.com";
        yield prisma.person.upsert({
            where: { email: adminEmail },
            update: {
                role: client_1.Role.STAFF // Garante que é STAFF se já existir
            },
            create: {
                name: "Admin IBMG",
                email: adminEmail,
                type: client_1.PersonType.MEMBER, // Enum correto
                role: client_1.Role.STAFF, // Enum correto
                church: "Ibmg Sede",
                age: 30
            }
        });
        console.log(`👤 Admin garantido: ${adminEmail}`);
        console.log('🏁 Seed finalizado!');
    });
}
main()
    .then(() => __awaiter(void 0, void 0, void 0, function* () { yield prisma.$disconnect(); }))
    .catch((e) => __awaiter(void 0, void 0, void 0, function* () {
        console.error(e);
        yield prisma.$disconnect();
        process.exit(1);
    }));
