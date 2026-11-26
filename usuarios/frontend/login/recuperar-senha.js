document.getElementById('recovery-form').addEventListener('submit', async (e) => {
 e.preventDefault(); const status=document.getElementById('status'); status.textContent='Enviando...';
 try { const r=await fetch('/recuperar-senha',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:document.getElementById('email').value.trim()})}); const d=await r.json(); if(!r.ok) throw new Error(d.erro||'Falha ao solicitar recuperação.'); status.textContent=d.mensagem; }
 catch(err){status.textContent=err.message;}
});