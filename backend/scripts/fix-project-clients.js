const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const prisma = require('../src/lib/prisma');

const STOP_WORDS = new Set([
  'проект', 'проекта', 'април', 'май', 'юни', 'юли', 'август', 'септември', 'октомври', 'ноември', 'декември',
  'януари', 'февруари', 'март', 'led', 'ood', 'eood', 'oodd', 'group', 'design', 'interior', 'поръчка', 'голяма',
  'проектна', 'осветление', 'доставка', 'монтаж', 'апартамент', 'офис', 'lighting',
]);

function normalizeText(value) {
  return (value || '')
    .toString()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(value) {
  return normalizeText(value)
    .split(' ')
    .map(token => token.trim())
    .filter(token => token && token.length > 1 && !STOP_WORDS.has(token));
}

function unique(values) {
  return [...new Set(values)];
}

function intersection(left, right) {
  const rightSet = new Set(right);
  return left.filter(token => rightSet.has(token));
}

function buildProjectText(project) {
  return [project.code, project.name, project.notes].filter(Boolean).join(' ');
}

function scoreClientMatch(project, client) {
  const haystack = normalizeText(buildProjectText(project));
  const clientText = normalizeText([client.name, client.notes, client.city, client.email].filter(Boolean).join(' '));
  const projectTokens = unique(tokenize(buildProjectText(project)));
  const clientTokens = unique(tokenize([client.name, client.notes].filter(Boolean).join(' ')));
  const overlap = intersection(projectTokens, clientTokens);
  let score = overlap.length * 18;
  const reasons = [];

  if (clientText && haystack.includes(clientText)) {
    score += 120;
    reasons.push(`project contains client name "${client.name}"`);
  }

  if (overlap.length) {
    score += overlap.reduce((sum, token) => sum + (token.length >= 5 ? 14 : 8), 0);
    reasons.push(`shared tokens: ${overlap.join(', ')}`);
  }

  return { score, reasons };
}

function scoreFromSimilarProjects(project, linkedProjects) {
  const projectTokens = unique(tokenize(buildProjectText(project)));
  const scored = new Map();

  for (const linkedProject of linkedProjects) {
    const linkedTokens = unique(tokenize(buildProjectText(linkedProject)));
    const overlap = intersection(projectTokens, linkedTokens).filter(token => token.length >= 4);

    if (!overlap.length) {
      continue;
    }

    const bonus = linkedProject.year === project.year ? 6 : 0;
    const score = overlap.reduce((sum, token) => sum + (token.length >= 6 ? 16 : 10), 0) + bonus;
    const existing = scored.get(linkedProject.clientId) || { score: 0, reasons: [], matches: [] };
    existing.score += score;
    existing.reasons.push(`similar project ${linkedProject.code} (${linkedProject.client.name}) via ${overlap.join(', ')}`);
    existing.matches.push(linkedProject.client.name);
    scored.set(linkedProject.clientId, existing);
  }

  return scored;
}

function getFallbackClient(clients) {
  const botemaClient = clients.find(client => normalizeText(client.name).includes('botema'));
  if (botemaClient) return { client: botemaClient, reason: 'botema-name' };

  const sorted = [...clients].sort((a, b) => {
    const invoiceDelta = (b._count?.invoices || 0) - (a._count?.invoices || 0);
    if (invoiceDelta !== 0) return invoiceDelta;
    const projectDelta = (b._count?.projects || 0) - (a._count?.projects || 0);
    if (projectDelta !== 0) return projectDelta;
    return a.name.localeCompare(b.name, 'bg');
  });

  if (!sorted.length) {
    throw new Error('No clients available for fallback assignment.');
  }

  return { client: sorted[0], reason: 'top-invoice-client' };
}

async function main() {
  const [projectsWithoutClient, clients, linkedProjects] = await Promise.all([
    prisma.project.findMany({ where: { clientId: null }, orderBy: [{ year: 'desc' }, { code: 'asc' }] }),
    prisma.client.findMany({
      select: {
        id: true,
        name: true,
        notes: true,
        city: true,
        email: true,
        brand: true,
        _count: { select: { invoices: true, projects: true } },
      },
    }),
    prisma.project.findMany({
      where: { clientId: { not: null } },
      select: {
        id: true,
        code: true,
        name: true,
        notes: true,
        year: true,
        clientId: true,
        client: { select: { id: true, name: true, brand: true } },
      },
    }),
  ]);

  if (!projectsWithoutClient.length) {
    console.log('No projects with NULL clientId found.');
    return;
  }

  const fallback = getFallbackClient(clients);
  const report = [];

  for (const project of projectsWithoutClient) {
    const directScores = new Map();

    for (const client of clients) {
      const direct = scoreClientMatch(project, client);
      if (direct.score > 0) {
        directScores.set(client.id, { client, score: direct.score, reasons: [...direct.reasons] });
      }
    }

    const similarScores = scoreFromSimilarProjects(project, linkedProjects);

    for (const [clientId, similar] of similarScores.entries()) {
      const current = directScores.get(clientId);
      if (current) {
        current.score += similar.score;
        current.reasons.push(...similar.reasons);
      } else {
        const client = clients.find(item => item.id === clientId);
        if (client) {
          directScores.set(clientId, { client, score: similar.score, reasons: [...similar.reasons] });
        }
      }
    }

    const ranked = [...directScores.values()].sort((a, b) => b.score - a.score);
    const best = ranked[0];
    const shouldUseMatch = best && best.score >= 26;
    const chosen = shouldUseMatch ? best.client : fallback.client;
    const strategy = shouldUseMatch
      ? (best.reasons.some(reason => reason.startsWith('project contains')) ? 'direct-match' : 'similar-project')
      : fallback.reason;
    const reasons = shouldUseMatch ? best.reasons : [`fallback to ${fallback.client.name} (${fallback.reason})`];

    await prisma.project.update({
      where: { id: project.id },
      data: { clientId: chosen.id },
    });

    report.push({
      code: project.code,
      name: project.name,
      client: chosen.name,
      strategy,
      score: shouldUseMatch ? best.score : 0,
      reasons,
    });
  }

  console.log(`Updated ${report.length} projects:`);
  report.forEach(entry => {
    console.log(`- ${entry.code} | ${entry.name} -> ${entry.client} [${entry.strategy}${entry.score ? `, score ${entry.score}` : ''}]`);
    entry.reasons.slice(0, 3).forEach(reason => console.log(`    • ${reason}`));
  });
}

main()
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
