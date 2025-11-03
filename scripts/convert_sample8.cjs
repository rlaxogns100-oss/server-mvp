// Convert history/sample8/problems.json to DB-like structured JSON
// Output: history/sample8/problems_llm_structured.json

const fs = require('fs');
const path = require('path');

function parseProblem(p){
  const content = Array.isArray(p.content) ? p.content : [];
  const textLines = [];
  const options = [];
  const blocks = [];

  const pushTextBlock = ()=>{
    if (textLines.length){
      const text = textLines.join(' ').replace(/\s+/g,' ').trim();
      if (text) blocks.push({ type:'text', content:text });
      textLines.length = 0;
    }
  };

  for (const raw of content){
    const line = String(raw || '').trim();
    if (!line) continue;

    // Image markdown
    const im = line.match(/!\[]\(([^)]+)\)/);
    if (im && im[1]){ pushTextBlock(); blocks.push({ type:'image', content: im[1] }); continue; }

    // LaTeX table (single block)
    if (line.includes('\\begin{tabular}') || line.includes('\\begin{array}')){
      pushTextBlock(); blocks.push({ type:'table', content: line }); continue; }

    // Options like (1) xxx
    const om = line.match(/^\((\d+)\)\s*(.*)$/);
    if (om){ options.push(om[2] || om[1]); continue; }

    // Otherwise, normal text
    textLines.push(line);
  }
  pushTextBlock();

  return {
    id: p.id,
    page: p.page ?? null,
    content_blocks: blocks,
    options
  };
}

function main(){
  const inPath = path.join(__dirname, '..', 'history', 'sample8', 'problems.json');
  const outPath = path.join(__dirname, '..', 'history', 'sample8', 'problems_llm_structured.json');

  const raw = fs.readFileSync(inPath, 'utf8');
  const src = JSON.parse(raw);
  const out = Array.isArray(src) ? src.map(parseProblem) : [];
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf8');
  console.log('Wrote', out.length, 'problems to', outPath);
}

main();


