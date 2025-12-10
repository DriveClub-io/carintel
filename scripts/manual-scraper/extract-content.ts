#!/usr/bin/env npx tsx

import 'dotenv/config';

/**
 * PDF to Markdown Content Extraction Pipeline
 *
 * Extracts text content from vehicle manual PDFs and stores as markdown
 * in the manual_sections and manual_content tables.
 *
 * Usage:
 *   npx tsx extract-content.ts                    # Process all pending manuals
 *   npx tsx extract-content.ts --manual-id=UUID   # Process specific manual
 *   npx tsx extract-content.ts --limit=10         # Limit number to process
 *   npx tsx extract-content.ts --reprocess        # Re-extract already processed
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import * as fs from 'fs/promises';
import * as path from 'path';

import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://jxpbnnmefwtazfvoxvge.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const DOWNLOAD_DIR = './manuals';

if (!SUPABASE_SERVICE_KEY) {
  console.error('❌ SUPABASE_SERVICE_KEY required');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false }
});

interface ManualRecord {
  id: string;
  year: number;
  make: string;
  model: string;
  variant: string | null;
  pdf_storage_path: string | null;
  pdf_url: string;
  content_status: string;
}

interface Section {
  path: string;
  title: string;
  content: string;
  depth: number;
  pageStart?: number;
  pageEnd?: number;
}

/**
 * Download PDF from Supabase Storage or original URL
 */
async function downloadPdf(manual: ManualRecord): Promise<Buffer | null> {
  // First try local file
  const localPath = path.join(
    DOWNLOAD_DIR,
    `${manual.year}-${toSlug(manual.make)}-${toSlug(manual.model)}${manual.variant ? '-' + toSlug(manual.variant) : ''}.pdf`
  );

  try {
    const localFile = await fs.readFile(localPath);
    console.log(`   📁 Using local file: ${localPath}`);
    return localFile;
  } catch {
    // Not found locally
  }

  // Try Supabase Storage
  if (manual.pdf_storage_path) {
    console.log(`   ☁️  Downloading from Supabase Storage...`);
    const { data, error } = await supabase.storage
      .from('vehicle_manuals')
      .download(manual.pdf_storage_path);

    if (!error && data) {
      return Buffer.from(await data.arrayBuffer());
    }
    console.log(`   ⚠️  Storage download failed: ${error?.message}`);
  }

  // Fall back to original URL
  console.log(`   🌐 Downloading from original URL...`);
  try {
    const response = await fetch(manual.pdf_url);
    if (response.ok) {
      return Buffer.from(await response.arrayBuffer());
    }
  } catch (err: any) {
    console.log(`   ❌ URL download failed: ${err.message}`);
  }

  return null;
}

function toSlug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/**
 * Extract text content from PDF
 */
async function extractPdfText(pdfBuffer: Buffer): Promise<{
  text: string;
  numPages: number;
  info: any;
}> {
  // Load the PDF document
  const data = new Uint8Array(pdfBuffer);
  const loadingTask = pdfjsLib.getDocument({ data });
  const pdf = await loadingTask.promise;

  let fullText = '';
  const numPages = pdf.numPages;

  // Extract text from each page
  for (let pageNum = 1; pageNum <= numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const textContent = await page.getTextContent();

    // Concatenate text items
    const pageText = textContent.items
      .map((item: any) => item.str)
      .join(' ');

    fullText += pageText + '\n\n';
  }

  return {
    text: fullText,
    numPages,
    info: await pdf.getMetadata().catch(() => ({}))
  };
}

/**
 * Parse extracted text into sections based on common manual patterns
 */
function parseIntoSections(text: string, numPages: number): Section[] {
  const sections: Section[] = [];
  const lines = text.split('\n');

  let currentSection: Section | null = null;
  let sectionCounter = 0;
  let chapterCounter = 0;

  // Common chapter/section patterns in owner's manuals
  const chapterPatterns = [
    /^(CHAPTER\s+\d+|Chapter\s+\d+)/i,
    /^(\d+)\s+([A-Z][A-Z\s]{3,})/,  // "1 SAFETY" format
    /^([A-Z][A-Z\s]{5,})$/,          // All caps heading
  ];

  const sectionPatterns = [
    /^(\d+[-.]?\d*)\s+(.+)/,         // "1.2 Tire Pressure"
    /^([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s*$/,  // Title Case heading
    /^•\s*([A-Z].+)/,                // Bullet point heading
  ];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Check for chapter-level headings
    let isChapter = false;
    for (const pattern of chapterPatterns) {
      if (pattern.test(line) && line.length < 80) {
        isChapter = true;
        break;
      }
    }

    if (isChapter) {
      // Save previous section
      if (currentSection && currentSection.content.trim()) {
        sections.push(currentSection);
      }

      chapterCounter++;
      sectionCounter = 0;
      currentSection = {
        path: `${chapterCounter}`,
        title: cleanTitle(line),
        content: '',
        depth: 0
      };
      continue;
    }

    // Check for section-level headings
    let isSection = false;
    for (const pattern of sectionPatterns) {
      const match = line.match(pattern);
      if (match && line.length < 100 && line.length > 3) {
        // Avoid false positives on normal sentences
        if (!line.includes('.') || line.endsWith(':')) {
          isSection = true;
          break;
        }
      }
    }

    if (isSection && currentSection) {
      // Check if this looks like a real heading
      const nextLines = lines.slice(i + 1, i + 3).join(' ').trim();
      if (nextLines.length > 50) { // Has content after it
        // Save current section
        if (currentSection.content.trim()) {
          sections.push(currentSection);
        }

        sectionCounter++;
        currentSection = {
          path: `${chapterCounter || 1}.${sectionCounter}`,
          title: cleanTitle(line),
          content: '',
          depth: 1
        };
        continue;
      }
    }

    // Add content to current section
    if (currentSection) {
      currentSection.content += line + '\n';
    } else {
      // Create initial section if none exists
      currentSection = {
        path: '0',
        title: 'Introduction',
        content: line + '\n',
        depth: 0
      };
    }
  }

  // Don't forget the last section
  if (currentSection && currentSection.content.trim()) {
    sections.push(currentSection);
  }

  // If parsing didn't work well, create a single section
  if (sections.length === 0 || (sections.length === 1 && sections[0].path === '0')) {
    return [{
      path: '1',
      title: 'Full Manual Content',
      content: text,
      depth: 0
    }];
  }

  // Clean up sections with very little content
  return sections.filter(s => s.content.trim().length > 100);
}

function cleanTitle(title: string): string {
  return title
    .replace(/^[\d.]+\s*/, '')      // Remove leading numbers
    .replace(/^(CHAPTER|Chapter)\s*\d*:?\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, 200);
}

/**
 * Convert section content to markdown format
 */
function toMarkdown(section: Section): string {
  const heading = '#'.repeat(Math.min(section.depth + 1, 6));
  let md = `${heading} ${section.title}\n\n`;

  // Clean up the content
  let content = section.content
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')        // Reduce multiple newlines
    .replace(/^\s+|\s+$/gm, '')        // Trim lines
    .replace(/([.!?])\s*\n(?=[A-Z])/g, '$1 ')  // Join sentences split across lines
    .trim();

  // Convert bullet patterns to markdown lists
  content = content
    .replace(/^[•●○]\s*/gm, '- ')
    .replace(/^[-–—]\s+/gm, '- ')
    .replace(/^\d+[.)]\s+/gm, (match) => match); // Keep numbered lists

  md += content + '\n';

  return md;
}

/**
 * Extract keywords from content for search indexing
 */
function extractKeywords(content: string, title: string): string[] {
  const keywords = new Set<string>();

  // Common automotive terms to look for
  const autoTerms = [
    'tire', 'oil', 'brake', 'engine', 'battery', 'fuel', 'light', 'warning',
    'maintenance', 'safety', 'airbag', 'seat', 'belt', 'door', 'window',
    'mirror', 'wiper', 'filter', 'fluid', 'pressure', 'temperature', 'gauge',
    'dashboard', 'instrument', 'control', 'switch', 'button', 'key', 'fob',
    'start', 'stop', 'drive', 'park', 'reverse', 'neutral', 'transmission',
    'cruise', 'lane', 'assist', 'camera', 'sensor', 'navigation', 'audio',
    'bluetooth', 'phone', 'climate', 'ac', 'heat', 'defrost', 'vent'
  ];

  const text = (title + ' ' + content).toLowerCase();

  for (const term of autoTerms) {
    if (text.includes(term)) {
      keywords.add(term);
    }
  }

  // Extract title words
  title.toLowerCase().split(/\s+/).forEach(word => {
    if (word.length > 3) {
      keywords.add(word.replace(/[^a-z]/g, ''));
    }
  });

  return Array.from(keywords).slice(0, 20);
}

/**
 * Process a single manual
 */
async function processManual(manual: ManualRecord): Promise<boolean> {
  console.log(`\n📖 Processing: ${manual.year} ${manual.make} ${manual.model}${manual.variant ? ` (${manual.variant})` : ''}`);

  // Update status to extracting
  await supabase
    .from('vehicle_manuals')
    .update({ content_status: 'extracting' })
    .eq('id', manual.id);

  try {
    // Download PDF
    const pdfBuffer = await downloadPdf(manual);
    if (!pdfBuffer) {
      throw new Error('Could not download PDF');
    }

    console.log(`   📄 PDF size: ${(pdfBuffer.length / 1024 / 1024).toFixed(1)}MB`);

    // Extract text
    console.log(`   🔍 Extracting text...`);
    const { text, numPages, info } = await extractPdfText(pdfBuffer);
    console.log(`   📃 Pages: ${numPages}, Characters: ${text.length.toLocaleString()}`);

    if (text.length < 1000) {
      throw new Error('PDF appears to be mostly images (OCR not supported yet)');
    }

    // Parse into sections
    console.log(`   📑 Parsing sections...`);
    const sections = parseIntoSections(text, numPages);
    console.log(`   📚 Found ${sections.length} sections`);

    // Generate full markdown
    const fullMarkdown = sections.map(s => toMarkdown(s)).join('\n\n---\n\n');
    const totalTokens = Math.ceil(fullMarkdown.length / 4);

    // Build table of contents
    const toc = sections.map(s => ({
      path: s.path,
      title: s.title,
      depth: s.depth,
      token_count: Math.ceil(s.content.length / 4)
    }));

    // Delete existing sections for this manual
    await supabase
      .from('manual_sections')
      .delete()
      .eq('manual_id', manual.id);

    // Insert sections
    console.log(`   💾 Saving ${sections.length} sections to database...`);
    for (const section of sections) {
      const markdown = toMarkdown(section);
      const keywords = extractKeywords(section.content, section.title);

      const { error } = await supabase
        .from('manual_sections')
        .insert({
          manual_id: manual.id,
          section_path: section.path,
          section_title: section.title,
          depth: section.depth,
          sort_order: parseInt(section.path.split('.').pop() || '0'),
          content_markdown: markdown,
          keywords: keywords,
          page_start: section.pageStart,
          page_end: section.pageEnd
        });

      if (error) {
        console.error(`   ⚠️  Section insert error: ${error.message}`);
      }
    }

    // Insert/update full content
    await supabase
      .from('manual_content')
      .upsert({
        manual_id: manual.id,
        content_markdown: fullMarkdown,
        table_of_contents: toc,
        total_word_count: fullMarkdown.split(/\s+/).length,
        total_char_count: fullMarkdown.length,
        total_token_count: totalTokens,
        total_pages: numPages,
        extraction_method: 'pdf-parse',
        extraction_quality: text.length > 10000 ? 0.9 : 0.5,
        extracted_at: new Date().toISOString()
      }, {
        onConflict: 'manual_id'
      });

    // Update manual status
    await supabase
      .from('vehicle_manuals')
      .update({
        content_status: 'extracted',
        content_extracted_at: new Date().toISOString()
      })
      .eq('id', manual.id);

    console.log(`   ✅ Extracted: ${sections.length} sections, ~${totalTokens.toLocaleString()} tokens`);
    return true;

  } catch (error: any) {
    console.error(`   ❌ Extraction failed: ${error.message}`);

    await supabase
      .from('vehicle_manuals')
      .update({
        content_status: 'failed',
        error_message: error.message
      })
      .eq('id', manual.id);

    return false;
  }
}

/**
 * Main function
 */
async function main() {
  console.log('📚 Manual Content Extraction Pipeline');
  console.log('=====================================\n');

  const args = process.argv.slice(2);
  const manualIdArg = args.find(a => a.startsWith('--manual-id='));
  const limitArg = args.find(a => a.startsWith('--limit='));
  const reprocess = args.includes('--reprocess');

  const manualId = manualIdArg?.split('=')[1];
  const limit = limitArg ? parseInt(limitArg.split('=')[1]) : 100;

  // Build query
  let query = supabase
    .from('vehicle_manuals')
    .select('id, year, make, model, variant, pdf_storage_path, pdf_url, content_status')
    .or('pdf_storage_path.not.is.null,pdf_url.not.is.null');

  if (manualId) {
    query = query.eq('id', manualId);
  } else if (!reprocess) {
    query = query.in('content_status', ['pending', 'failed']);
  }

  query = query.order('year', { ascending: false }).limit(limit);

  const { data: manuals, error } = await query;

  if (error) {
    console.error('Error fetching manuals:', error);
    process.exit(1);
  }

  console.log(`📊 Found ${manuals?.length || 0} manuals to process\n`);

  let processed = 0;
  let succeeded = 0;
  let failed = 0;

  for (const manual of manuals || []) {
    processed++;
    const success = await processManual(manual as ManualRecord);
    if (success) {
      succeeded++;
    } else {
      failed++;
    }

    // Small delay between manuals
    await new Promise(r => setTimeout(r, 500));
  }

  console.log('\n\n📊 EXTRACTION SUMMARY');
  console.log('=====================');
  console.log(`Processed: ${processed}`);
  console.log(`Succeeded: ${succeeded}`);
  console.log(`Failed: ${failed}`);
}

main().catch(console.error);
