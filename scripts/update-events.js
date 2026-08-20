import { readFileSync, writeFileSync } from 'fs';

const BASE_URL = 'https://gravitas.vit.ac.in/api/v1/events';
const EXISTING_PATH = './src/data/events_scored.json';
const OUT_PATH = './src/data/events_scored.json';

function extractDates(slots) {
  if (!slots || slots.length === 0) return { start_date: null, end_date: null, venue: null };
  const sorted = [...slots].sort((a, b) => new Date(a.start_date) - new Date(b.start_date));
  return {
    start_date: sorted[0].start_date || null,
    end_date: sorted[sorted.length - 1].end_date || null,
    venue: sorted[0].venue || null,
  };
}

function computeDuration(start, end) {
  if (!start || !end) return { days: 1, hours: null, label: 'TBD' };
  const ms = new Date(end) - new Date(start);
  const totalHours = Math.round(ms / 3600000);
  const days = Math.ceil(totalHours / 24);
  if (totalHours < 24) return { days: 1, hours: totalHours, label: `${totalHours}h` };
  return { days, hours: totalHours, label: `${days} day${days > 1 ? 's' : ''} (${totalHours}h)` };
}

function deriveTags(event, start, end) {
  const tags = [];
  if (event.price_per_ticket === 0) tags.push('free'); else tags.push('paid');
  if (event.scope === 'internal_only') tags.push('internal-only');
  else if (event.scope === 'external_only') tags.push('external-only');
  else tags.push('open-to-all');
  if (event.is_team) tags.push('team-based'); else tags.push('solo');
  if (event.type === 'Workshop') tags.push('workshop');
  if (event.type === 'Hackathon') tags.push('hackathon');
  if (event.type === 'Competition') tags.push('competitive');
  if (start && end) {
    const hours = (new Date(end) - new Date(start)) / 3600000;
    if (hours >= 24) tags.push('multi-day');
    if (hours >= 36) tags.push('overnight');
  }
  if (event.category === 'Premium') tags.push('premium');
  return tags;
}

function defaultScores() {
  return { robotics: 0, iot: 0, ai_ml: 0, hackathons: 0, startups: 0, webdev: 0, cybersecurity: 0, electronics: 0, cad_design: 0, gaming: 0, finance: 0, general_fun: 0 };
}

async function fetchAllEvents() {
  let page = 1, totalPages = 1;
  const all = [];
  while (page <= totalPages) {
    console.log(`Fetching page ${page}/${totalPages}...`);
    const res = await fetch(`${BASE_URL}?page=${page}`);
    const json = await res.json();
    if (!json.success) throw new Error(`API error p${page}: ${json.message}`);
    const { events, totalPages: tp } = json.data;
    totalPages = tp;
    all.push(...events);
    page++;
  }
  console.log(`Total from API: ${all.length}`);
  return all;
}

async function main() {
  const rawEvents = await fetchAllEvents();

  let existing = [];
  try {
    existing = JSON.parse(readFileSync(EXISTING_PATH, 'utf8'));
    console.log(`Loaded ${existing.length} existing scored events`);
  } catch (e) { console.warn('No existing file:', e.message); }

  const existingById = Object.fromEntries(existing.map(e => [e.id, e]));
  const newIds = new Set(rawEvents.map(e => e.id));
  const removed = existing.filter(e => !newIds.has(e.id));

  if (removed.length > 0) {
    console.log('\n⚠️  REMOVED events:');
    removed.forEach(e => console.log(`  - [${e.id}] ${e.name}`));
  }

  let changedCount = 0;
  let newCount = 0;

  const output = rawEvents.map(raw => {
    const { start_date, end_date, venue } = extractDates(raw.slots);
    const ex = existingById[raw.id];

    if (!ex) {
      newCount++;
    } else {
      const changes = [];
      if (ex.name !== raw.name) changes.push(`name: "${ex.name}"→"${raw.name}"`);
      if (ex.start_date !== start_date) changes.push(`start: ${ex.start_date}→${start_date}`);
      if (ex.end_date !== end_date) changes.push(`end: ${ex.end_date}→${end_date}`);
      if (ex.venue !== venue) changes.push(`venue: "${ex.venue}"→"${venue}"`);
      if (ex.price !== raw.price_per_ticket) changes.push(`price: ${ex.price}→${raw.price_per_ticket}`);
      if (ex.team_size !== raw.team_size) changes.push(`team_size: ${ex.team_size}→${raw.team_size}`);
      if (ex.scope !== raw.scope) changes.push(`scope: ${ex.scope}→${raw.scope}`);
      if (ex.club !== raw.club) changes.push(`club: "${ex.club}"→"${raw.club}"`);
      if (changes.length > 0) {
        changedCount++;
        console.log(`\n✏️  CHANGED ${raw.name}: ${changes.join(' | ')}`);
      }
    }

    return {
      id: raw.id,
      name: raw.name,
      type: raw.type,
      club: raw.club,
      start_date,
      end_date,
      venue,
      team_size: raw.team_size,
      price: raw.price_per_ticket,
      short_description: raw.short_description,
      scope: raw.scope,
      category: raw.category,
      tagline: raw.tagline,
      is_team: raw.is_team,
      scores: ex ? ex.scores : defaultScores(),
      tags: ex ? ex.tags : deriveTags(raw, start_date, end_date),
      duration: ex ? ex.duration : computeDuration(start_date, end_date),
    };
  });

  output.sort((a, b) => {
    if (!a.start_date) return 1;
    if (!b.start_date) return -1;
    return new Date(a.start_date) - new Date(b.start_date);
  });

  writeFileSync(OUT_PATH, JSON.stringify(output, null, 2), 'utf8');
  console.log(`\n✅ Written ${output.length} events`);
  console.log(`   ${existing.length - removed.length} preserved | ${changedCount} changed | ${newCount} new | ${removed.length} removed`);
}

main().catch(console.error);
