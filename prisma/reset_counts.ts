// prisma/reset_counts.ts
import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

async function main() {
    console.log('🗑️  Iniciando limpeza de contagens e vendas...')

    // 1. Apagar itens de contagem manual (Recepção, Kids, etc)
    await prisma.manualEntry.deleteMany({})
    console.log('✅ Contagens de fluxo apagadas.')

    // 2. Apagar itens dos pedidos primeiro (dependência)
    await prisma.saleItem.deleteMany({})

    // 3. Apagar os pedidos/vendas
    await prisma.sale.deleteMany({})
    console.log('✅ Vendas e Pedidos apagados.')

    // 4. Apagar visitantes (Pessoas marcadas como VISITOR)
    // Mantemos MEMBERS ou STAFF se houver, e não mexemos nas Reuniões
    await prisma.person.deleteMany({
        where: { type: 'VISITOR' }
    })
    console.log('✅ Visitantes removidos.')

    console.log('🎉 Limpeza concluída! Reuniões e Produtos foram mantidos.')
}

main()
    .catch((e) => { console.error(e); process.exit(1) })
    .finally(async () => { await prisma.$disconnect() })