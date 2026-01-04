// prisma/seed.ts
import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

async function main() {
    console.log('🌱 Iniciando seed do banco de dados...')

    // 1. Locais (Checkpoints)
    const locations = [
        { name: "Recepção / Entrada", category: "GENERAL" },
        { name: "Sala Profética", category: "PROPHETIC" },
        { name: "Consolidação", category: "CONSOLIDATION" },
        { name: "Kombi Evangelista", category: "EVANGELISM" },
        { name: "Tenda de Oração", category: "PRAYER" },
    ]

    for (const loc of locations) {
        const exists = await prisma.checkpoint.findFirst({ where: { name: loc.name } })
        if (!exists) {
            await prisma.checkpoint.create({ data: loc })
            console.log(`✅ Local criado: ${loc.name}`)
        }
    }

    // 2. Criar um Admin padrão (Opcional, para facilitar testes)
    const adminEmail = "admin@ibmg.com"
    const adminExists = await prisma.person.findUnique({ where: { email: adminEmail } })
    if (!adminExists) {
        await prisma.person.create({
            data: {
                name: "Admin IBMG",
                email: adminEmail,
                type: "MEMBER",
                role: "STAFF",
                church: "Ibmg Sede",
                age: 30
            }
        })
        console.log(`👤 Admin criado: ${adminEmail} (Role: STAFF)`)
    }

    console.log('🏁 Seed finalizado!')
}

main()
    .then(async () => { await prisma.$disconnect() })
    .catch(async (e) => {
        console.error(e)
        await prisma.$disconnect()
        process.exit(1)
    })