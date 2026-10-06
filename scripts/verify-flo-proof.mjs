import { readFileSync } from 'node:fs';
import { canonical, sha256 } from '../packages/capture-links/src/report-pipeline.mjs';
const [manifestPath, pdfPath] = process.argv.slice(2);
if (!manifestPath || !pdfPath) throw new Error('Usage: node scripts/verify-flo-proof.mjs Proof-of-FLO.json FLO-check-in-report.pdf');
const proof = JSON.parse(readFileSync(manifestPath, 'utf8'));
if (sha256(canonical(proof.manifest)) !== proof.proofHash) throw new Error('Proof of FLO manifest hash mismatch.');
if (sha256(readFileSync(pdfPath)) !== proof.pdfSha256) throw new Error('PDF file hash mismatch.');
console.log('Proof of FLO manifest and PDF hashes match. This checks integrity, not medical accuracy or authorship.');
