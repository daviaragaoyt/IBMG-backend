import express, { Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
// 1. ATUALIZE OS IMPORTS NO TOPO
import {
  PrismaClient,
  PersonType,       // <--- Adicionar
  Role,             // <--- Adicionar
  // <--- Adicionar (se for usar em outro lugar)
} from '@prisma/client';
import { startOfDay, endOfDay } from 'date-fns';
import { z } from 'zod'; // Biblioteca de validação

const app = express();
const prisma = new PrismaClient();
const PORT = process.env.PORT || 3001;

// --- MIDDLEWARES (Segurança e Logs) ---
app.use(cors({ origin: '*' }));
app.use(helmet()); // Proteção de headers HTTP
app.use(express.json());
app.use(morgan('dev')); // Log detalhado no terminal (GET /dashboard 200 15ms)

// --- CONFIGURAÇÕES E CONSTANTES ---
const CHURCHES = [
  "Ibmg Alphaville", "Ibmg Orlando", "Ibmg Sede", "Ibmg Santa Maria", "Ibmg Caldas", "Outra"
];

// Locais que permitem bipar a mesma pessoa várias vezes no dia (Atendimentos)
const SERVICE_CATEGORIES = ['PROPHETIC', 'PRAYER', 'EVANGELISM', 'CONSOLIDATION', 'STORE'];

// --- SCHEMAS DE VALIDAÇÃO (ZOD) ---
const CountSchema = z.object({
  checkpointId: z.string().min(1),
  type: z.enum(['MEMBER', 'VISITOR']),
  church: z.string().optional(),
  quantity: z.number().min(1).default(1),
  ageGroup: z.string().optional(),
  gender: z.string().optional(),
  marketingSource: z.string().nullable().optional()
});

const RegisterSchema = z.object({
  name: z.string().min(3),
  email: z.string().email().optional().or(z.literal('')),
  phone: z.string().optional(),
  type: z.string(),
  church: z.string().optional(),
  gender: z.string().optional(),
  marketingSource: z.string().optional(),
  age: z.union([z.string(), z.number()]).optional(),
  isStaff: z.boolean().optional()
});

// --- ROTAS PÚBLICAS ---
app.get('/', (req, res) => {
  res.json({
    status: 'online',
    message: 'Ekklesia Event API Running 🚀',
    timestamp: new Date()
  });
});

app.get('/config/churches', (req, res) => res.json(CHURCHES));

// --- 1. AUTENTICAÇÃO ---
app.post('/auth/login', async (req: Request, res: Response) => {
  const { email } = req.body;
  try {
    if (!email) return res.status(400).json({ error: "E-mail obrigatório" });

    const user = await prisma.person.findUnique({ where: { email: String(email) } });

    if (!user) return res.status(404).json({ error: "E-mail não encontrado na base." });
    if (user.role !== 'STAFF') return res.status(403).json({ error: "Acesso restrito à equipe." });

    // Log de acesso
    console.log(`[LOGIN] Staff ${user.name} logou às ${new Date().toLocaleTimeString()}`);

    res.json(user);
  } catch (error: any) {
    console.error("Erro Login:", error);
    res.status(500).json({ error: "Erro interno no servidor." });
  }
});

// --- 2. CONTADOR MANUAL (Melhorado) ---
app.post('/count', async (req: Request, res: Response) => {
  try {
    // Validação dos dados recebidos
    const data = CountSchema.parse(req.body);

    // DEBOUNCE: Evita cliques duplos acidentais (se for idêntico e < 2s)
    const lastEntry = await prisma.manualEntry.findFirst({
      where: { checkpointId: data.checkpointId, type: data.type },
      orderBy: { timestamp: 'desc' }
    });

    if (lastEntry) {
      const diff = new Date().getTime() - new Date(lastEntry.timestamp).getTime();
      // Se foi há menos de 2 segundos E os dados são iguais, ignora
      if (diff < 2000 && lastEntry.gender === data.gender && lastEntry.ageGroup === data.ageGroup && lastEntry.church === data.church) {
        return res.json({ success: true, message: "Duplicidade evitada (clique rápido)", ignored: true });
      }
    }

    const entry = await prisma.manualEntry.create({
      data: {
        checkpointId: data.checkpointId,
        type: data.type,
        church: data.church || 'Ibmg Sede',
        ageGroup: data.ageGroup || 'ADULTO',
        gender: data.gender || 'M',
        quantity: data.quantity,
        marketingSource: data.marketingSource || null,
        timestamp: new Date()
      }
    });

    // Retorna o total do dia para aquele checkpoint (Feedback instantâneo)
    const todayStart = startOfDay(new Date());
    const todayEnd = endOfDay(new Date());

    const totalToday = await prisma.manualEntry.aggregate({
      where: {
        checkpointId: data.checkpointId,
        timestamp: { gte: todayStart, lte: todayEnd }
      },
      _sum: { quantity: true }
    });

    res.json({ success: true, totalToday: totalToday._sum.quantity || 0, entry });
  } catch (error) {
    console.error(error);
    res.status(400).json({ error: "Dados inválidos ou erro ao salvar." });
  }
});

// --- 3. TRACKING QR CODE (Lógica Inteligente de Reentrada) ---
app.post('/track', async (req: Request, res: Response) => {
  const { personId, checkpointId } = req.body;
  const todayStart = startOfDay(new Date());
  const todayEnd = endOfDay(new Date());

  if (!personId || !checkpointId) return res.status(400).json({ error: "IDs obrigatórios" });

  try {
    // 1. Busca informações do Local (Checkpoint) para saber se é Serviço ou Entrada
    const checkpoint = await prisma.checkpoint.findUnique({ where: { id: checkpointId } });
    if (!checkpoint) return res.status(404).json({ error: "Local não encontrado" });

    // Se o local for de categoria "SERVIÇO" (Oração, Profético), permite contar várias vezes
    // Se for "GERAL" (Entrada) ou "KIDS", bloqueia repetição
    const allowReentry = SERVICE_CATEGORIES.includes(checkpoint.category || '');

    // 2. Verifica registro existente HOJE
    const existing = await prisma.movement.findFirst({
      where: {
        personId,
        checkpointId,
        timestamp: { gte: todayStart, lte: todayEnd }
      },
      include: { person: true, checkpoint: true }
    });

    // 3. Rate Limit Preventivo: Se a pessoa foi bipada no MESMO local há menos de 1 minuto, ignora
    if (existing) {
      const secondsDiff = (new Date().getTime() - new Date(existing.timestamp).getTime()) / 1000;
      if (secondsDiff < 60) {
        return res.json({ success: true, status: 'IGNORED', person: existing.person, message: `⏳ Aguarde para bipar novamente.` });
      }
    }

    // 4. Lógica de Bloqueio (Se não for serviço e já existir, barra a contagem)
    if (existing && !allowReentry) {
      return res.json({
        success: true,
        status: 'REENTRY',
        person: existing.person,
        message: `⚠️ ${existing.person.name.split(' ')[0]} já entrou hoje.`
      });
    }

    // 5. Cria o movimento (Conta +1)
    const newMove = await prisma.movement.create({
      data: { personId, checkpointId },
      include: { person: true, checkpoint: true }
    });

    return res.json({
      success: true,
      status: 'SUCCESS',
      person: newMove.person,
      message: allowReentry ? `✅ Atendimento registrado!` : `✅ Acesso Liberado!`
    });

  } catch (error) {
    console.error("Erro /track:", error);
    res.status(500).json({ success: false, error: "Erro interno" });
  }
});

// --- 4. DASHBOARD (AGREGADOR BLINDADO) ---
app.get('/dashboard', async (req, res) => {
  try {
    // Pega desde o início de 2025 até o fim de 2026 para garantir que pega TUDO
    const eventStart = new Date('2025-01-01T00:00:00');
    const eventEnd = new Date('2026-12-31T23:59:59');

    // 1. Busca dados brutos (Manual + Scanner)
    const [manualEntries, scannerEntries] = await Promise.all([
      prisma.manualEntry.findMany({
        where: { timestamp: { gte: eventStart, lte: eventEnd } },
        include: { checkpoint: { select: { name: true } } }
      }),
      prisma.movement.findMany({
        where: { timestamp: { gte: eventStart, lte: eventEnd } },
        select: {
          timestamp: true,
          checkpoint: { select: { name: true } },
          person: { select: { type: true, gender: true, age: true, church: true, marketingSource: true } }
        }
      })
    ]);

    // 2. Normalização (Padroniza tudo para garantir a soma)
    const allEntries = [
      ...manualEntries.map(e => ({
        timestamp: e.timestamp,
        quantity: e.quantity,
        type: (e.type || 'VISITOR').toUpperCase(),
        gender: (e.gender || 'M').toUpperCase(),
        ageGroup: (e.ageGroup || 'ADULTO').toUpperCase(),
        church: e.church || 'Não Informado',
        marketing: e.marketingSource || 'Outros',
        checkpointName: e.checkpoint?.name || 'Indefinido'
      })),
      ...scannerEntries.map(e => {
        // Calcula faixa etária se vier do scanner
        let derivedGroup = 'ADULTO';
        if (e.person.age !== null) {
          if (e.person.age <= 12) derivedGroup = 'CRIANCA';
          else if (e.person.age <= 18) derivedGroup = 'JOVEM';
        }
        return {
          timestamp: e.timestamp,
          quantity: 1,
          type: (e.person.type || 'VISITOR').toUpperCase(),
          gender: (e.person.gender || 'M').toUpperCase(),
          ageGroup: derivedGroup,
          church: e.person.church || 'Não Informado',
          marketing: e.person.marketingSource || 'Outros',
          checkpointName: e.checkpoint?.name || 'Indefinido'
        };
      })
    ];

    // 3. Processamento
    const timeline: Record<string, Record<string, number>> = {};
    const checkpointsData: Record<string, Record<string, any>> = {};

    allEntries.forEach(e => {
      // Ajuste de Fuso Horário Simples (Pega o dia local do servidor)
      const date = new Date(e.timestamp);
      const day = date.getDate().toString();
      const hour = date.getHours().toString();
      const local = e.checkpointName;

      // Timeline
      if (!timeline[day]) timeline[day] = {};
      if (!timeline[day][hour]) timeline[day][hour] = 0;
      timeline[day][hour] += e.quantity;

      // Checkpoints
      if (!checkpointsData[day]) checkpointsData[day] = {};
      if (!checkpointsData[day][local]) {
        checkpointsData[day][local] = {
          total: 0, gender: { M: 0, F: 0 }, age: { CRIANCA: 0, JOVEM: 0, ADULTO: 0 },
          type: { MEMBER: 0, VISITOR: 0 }, marketing: {}, church: {}
        };
      }

      const stats = checkpointsData[day][local];
      stats.total += e.quantity;

      // Soma Inteligente (Aceita 'M', 'Masculino', 'Male', etc)
      if (e.gender.startsWith('M')) stats.gender.M += e.quantity;
      else stats.gender.F += e.quantity;

      if (e.ageGroup.includes('CRIANCA') || e.ageGroup.includes('KIDS')) stats.age.CRIANCA += e.quantity;
      else if (e.ageGroup.includes('JOVEM') || e.ageGroup.includes('TEEN')) stats.age.JOVEM += e.quantity;
      else stats.age.ADULTO += e.quantity;

      if (e.type.includes('MEMBER') || e.type.includes('MEMBRO')) stats.type.MEMBER += e.quantity;
      else stats.type.VISITOR += e.quantity;

      if (e.marketing) stats.marketing[e.marketing] = (stats.marketing[e.marketing] || 0) + e.quantity;
      if (e.church) stats.church[e.church] = (stats.church[e.church] || 0) + e.quantity;
    });

    res.json({ timeline, checkpointsData });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Erro no dashboard" });
  }
});



// Lista locais
app.get('/checkpoints', async (req, res) => {
  const spots = await prisma.checkpoint.findMany({ orderBy: { name: 'asc' } });
  res.json(spots);
});

// Busca pessoas para o Scanner (Inclui flag se já entrou hoje)
app.get('/people', async (req, res) => {
  const { search } = req.query;
  if (!search || String(search).length < 3) return res.json([]);

  const todayStart = startOfDay(new Date());
  const todayEnd = endOfDay(new Date());

  const people = await prisma.person.findMany({
    where: { name: { contains: String(search), mode: 'insensitive' } },
    take: 15, // Aumentei para 15
    include: {
      movements: {
        where: { timestamp: { gte: todayStart, lte: todayEnd } },
        select: { id: true, checkpoint: { select: { name: true } } }
      }
    }
  });

  const result = people.map(p => ({
    ...p,
    hasEntered: p.movements.length > 0, // Flag visual
    lastLocation: p.movements.length > 0 ? p.movements[0].checkpoint.name : null
  }));

  res.json(result);
});

// Busca pendências de cadastro (Saneamento)
app.get('/people/incomplete', async (req, res) => {
  try {
    const people = await prisma.person.findMany({
      where: {
        OR: [
          { gender: null },
          { phone: null },
          { marketingSource: null },
          { age: null }
        ]
      },
      orderBy: { name: 'asc' },
      take: 50
    });
    res.json(people);
  } catch (error) { res.status(500).json({ error: "Erro ao buscar pendências" }); }
});

// Atualiza pessoa (Smart Check-in)
app.put('/person/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const updated = await prisma.person.update({
      where: { id },
      data: req.body
    });
    res.json(updated);
  }
  catch (e) { res.status(500).json({ error: "Erro update" }); }
});

app.post('/register', async (req, res) => {
  try {
    const data = RegisterSchema.parse(req.body);

    const user = await prisma.person.create({
      data: {
        ...data,
        age: data.age ? Number(data.age) : null,
        // CORREÇÃO AQUI: Forçar o tipo para o Enum do Prisma
        type: data.type as PersonType,
        role: data.isStaff ? Role.STAFF : Role.PARTICIPANT
      }
    });
    res.json(user);
  }
  catch (e) { res.status(400).json({ error: "Erro cadastro", details: e }); }
});

// Exportação CSV Completa
app.get('/export', async (req, res) => {
  try {
    const people = await prisma.person.findMany({ orderBy: { createdAt: 'desc' } });
    let csv = "Nome,Idade,Tipo,Genero,Igreja,WhatsApp,Origem,Data Cadastro\n";
    people.forEach(p => {
      const cleanName = p.name ? p.name.replace(/,/g, '') : 'Sem Nome';
      const data = new Date(p.createdAt).toLocaleDateString('pt-BR');
      csv += `${cleanName},${p.age || ''},${p.type},${p.gender || ''},${p.church || ''},${p.phone || ''},${p.marketingSource || ''},${data}\n`;
    });
    res.header('Content-Type', 'text/csv');
    res.attachment('relatorio_geral.csv');
    res.send(csv);
  } catch (error) { res.status(500).send("Erro ao gerar relatório"); }
});

// Rota de Setup (Criação de Tabelas/Locais)
app.get('/setup', async (req, res) => {
  try {
    await prisma.checkpoint.createMany({
      data: [
        { name: "Recepção / Entrada", category: "GENERAL" },
        { name: "Salinha Kids", category: "KIDS" },
        { name: "Tenda de Oração", category: "PRAYER" },
        { name: "Sala Profética", category: "PROPHETIC" },
        { name: "Livraria", category: "STORE" }
      ],
      skipDuplicates: true
    });
    res.send("Setup OK: Locais criados.");
  } catch (e) { res.status(500).send("Erro setup: " + e); }
});

// Inicialização
if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, () => {
    console.log(`🔥 Servidor local rodando na porta ${PORT}`);
  });
}

export default app;