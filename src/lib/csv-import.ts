// Tolerant CSV parser for deck imports. Each row becomes a card.
// Required column: front. Optional: back, grading_mode, typed_alternates (pipe-separated),
// choices (pipe-separated; for multiple_choice cards), bucket (letter A-Z or
// 0-indexed integer). Header row is required and matched case-insensitively.

import type { GradingMode } from '@/types/domain';

export type CSVImportCard = {
  front: string;
  back: string;
  grading_mode: GradingMode;
  typed_alternates: string[];
  choices: string[];
  bucket?: number; // 0-indexed
};

export function parseCSVImport(text: string, defaultMode: GradingMode): CSVImportCard[] {
  const lines = text.split(/\r?\n/);
  // Drop blank lines but keep their relative positions for error messages.
  const dataLines: { line: string; rowNum: number }[] = [];
  let headerLine = '';
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === '') continue;
    if (!headerLine) {
      headerLine = lines[i];
    } else {
      dataLines.push({ line: lines[i], rowNum: i + 1 });
    }
  }
  if (!headerLine) throw new Error('CSV is empty.');

  const headers = parseCSVLine(headerLine).map((h) => h.trim().toLowerCase());
  const idx = (name: string) => headers.indexOf(name);
  const frontIdx = idx('front');
  if (frontIdx < 0) throw new Error('CSV must include a "front" column.');
  const backIdx = idx('back');
  const modeIdx = idx('grading_mode');
  const altsIdx = idx('typed_alternates');
  const choicesIdx = idx('choices');
  const bucketIdx = idx('bucket');

  const cards: CSVImportCard[] = [];
  for (const { line, rowNum } of dataLines) {
    const row = parseCSVLine(line);
    const front = (row[frontIdx] ?? '').trim();
    if (!front) continue; // skip blank front

    const back = backIdx >= 0 ? (row[backIdx] ?? '').trim() : '';

    let grading_mode: GradingMode = defaultMode;
    if (modeIdx >= 0) {
      const v = (row[modeIdx] ?? '').trim().toLowerCase().replace(/[-_\s]/g, '');
      if (v === 'typed') grading_mode = 'typed';
      else if (v === 'selfgrade' || v === 'self') grading_mode = 'self_grade';
      else if (v === 'multiplechoice' || v === 'mc') grading_mode = 'multiple_choice';
      else if (v !== '') {
        throw new Error(`Row ${rowNum}: grading_mode "${row[modeIdx]}" is not recognized.`);
      }
    }

    const altsRaw = altsIdx >= 0 ? (row[altsIdx] ?? '').trim() : '';
    const typed_alternates = altsRaw
      ? altsRaw.split('|').map((s) => s.trim()).filter((s) => s.length > 0)
      : [];

    const choicesRaw = choicesIdx >= 0 ? (row[choicesIdx] ?? '').trim() : '';
    const choices = choicesRaw
      ? choicesRaw.split('|').map((s) => s.trim()).filter((s) => s.length > 0)
      : [];

    let bucket: number | undefined;
    if (bucketIdx >= 0) {
      const raw = (row[bucketIdx] ?? '').trim();
      if (raw) {
        const upper = raw.toUpperCase();
        if (/^[A-Z]$/.test(upper)) {
          bucket = upper.charCodeAt(0) - 65;
        } else {
          const n = Number(raw);
          if (!Number.isInteger(n) || n < 0) {
            throw new Error(`Row ${rowNum}: bucket "${raw}" must be a letter A–Z or a non-negative integer.`);
          }
          bucket = n;
        }
      }
    }

    if (grading_mode === 'typed' && !back) {
      throw new Error(`Row ${rowNum}: typed cards require a back.`);
    }
    if (grading_mode === 'multiple_choice') {
      if (!back) {
        throw new Error(`Row ${rowNum}: multiple_choice cards require a back (the correct answer).`);
      }
      if (choices.length < 2) {
        throw new Error(`Row ${rowNum}: multiple_choice cards need at least 2 choices (pipe-separated).`);
      }
      if (!choices.includes(back)) {
        throw new Error(`Row ${rowNum}: multiple_choice choices must include the back "${back}".`);
      }
    }

    cards.push({ front, back, grading_mode, typed_alternates, choices, bucket });
  }

  if (cards.length === 0) throw new Error('No card rows found.');
  return cards;
}

// Minimal RFC-4180-style line parser. Handles double-quoted fields and
// escaped double quotes ("") inside quotes.
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (c === '"') {
        inQuotes = false;
      } else {
        current += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      result.push(current);
      current = '';
    } else {
      current += c;
    }
  }
  result.push(current);
  return result;
}
