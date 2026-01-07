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
        // 1. Locais (Checkpoints)
        const locations = [
            { name: "Recepção / Entrada", category: "GENERAL" },
            { name: "Sala Profética", category: "PROPHETIC" },
            { name: "Consolidação", category: "CONSOLIDATION" },
            { name: "Kombi Evangelista", category: "EVANGELISM" },
            { name: "Tenda de Oração", category: "PRAYER" },
        ];
        for (const loc of locations) {
            const exists = yield prisma.checkpoint.findFirst({ where: { name: loc.name } });
            if (!exists) {
                yield prisma.checkpoint.create({ data: loc });
                console.log(`✅ Local criado: ${loc.name}`);
            }
        }
        // 2. Criar um Admin padrão (Opcional, para facilitar testes)
        const adminEmail = "admin@ibmg.com";
        const adminExists = yield prisma.person.findUnique({ where: { email: adminEmail } });
        if (!adminExists) {
            yield prisma.person.create({
                data: {
                    name: "Admin IBMG",
                    email: adminEmail,
                    type: "MEMBER",
                    role: "STAFF",
                    church: "Ibmg Sede",
                    age: 30
                }
            });
            console.log(`👤 Admin criado: ${adminEmail} (Role: STAFF)`);
        }
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
