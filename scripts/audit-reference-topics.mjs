import fs from "node:fs";
import path from "node:path";

const REFERENCES_PATH = path.resolve("content/references.json");
const REPORT_PATH = path.resolve("reports/reference-topic-audit-2026-05-31.md");
const EUTILS = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi";

const stopWords = new Set([
  "and", "the", "for", "with", "from", "that", "this", "are", "was", "were",
  "of", "in", "on", "to", "a", "an", "as", "by", "or", "at", "be", "is",
  "clinical", "guideline", "guidelines", "evidence", "management", "resources",
  "reference", "references", "review", "systematic", "patient", "patients", "treatment"
]);

function words(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2 && !stopWords.has(word));
}

function extractPmid(url) {
  return String(url || "").match(/pubmed\.ncbi\.nlm\.nih\.gov\/(\d+)/)?.[1] || null;
}

function sourceEntries(reference) {
  const entries = [];
  if (reference.url) entries.push({ reference, title: reference.title, subtitle: reference.subtitle || "", url: reference.url });
  for (const source of reference.sources || []) {
    if (source.url) entries.push({ reference, title: source.title || "", subtitle: source.subtitle || "", url: source.url });
  }
  return entries;
}

async function fetchPubMedSummaries(pmids) {
  const out = new Map();
  for (let i = 0; i < pmids.length; i += 100) {
    const batch = pmids.slice(i, i + 100);
    const response = await fetch(`${EUTILS}?db=pubmed&id=${batch.join(",")}&retmode=json`);
    if (!response.ok) throw new Error(`PubMed request failed: ${response.status}`);
    const json = await response.json();
    for (const pmid of batch) if (json.result?.[pmid]) out.set(pmid, json.result[pmid]);
  }
  return out;
}

function score(entry, pubmed) {
  const local = [...new Set(words([entry.reference.title, entry.reference.category, entry.title, entry.subtitle].join(" ")))];
  const remote = [...new Set(words([pubmed.title, pubmed.fulljournalname, ...(pubmed.authors || []).slice(0, 6).map((author) => author.name)].join(" ")))];
  const overlap = local.filter((token) => remote.includes(token));
  const scoreValue = overlap.length / Math.max(1, Math.min(local.length, remote.length));
  let status = "review";
  if (scoreValue >= 0.18 || overlap.length >= 3) status = "likely-ok";
  if (scoreValue < 0.08 && overlap.length < 2) status = "weak";
  return { status, overlap };
}

function cell(value) {
  return String(value || "").replace(/\|/g, "\\|").replace(/\n+/g, " ").trim();
}

const refsJson = JSON.parse(fs.readFileSync(REFERENCES_PATH, "utf8"));
const references = [];
for (const section of refsJson.sections || []) for (const item of section.items || []) references.push({ ...item, category: section.category });
const pubmedEntries = references.flatMap(sourceEntries)
  .map((entry) => ({ ...entry, pmid: extractPmid(entry.url) }))
  .filter((entry) => entry.pmid);
const summaries = await fetchPubMedSummaries([...new Set(pubmedEntries.map((entry) => entry.pmid))]);
const audited = pubmedEntries.map((entry) => ({ ...entry, pubmed: summaries.get(entry.pmid) || {}, match: score(entry, summaries.get(entry.pmid) || {}) }));
const weak = audited.filter((entry) => entry.match.status === "weak");
const review = audited.filter((entry) => entry.match.status === "review");

const rows = [...weak, ...review].map((entry) => `| ${cell(entry.reference.id)} | ${cell(entry.title)} | ${cell(entry.url)} | ${cell(entry.pubmed.title || "metadata unavailable")} | ${cell(`${entry.match.status}; overlap: ${entry.match.overlap.join(", ") || "none"}`)} |`);
const report = [
  "# Reference Topic Audit - 2026-05-31",
  "",
  `- Reference records: ${references.length}`,
  `- PubMed URLs audited: ${pubmedEntries.length}`,
  `- Weak matches: ${weak.length}`,
  `- Borderline reviews: ${review.length}`,
  "",
  "This automated audit checks whether PubMed metadata appears to match the local reference title/context. It catches wrong-PMID errors; it does not replace clinical editorial review.",
  "",
  "| Ref ID | Local title | URL | PubMed title | Reason |",
  "| --- | --- | --- | --- | --- |",
  ...(rows.length ? rows : ["| _None_ |  |  |  |  |"])
].join("\n");

fs.writeFileSync(REPORT_PATH, report + "\n");
console.log(`Wrote ${REPORT_PATH}`);
console.log(`Weak: ${weak.length}; review: ${review.length}`);
