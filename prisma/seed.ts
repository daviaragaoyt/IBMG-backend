// prisma/seed.ts
import {
    PrismaClient,
    CheckpointCategory, // <--- Importados agora que o 'npx prisma generate' rodou
    PersonType,
    Role
} from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
    console.log('🌱 Iniciando seed do banco de dados...')

    // 1. Locais (Checkpoints) - USANDO ENUMS, NÃO STRINGS
    const locations = [
        { name: "Recepção / Entrada", category: CheckpointCategory.GENERAL },
        { name: "Psalms", category: CheckpointCategory.STORE },
        { name: "Salinha Kids", category: CheckpointCategory.KIDS },
        { name: "Tenda de Oração", category: CheckpointCategory.PRAYER },
        { name: "Cantina", category: CheckpointCategory.PRAYER },
        { name: "Casa dos Mártires", category: CheckpointCategory.PRAYER },
        { name: "Sala Profética", category: CheckpointCategory.PROPHETIC },
        { name: "Livraria", category: CheckpointCategory.STORE }
    ]

    for (const loc of locations) {
        // Upsert é melhor que findFirst + create para evitar erros de rodar 2x
        await prisma.checkpoint.upsert({
            where: { name: loc.name },
            update: {},
            create: {
                name: loc.name,
                category: loc.category
            }
        })
        console.log(`✅ Local garantido: ${loc.name}`)
    }

    // 2. Criar um Admin padrão
    const adminEmail = "admin@ibmg.com"

    await prisma.person.upsert({
        where: { email: adminEmail },
        update: {
            role: Role.STAFF // Garante que é STAFF se já existir
        },
        create: {
            name: "Admin IBMG",
            email: adminEmail,
            type: PersonType.MEMBER, // Enum correto
            role: Role.STAFF,        // Enum correto
            church: "Ibmg Sede",
            age: 30
        }
    })
    console.log(`👤 Admin garantido: ${adminEmail}`)

    console.log('🏁 Seed finalizado!')
}

main()
    .then(async () => { await prisma.$disconnect() })
    .catch(async (e) => {
        console.error(e)
        await prisma.$disconnect()
        process.exit(1)
    })