import express, { Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import {
  PrismaClient,
  PersonType,
  Role,
  CheckpointCategory
} from '@prisma/client';
import { startOfDay, endOfDay } from 'date-fns';
import { z } from 'zod';

const app = express();
const prisma = new PrismaClient();
const PORT = process.env.PORT || 3001;

// --- MIDDLEWARES ---
app.use(cors({ origin: '*' }));
app.use(helmet());
app.use(express.json());
app.use(morgan('dev'));

// --- CONSTANTES ---
const CHURCHES = [
  "Ibmg Alphaville", "Ibmg Orlando", "Ibmg Sede", "Ibmg Santa Maria", "Ibmg Caldas", "Outra"
];

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
  phone: z.string().optional().nullable(),
  type: z.enum(['MEMBER', 'VISITOR', 'LEADER', 'PASTOR']).default('VISITOR'),
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

// --- 1. AUTENTICAÇÃO / TICKET (CORRIGIDO E BLINDADO) ---
app.post('/auth/login', async (req: Request, res: Response) => {
  const { email } = req.body;

  try {
    if (!email) return res.status(400).json({ error: "E-mail obrigatório" });

    // 1. Limpeza do email recebido (Remove espaços e força minúsculas)
    const emailLimpo = String(email).trim();

    // 2. Busca Insensitive (Ignora Maiúsculas/Minúsculas)
    const user = await prisma.person.findFirst({
      where: {
        email: {
          equals: emailLimpo,
          mode: 'insensitive' // <--- O PULO DO GATO: Acha 'Davi@...' mesmo se buscar 'davi@...'
        }
      }
    });

    if (!user) {
      // Log para debug: ajuda a ver o que chegou vs o que tem no banco
      console.log(`[FALHA LOGIN] Tentativa: "${emailLimpo}" - Não encontrado.`);
      return res.status(404).json({ error: "E-mail não encontrado na lista de convidados." });
    }

    console.log(`[LOGIN/TICKET] ${user.name} (${user.role}) acessou.`);
    res.json(user);

  } catch (error) {
    console.error("Erro Login:", error);
    res.status(500).json({ error: "Erro interno no servidor." });
  }
});
// --- ROTA QUE ESTAVA FALTANDO: BUSCA POR E-MAIL ---
app.get('/person/by-email', async (req: Request, res: Response) => {
  const { email } = req.query;

  if (!email) {
    return res.status(400).json({ error: "E-mail obrigatório na busca." });
  }

  try {
    const person = await prisma.person.findFirst({
      where: {
        email: {
          equals: String(email).trim(),
          mode: 'insensitive' // Garante que acha davi@... mesmo se buscar Davi@...
        }
      }
    });

    if (!person) {
      return res.status(404).json({ error: "E-mail não encontrado." });
    }

    res.json(person);
  } catch (error) {
    console.error("Erro ao buscar por e-mail:", error);
    res.status(500).json({ error: "Erro interno do servidor." });
  }
});
// --- 2. CONTADOR MANUAL ---
app.post('/count', async (req: Request, res: Response) => {
  try {
    const data = CountSchema.parse(req.body);

    // DEBOUNCE
    const lastEntry = await prisma.manualEntry.findFirst({
      where: { checkpointId: data.checkpointId, type: data.type as PersonType },
      orderBy: { timestamp: 'desc' }
    });

    if (lastEntry) {
      const diff = new Date().getTime() - new Date(lastEntry.timestamp).getTime();
      if (diff < 2000 && lastEntry.gender === data.gender && lastEntry.ageGroup === data.ageGroup) {
        return res.json({ success: true, message: "Duplicidade evitada", ignored: true });
      }
    }

    const entry = await prisma.manualEntry.create({
      data: {
        checkpointId: data.checkpointId,
        type: data.type as PersonType,
        church: data.church || 'Ibmg Sede',
        ageGroup: data.ageGroup || 'ADULTO',
        gender: data.gender || 'M',
        quantity: data.quantity,
        marketingSource: data.marketingSource || null,
        timestamp: new Date()
      }
    });

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
    res.status(400).json({ error: "Erro ao registrar contagem." });
  }
});

// --- 3. TRACKING QR CODE ---
app.post('/track', async (req: Request, res: Response) => {
  const { personId, checkpointId } = req.body;
  const todayStart = startOfDay(new Date());
  const todayEnd = endOfDay(new Date());

  if (!personId || !checkpointId) return res.status(400).json({ error: "IDs obrigatórios" });

  try {
    const checkpoint = await prisma.checkpoint.findUnique({ where: { id: checkpointId } });
    if (!checkpoint) return res.status(404).json({ error: "Local não encontrado" });

    const category = String(checkpoint.category);
    const allowReentry = SERVICE_CATEGORIES.includes(category);

    const existing = await prisma.movement.findFirst({
      where: {
        personId,
        checkpointId,
        timestamp: { gte: todayStart, lte: todayEnd }
      },
      include: { person: true }
    });

    if (existing) {
      const secondsDiff = (new Date().getTime() - new Date(existing.timestamp).getTime()) / 1000;
      if (secondsDiff < 60) {
        return res.json({ success: true, status: 'IGNORED', person: existing.person, message: `⏳ Aguarde...` });
      }
    }

    if (existing && !allowReentry) {
      return res.json({
        success: true,
        status: 'REENTRY',
        person: existing.person,
        message: `⚠️ ${existing.person.name.split(' ')[0]} já entrou hoje.`
      });
    }

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

// --- 4. DASHBOARD (AGREGADOR) ---
app.get('/dashboard', async (req, res) => {
  try {
    const eventStart = new Date('2025-01-01T00:00:00');
    const eventEnd = new Date('2026-12-31T23:59:59');

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

    const timeline: Record<string, Record<string, number>> = {};
    const checkpointsData: Record<string, Record<string, any>> = {};

    allEntries.forEach(e => {
      const date = new Date(e.timestamp);
      const day = date.getDate().toString();
      const hour = date.getHours().toString();
      const local = e.checkpointName;

      if (!timeline[day]) timeline[day] = {};
      if (!timeline[day][hour]) timeline[day][hour] = 0;
      timeline[day][hour] += e.quantity;

      if (!checkpointsData[day]) checkpointsData[day] = {};
      if (!checkpointsData[day][local]) {
        checkpointsData[day][local] = {
          total: 0, gender: { M: 0, F: 0 }, age: { CRIANCA: 0, JOVEM: 0, ADULTO: 0 },
          type: { MEMBER: 0, VISITOR: 0 }, marketing: {}, church: {}
        };
      }

      const stats = checkpointsData[day][local];
      stats.total += e.quantity;

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
    console.error("Dashboard Error:", error);
    res.status(500).json({ error: "Erro ao gerar dashboard" });
  }
});

// --- LISTAGENS (Restauradas) ---
app.get('/checkpoints', async (req, res) => {
  const spots = await prisma.checkpoint.findMany({ orderBy: { name: 'asc' } });
  res.json(spots);
});

app.get('/people', async (req, res) => {
  const { search } = req.query;
  if (!search || String(search).length < 3) return res.json([]);

  const todayStart = startOfDay(new Date());
  const todayEnd = endOfDay(new Date());

  const people = await prisma.person.findMany({
    where: { name: { contains: String(search), mode: 'insensitive' } },
    take: 20,
    include: {
      movements: {
        where: { timestamp: { gte: todayStart, lte: todayEnd } },
        select: { id: true, checkpoint: { select: { name: true } } }
      }
    }
  });

  const result = people.map(p => ({
    ...p,
    hasEntered: p.movements.length > 0,
    lastLocation: p.movements.length > 0 ? p.movements[0].checkpoint.name : null
  }));

  res.json(result);
});

// --- ROTA DE PENDÊNCIAS (Restaurada) ---
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

// --- ATUALIZAÇÃO DE PESSOA (Restaurada) ---
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

// --- CADASTRO ---
app.post('/register', async (req, res) => {
  try {
    const data = RegisterSchema.parse(req.body);

    const user = await prisma.person.create({
      data: {
        name: data.name,
        email: data.email,
        phone: data.phone,
        type: data.type as PersonType,
        church: data.church,
        gender: data.gender,
        marketingSource: data.marketingSource,
        age: data.age ? Number(data.age) : null,
        role: data.isStaff ? Role.STAFF : Role.PARTICIPANT
      }
    });
    res.json(user);
  } catch (e: any) {
    console.error("Erro Registro:", e);
    if (e.code === 'P2002') {
      return res.status(400).json({ error: "E-mail já cadastrado." });
    }
    res.status(400).json({ error: "Erro ao cadastrar", details: e });
  }
});

// --- EXPORTAÇÃO CSV (Restaurada) ---
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

// --- SETUP ---
app.get('/setup', async (req, res) => {
  try {
    await prisma.checkpoint.createMany({
      data: [
        { name: "Recepção / Entrada", category: CheckpointCategory.GENERAL },
        { name: "Salinha Kids", category: CheckpointCategory.KIDS },
        { name: "Tenda de Oração", category: CheckpointCategory.PRAYER },
        { name: "Sala Profética", category: CheckpointCategory.PROPHETIC },
        { name: "Livraria", category: CheckpointCategory.STORE }
      ],
      skipDuplicates: true
    });
    res.send("Setup OK: Locais criados.");
  } catch (e) { res.status(500).send("Erro setup: " + e); }
});

if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, () => {
    console.log(`🔥 Servidor rodando em http://localhost:${PORT}`);
  });
}

export default app;