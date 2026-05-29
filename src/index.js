const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function cors(headers = {}) {
  return { ...CORS, ...headers };
}

// --- PDF text extraction: parse BT/ET blocks from raw bytes ---
function extractPdfText(bytes) {
  const str = new TextDecoder('latin1').decode(bytes);
  const chunks = [];
  let i = 0;
  while (i < str.length) {
    const bt = str.indexOf('BT', i);
    if (bt === -1) break;
    const et = str.indexOf('ET', bt);
    if (et === -1) break;
    const block = str.slice(bt + 2, et);
    const tjMatches = block.matchAll(/\(([^)]*)\)\s*T[jJ]/g);
    for (const m of tjMatches) {
      chunks.push(m[1].replace(/\\(\d{3})/g, (_, oct) =>
        String.fromCharCode(parseInt(oct, 8))
      ).replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\t/g, '\t'));
    }
    const arrMatches = block.matchAll(/\[([^\]]*)\]\s*TJ/g);
    for (const m of arrMatches) {
      const parts = m[1].matchAll(/\(([^)]*)\)/g);
      for (const p of parts) {
        chunks.push(p[1].replace(/\\(\d{3})/g, (_, oct) =>
          String.fromCharCode(parseInt(oct, 8))
        ).replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\t/g, '\t'));
      }
    }
    i = et + 2;
  }
  return chunks.join(' ').replace(/\s+/g, ' ').trim();
}

// --- Chunking: 512-word segments with 50-word overlap ---
function chunkText(text, chunkSize = 512, overlap = 50) {
  const words = text.split(/\s+/).filter(Boolean);
  const chunks = [];
  let start = 0;
  while (start < words.length) {
    const end = Math.min(start + chunkSize, words.length);
    chunks.push(words.slice(start, end).join(' '));
    if (end === words.length) break;
    start += chunkSize - overlap;
  }
  return chunks;
}

// --- Embed a single text ---
async function embed(ai, text) {
  const res = await ai.run('@cf/baai/bge-base-en-v1.5', { text: [text] });
  return res.data[0];
}

// --- HTML frontend ---
const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>DocMind — RAG Chatbot</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Segoe UI',system-ui,sans-serif;background:#0f1117;color:#e2e8f0;height:100vh;display:flex;overflow:hidden}
#sidebar{width:280px;min-width:220px;background:#1a1d27;border-right:1px solid #2d3148;display:flex;flex-direction:column;padding:16px;gap:12px}
#sidebar h2{font-size:1.1rem;font-weight:700;color:#a78bfa;letter-spacing:.5px}
#drop-zone{border:2px dashed #3d4268;border-radius:10px;padding:20px;text-align:center;cursor:pointer;transition:all .2s;font-size:.85rem;color:#94a3b8}
#drop-zone.over{border-color:#a78bfa;background:#1e1b33}
#drop-zone input{display:none}
#progress-wrap{display:none;flex-direction:column;gap:4px;font-size:.8rem;color:#94a3b8}
#progress-bar-bg{background:#2d3148;border-radius:4px;height:6px;overflow:hidden}
#progress-bar{height:6px;background:#a78bfa;width:0%;transition:width .3s;border-radius:4px}
#files-label{font-size:.8rem;font-weight:600;color:#64748b;text-transform:uppercase;letter-spacing:.8px;margin-top:4px}
#file-list{flex:1;overflow-y:auto;display:flex;flex-direction:column;gap:6px}
.file-item{background:#1e2235;border-radius:8px;padding:8px 10px;font-size:.82rem;color:#cbd5e1;border:1px solid #2d3148;display:flex;align-items:center;gap:8px;word-break:break-all}
.file-item::before{content:'📄';flex-shrink:0}
#main{flex:1;display:flex;flex-direction:column;overflow:hidden}
#chat-header{padding:14px 20px;border-bottom:1px solid #2d3148;background:#14172a;font-size:1rem;font-weight:700;color:#e2e8f0}
#chat-header span{color:#a78bfa}
#messages{flex:1;overflow-y:auto;padding:20px;display:flex;flex-direction:column;gap:14px}
#messages::-webkit-scrollbar{width:5px}
#messages::-webkit-scrollbar-track{background:transparent}
#messages::-webkit-scrollbar-thumb{background:#2d3148;border-radius:3px}
.msg{max-width:78%;padding:12px 15px;border-radius:12px;font-size:.9rem;line-height:1.55;word-break:break-word}
.msg.user{align-self:flex-end;background:#4f46e5;color:#fff;border-bottom-right-radius:3px}
.msg.ai{align-self:flex-start;background:#1e2235;color:#e2e8f0;border-bottom-left-radius:3px;border:1px solid #2d3148}
.sources{margin-top:8px;display:flex;flex-wrap:wrap;gap:5px}
.src-tag{background:#2d3148;color:#a78bfa;font-size:.72rem;padding:2px 8px;border-radius:12px;border:1px solid #3d4268}
.typing{display:flex;gap:5px;align-items:center;padding:12px 15px;background:#1e2235;border-radius:12px;border:1px solid #2d3148;align-self:flex-start;width:fit-content}
.typing span{width:7px;height:7px;background:#a78bfa;border-radius:50%;animation:bounce .9s infinite}
.typing span:nth-child(2){animation-delay:.15s}
.typing span:nth-child(3){animation-delay:.3s}
@keyframes bounce{0%,60%,100%{transform:translateY(0)}30%{transform:translateY(-6px)}}
#input-row{padding:14px 20px;border-top:1px solid #2d3148;background:#14172a;display:flex;gap:10px;align-items:flex-end}
#user-input{flex:1;background:#1e2235;border:1px solid #2d3148;border-radius:10px;color:#e2e8f0;padding:10px 14px;font-size:.9rem;resize:none;max-height:150px;overflow-y:auto;line-height:1.5;outline:none;transition:border-color .2s}
#user-input:focus{border-color:#a78bfa}
#send-btn{background:#4f46e5;color:#fff;border:none;border-radius:10px;padding:10px 18px;cursor:pointer;font-size:.9rem;font-weight:600;transition:background .2s;white-space:nowrap}
#send-btn:hover{background:#6366f1}
#send-btn:disabled{opacity:.5;cursor:not-allowed}
.empty-state{color:#4a5568;text-align:center;margin:auto;font-size:.9rem}
</style>
</head>
<body>
<div id="sidebar">
  <h2>⚡ DocMind</h2>
  <div id="drop-zone" onclick="document.getElementById('file-input').click()" ondragover="onDragOver(event)" ondragleave="onDragLeave(event)" ondrop="onDrop(event)">
    <input type="file" id="file-input" accept=".pdf,.txt,.md,.csv" onchange="uploadFile(this.files[0])"/>
    <div>Drop file here or click</div>
    <div style="font-size:.75rem;margin-top:4px;color:#4a5568">PDF, TXT, MD, CSV</div>
  </div>
  <div id="progress-wrap">
    <div id="progress-label">Uploading…</div>
    <div id="progress-bar-bg"><div id="progress-bar"></div></div>
  </div>
  <div id="files-label">Indexed Files</div>
  <div id="file-list"><div class="empty-state" style="padding:10px;font-size:.8rem">No files yet</div></div>
</div>
<div id="main">
  <div id="chat-header"><span>DocMind</span> — Ask anything about your documents</div>
  <div id="messages"><div class="empty-state">Upload a document and start chatting</div></div>
  <div id="input-row">
    <textarea id="user-input" rows="1" placeholder="Ask a question…" onkeydown="onKey(event)" oninput="autoResize(this)"></textarea>
    <button id="send-btn" onclick="sendChat()">Send</button>
  </div>
</div>
<script>
async function loadFiles(){
  try{
    const r=await fetch('/files');
    const d=await r.json();
    const el=document.getElementById('file-list');
    if(!d.files||d.files.length===0){el.innerHTML='<div class="empty-state" style="padding:10px;font-size:.8rem">No files yet</div>';return;}
    el.innerHTML=d.files.map(f=>'<div class="file-item">'+escHtml(f)+'</div>').join('');
  }catch(e){}
}
function escHtml(s){return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
function onDragOver(e){e.preventDefault();document.getElementById('drop-zone').classList.add('over');}
function onDragLeave(){document.getElementById('drop-zone').classList.remove('over');}
function onDrop(e){e.preventDefault();document.getElementById('drop-zone').classList.remove('over');const f=e.dataTransfer.files[0];if(f)uploadFile(f);}
function setProgress(pct,label){
  const w=document.getElementById('progress-wrap');
  w.style.display='flex';
  document.getElementById('progress-bar').style.width=pct+'%';
  document.getElementById('progress-label').textContent=label;
  if(pct>=100)setTimeout(()=>{w.style.display='none';},1200);
}
async function uploadFile(file){
  if(!file)return;
  const fd=new FormData();fd.append('file',file);
  setProgress(10,'Uploading…');
  try{
    const r=await fetch('/upload',{method:'POST',body:fd});
    setProgress(80,'Indexing chunks…');
    const d=await r.json();
    if(d.error){setProgress(100,'Error: '+d.error);return;}
    setProgress(100,'Done! '+d.chunks+' chunks indexed');
    loadFiles();
  }catch(e){setProgress(100,'Upload failed');}
}
function autoResize(el){el.style.height='auto';el.style.height=Math.min(el.scrollHeight,150)+'px';}
function onKey(e){if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendChat();}}
function appendMsg(role,html,sources){
  const msgs=document.getElementById('messages');
  const empty=msgs.querySelector('.empty-state');if(empty)empty.remove();
  const d=document.createElement('div');
  d.className='msg '+role;
  d.innerHTML=html;
  if(sources&&sources.length){
    const uniq=[...new Set(sources)];
    const s=document.createElement('div');s.className='sources';
    s.innerHTML=uniq.map(n=>'<span class="src-tag">'+escHtml(n)+'</span>').join('');
    d.appendChild(s);
  }
  msgs.appendChild(d);
  msgs.scrollTop=msgs.scrollHeight;
  return d;
}
function showTyping(){
  const msgs=document.getElementById('messages');
  const d=document.createElement('div');d.className='typing';d.id='typing-indicator';
  d.innerHTML='<span></span><span></span><span></span>';
  msgs.appendChild(d);msgs.scrollTop=msgs.scrollHeight;
}
function hideTyping(){const t=document.getElementById('typing-indicator');if(t)t.remove();}
async function sendChat(){
  const inp=document.getElementById('user-input');
  const q=inp.value.trim();if(!q)return;
  inp.value='';autoResize(inp);
  document.getElementById('send-btn').disabled=true;
  appendMsg('user',escHtml(q));
  showTyping();
  try{
    const r=await fetch('/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({query:q})});
    const d=await r.json();
    hideTyping();
    if(d.error){appendMsg('ai','<em>Error: '+escHtml(d.error)+'</em>');return;}
    appendMsg('ai',escHtml(d.answer),d.sources);
  }catch(e){hideTyping();appendMsg('ai','<em>Request failed.</em>');}
  finally{document.getElementById('send-btn').disabled=false;}
}
loadFiles();
</script>
</body>
</html>`;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors() });
    }

    // GET / — serve frontend
    if (request.method === 'GET' && url.pathname === '/') {
      return new Response(HTML, {
        headers: cors({ 'Content-Type': 'text/html;charset=UTF-8' }),
      });
    }

    // GET /files — list R2 objects
    if (request.method === 'GET' && url.pathname === '/files') {
      try {
        const listed = await env.R2.list();
        const files = listed.objects.map(o => o.key);
        return Response.json({ files }, { headers: cors() });
      } catch (e) {
        return Response.json({ error: e.message }, { status: 500, headers: cors() });
      }
    }

    // POST /upload — ingest file
    if (request.method === 'POST' && url.pathname === '/upload') {
      try {
        const formData = await request.formData();
        const file = formData.get('file');
        if (!file) {
          return Response.json({ error: 'No file provided' }, { status: 400, headers: cors() });
        }

        const fileName = file.name;
        const fileId = crypto.randomUUID();
        const arrayBuffer = await file.arrayBuffer();
        const bytes = new Uint8Array(arrayBuffer);

        // Extract text based on file type
        let text = '';
        const ext = fileName.split('.').pop().toLowerCase();
        if (ext === 'pdf') {
          text = extractPdfText(bytes);
        } else {
          text = new TextDecoder('utf-8').decode(bytes);
        }

        if (!text.trim()) {
          return Response.json({ error: 'Could not extract text from file' }, { status: 400, headers: cors() });
        }

        // Store raw file in R2
        await env.R2.put(fileName, arrayBuffer, {
          httpMetadata: { contentType: file.type || 'application/octet-stream' },
          customMetadata: { fileId },
        });

        // Chunk the text
        const chunks = chunkText(text);

        // Embed and upsert each chunk
        const vectors = [];
        for (let i = 0; i < chunks.length; i++) {
          const chunkText2 = chunks[i];
          const vector = await embed(env.AI, chunkText2);
          vectors.push({
            id: `${fileId}-${i}`,
            values: vector,
            metadata: {
              fileId,
              fileName,
              chunkIndex: i,
              text: chunkText2.slice(0, 1000), // Vectorize metadata limit
            },
          });
        }

        // Upsert in batches of 100 (Vectorize limit)
        for (let i = 0; i < vectors.length; i += 100) {
          await env.VECTORIZE.upsert(vectors.slice(i, i + 100));
        }

        return Response.json(
          { success: true, fileName, fileId, chunks: chunks.length },
          { headers: cors() }
        );
      } catch (e) {
        return Response.json({ error: e.message }, { status: 500, headers: cors() });
      }
    }

    // POST /chat — RAG query
    if (request.method === 'POST' && url.pathname === '/chat') {
      try {
        const body = await request.json();
        const query = body.query?.trim();
        if (!query) {
          return Response.json({ error: 'No query provided' }, { status: 400, headers: cors() });
        }

        // Embed query
        const queryVector = await embed(env.AI, query);

        // Query Vectorize
        const results = await env.VECTORIZE.query(queryVector, {
          topK: 5,
          returnMetadata: 'all',
        });

        const matches = results.matches || [];
        const contextChunks = matches
          .filter(m => m.score > 0.1)
          .map(m => m.metadata?.text || '')
          .filter(Boolean);

        const sources = [...new Set(
          matches.filter(m => m.score > 0.1).map(m => m.metadata?.fileName).filter(Boolean)
        )];

        const contextText = contextChunks.length > 0
          ? contextChunks.map((c, i) => `[${i + 1}] ${c}`).join('\n\n')
          : 'No relevant context found.';

        const systemPrompt = `You are DocMind, a helpful document assistant. Answer the user's question based on the provided document context. Be concise and accurate. If the context doesn't contain enough information, say so honestly.

Context from documents:
${contextText}`;

        const llmResponse = await env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: query },
          ],
          max_tokens: 1024,
        });

        const answer = llmResponse.response || 'No response generated.';

        return Response.json({ answer, sources }, { headers: cors() });
      } catch (e) {
        return Response.json({ error: e.message }, { status: 500, headers: cors() });
      }
    }

    return new Response('Not Found', { status: 404, headers: cors() });
  },
};
