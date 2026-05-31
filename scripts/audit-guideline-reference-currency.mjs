import fs from "node:fs";
import path from "node:path";

const NOW_YEAR = 2026;
const REFERENCES_PATH = path.resolve("content/references.json");
const REPORT_PATH = path.resolve("reports/guideline-reference-currency-2026-05-31.md");

const currentAuthorityDomains = [
  "anzcor.org",
  "resus.org.au",
  "tg.org.au",
  "safetyandquality.gov.au",
  "amh.net.au",
  "tga.gov.au",
  "shpa.org.au",
  "nps.org.au",
  "sccm.org",
  "heartfoundation.org.au",
  "informme.org.au",
  "allergy.org.au",
  "ginasthma.org",
  "goldcopd.org",
  "rch.org.au",
  "ranzcog.edu.au",
  "immunisationhandbook.health.gov.au",
  "nice.org.uk",
  "toxinz.com",
  "safeworkaustralia.gov.au",
  "workcover.wa.gov.au",
  "ahpra.gov.au",
  "comcare.gov.au",
  "cdc.gov",
  "tc.canada.ca",
  "cdc.gov",
  "mhfa.com.au",
  "anzca.edu.au",
  "australian.physio",
  "anzba.org.au",
  "surgeons.org",
  "stopthebleed.org"
];

const originalDerivationCategories = new Set([
  "Clinical Scoring",
  "Physiotherapy and Functional",
  "Occupational Health and Ergonomics"
]);

const originalDerivationIds = new Set([
  "crams",
  "gap",
  "mgap",
  "parkland"
]);

function yearsFrom(value) {
  return [...String(value || "").matchAll(/\b(19[0-9]{2}|20[0-9]{2})\b/g)]
    .map((match) => Number(match[1]))
    .filter((year) => year >= 1900 && year <= NOW_YEAR + 1);
}

function allUrls(reference) {
  const urls = [];
  if (reference.url) urls.push(reference.url);
  for (const source of reference.sources || []) if (source.url) urls.push(source.url);
  return urls;
}

function allSourceYears(reference) {
  const values = [reference.title, reference.subtitle, reference.url];
  for (const source of reference.sources || []) {
    values.push(source.title, source.subtitle, source.url);
  }
  return yearsFrom(values.join(" "));
}

function isCurrentAuthority(reference) {
  const urls = allUrls(reference);
  return urls.some((url) => currentAuthorityDomains.some((domain) => String(url).includes(domain)));
}

function classify(reference) {
  const years = allSourceYears(reference);
  const newestYear = years.length ? Math.max(...years) : null;
  const age = newestYear ? NOW_YEAR - newestYear : null;
  if (isCurrentAuthority(reference) && !newestYear) return { status: "rolling-authority", newestYear, age };
  if (newestYear && age <= 5) return { status: "current-5y", newestYear, age };
  if (newestYear && age <= 10) return { status: "acceptable-10y", newestYear, age };
  if (originalDerivationCategories.has(reference.category) || originalDerivationIds.has(reference.id)) return { status: "original-derivation-needs-current-companion", newestYear, age };
  return { status: "stale-needs-review", newestYear, age };
}

function loadReferences() {
  const refsJson = JSON.parse(fs.readFileSync(REFERENCES_PATH, "utf8"));
  const refs = [];
  for (const section of refsJson.sections || []) {
    for (const item of section.items || []) refs.push({ ...item, category: section.category });
  }
  return refs;
}

function loadGuidelines() {
  const files = fs.readdirSync("content/guidelines")
    .filter((name) => name.endsWith(".json"))
    .map((name) => path.join("content/guidelines", name));
  return files.map((file) => ({ file, ...JSON.parse(fs.readFileSync(file, "utf8")) }));
}

function cell(value) {
  return String(value ?? "").replace(/\|/g, "\\|").replace(/\n+/g, " ").trim();
}

const references = loadReferences();
const referenceMap = new Map(references.map((reference) => [reference.id, { ...reference, ...classify(reference) }]));
const guidelines = loadGuidelines();
const missingReferenceIds = new Map();
const guidelineRows = [];

for (const guideline of guidelines) {
  const ids = [...(guideline.referenceIDs || []), ...(guideline.relatedReferenceIDs || [])];
  const refs = ids.map((id) => referenceMap.get(id)).filter(Boolean);
  for (const id of ids) if (!referenceMap.has(id)) missingReferenceIds.set(id, (missingReferenceIds.get(id) || 0) + 1);
  const hasCurrentCompanion = refs.some((reference) => ["current-5y", "rolling-authority", "acceptable-10y"].includes(reference.status));
  const stale = refs.filter((reference) => reference.status === "stale-needs-review");
  const derivation = hasCurrentCompanion
    ? []
    : refs.filter((reference) => reference.status === "original-derivation-needs-current-companion");
  guidelineRows.push({
    file: guideline.file,
    id: guideline.id,
    title: guideline.title,
    type: guideline.library || guideline.type || "",
    referenceCount: ids.length,
    stale,
    derivation,
    currentCount: refs.filter((reference) => ["current-5y", "rolling-authority"].includes(reference.status)).length,
    acceptableCount: refs.filter((reference) => reference.status === "acceptable-10y").length
  });
}

const referenceRows = [...referenceMap.values()].sort((a, b) => {
  const order = ["stale-needs-review", "original-derivation-needs-current-companion", "acceptable-10y", "rolling-authority", "current-5y"];
  return order.indexOf(a.status) - order.indexOf(b.status) || a.category.localeCompare(b.category) || a.title.localeCompare(b.title);
});

const staleGuidelines = guidelineRows.filter((row) => row.stale.length || row.derivation.length);
const lines = [
  "# Guideline Reference Currency Audit - 2026-05-31",
  "",
  `- Guidelines audited: ${guidelines.length}`,
  `- Reference records audited: ${references.length}`,
  `- Guidelines with stale/non-current companion references: ${staleGuidelines.length}`,
  `- Missing reference IDs: ${missingReferenceIds.size}`,
  "",
  "Currency rules: prefer references <=5 years old; accept <=10 years where clinically appropriate; allow original derivation papers only when paired with a current guideline/review; treat living/rolling authority sources as current when no fixed publication year is available.",
  "",
  "## Reference-Level Findings",
  "",
  "| Status | Ref ID | Category | Title | Newest year | URL/source |",
  "| --- | --- | --- | --- | --- | --- |",
  ...referenceRows.map((reference) => {
    const source = reference.url || (reference.sources || []).map((item) => item.url).filter(Boolean).slice(0, 2).join("; ");
    return `| ${cell(reference.status)} | ${cell(reference.id)} | ${cell(reference.category)} | ${cell(reference.title)} | ${cell(reference.newestYear || "rolling/unknown")} | ${cell(source)} |`;
  }),
  "",
  "## Guideline-Level Findings",
  "",
  "| Guideline | File | Stale refs | Original derivation refs needing current companion | Current/rolling refs | <=10y refs |",
  "| --- | --- | --- | --- | --- | --- |",
  ...staleGuidelines.map((row) => `| ${cell(row.title)} | ${cell(row.file)} | ${cell(row.stale.map((ref) => ref.id).join(", "))} | ${cell(row.derivation.map((ref) => ref.id).join(", "))} | ${row.currentCount} | ${row.acceptableCount} |`)
];

if (missingReferenceIds.size) {
  lines.push("", "## Missing Reference IDs", "");
  for (const [id, count] of missingReferenceIds) lines.push(`- ${id}: ${count} use(s)`);
}

fs.writeFileSync(REPORT_PATH, lines.join("\n") + "\n");
console.log(`Wrote ${REPORT_PATH}`);
console.log(`Guidelines needing reference review: ${staleGuidelines.length}`);
